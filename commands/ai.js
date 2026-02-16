const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const config = require('../lib/config');
const { aiParseIntent } = require('../lib/ai/parser');
const { validateIntent } = require('../lib/ai/validator');
const { executeIntent } = require('../lib/ai/executor');
const { formatResult } = require('../lib/ai/format');
const { showConfirmation } = require('../lib/ui/confirm');
const intentsSchema = require('../lib/ai/intents.json');
const { intentRisk } = require('../lib/ai/contract');

function parseInputField(field, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (field === 'fields') {
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return trimmed;
}

async function askForMissingFields(intent, validation) {
  const missing = Array.from(new Set(validation?.missingFields || []));
  if (!missing.length) return {};
  if (!process.stdout.isTTY) return {};

  const out = {};
  // eslint-disable-next-line no-restricted-syntax
  for (const field of missing) {
    // eslint-disable-next-line no-await-in-loop
    const ans = await inquirer.prompt([
      {
        type: 'input',
        name: 'value',
        message: `Provide ${field}:`
      }
    ]);
    out[field] = parseInputField(field, ans.value);
  }
  return out;
}

function printWarnings(warnings) {
  if (!warnings || !warnings.length) return;
  console.log(chalk.yellow('\nWarnings:\n'));
  warnings.forEach((w) => {
    console.log(chalk.yellow(`  ! ${w}`));
  });
}

function riskForIntent(intent) {
  return intentsSchema[intent.action]?.risk || intentRisk(intent.action) || 'low';
}

function printValidationIssues(validation) {
  console.log(chalk.yellow('\nMissing or invalid information:\n'));
  validation.errors.forEach((err) => {
    console.log(chalk.red(`  x ${err}`));
  });

  if (validation.suggestions.length > 0) {
    console.log(chalk.cyan('\nSuggestions:\n'));
    validation.suggestions.forEach((suggestion) => {
      console.log(chalk.cyan(`  -> ${suggestion}`));
    });
  }
}

/**
 * Register `social ai` natural-language command.
 * @param {import('commander').Command} program
 */
function registerAiCommands(program) {
  program
    .command('ai')
    .description('Natural language interface for Meta APIs (experimental)')
    .argument('<intent...>', 'What you want to do in plain English')
    .option('--yes', 'Skip confirmation for low/medium risk actions', false)
    .option('--debug', 'Show parsing and execution details', false)
    .option('--json', 'Output result as JSON', false)
    .option('--ink', 'Use Ink prompt for confirmation if available', false)
    .action(async (intentParts, opts) => {
      const text = (intentParts || []).join(' ').trim();
      if (!text) {
        console.error(chalk.red('x Missing intent text.'));
        process.exit(1);
      }

      const spinner = ora('Understanding your request...').start();
      try {
        let intent = await aiParseIntent(text, { debug: Boolean(opts.debug) });
        spinner.succeed('Intent parsed');

        if (opts.debug) {
          console.log(chalk.gray('\nParsed Intent:'));
          console.log(JSON.stringify(intent, null, 2));
        }

        let validation = await validateIntent(intent, config);
        if (!validation.valid) {
          spinner.stop();
          printValidationIssues(validation);
          const completed = await askForMissingFields(intent, validation);
          intent = { ...intent, ...completed };
          validation = await validateIntent(intent, config);
          if (!validation.valid) {
            printValidationIssues(validation);
            console.error(chalk.red('\nx Still invalid after completion. Aborting.'));
            process.exit(1);
          }
        }

        printWarnings(validation.warnings);

        const risk = riskForIntent(intent);
        const mustConfirm = risk === 'high';
        const shouldConfirm = mustConfirm || !opts.yes;
        if (!opts.yes && !process.stdout.isTTY) {
          console.error(chalk.red('x Refusing to execute without confirmation in non-interactive mode.'));
          process.exit(1);
        }

        if (shouldConfirm) {
          if (opts.yes && mustConfirm) {
            console.log(chalk.yellow('\nHigh-risk action detected. Confirmation is still required.\n'));
          }
          const confirmation = await showConfirmation(intent, { useInk: Boolean(opts.ink) });
          if (!confirmation.confirmed) {
            console.log(chalk.yellow('\nx Cancelled by user.'));
            process.exit(0);
          }
          intent = confirmation.intent;
        }

        console.log(chalk.cyan('\nExecuting...'));
        const result = await executeIntent(intent, config);
        if (result.success) {
          console.log(chalk.green(`\nOK Success! (${result.metadata.executionTime}ms)`));
          if (opts.json) {
            console.log(JSON.stringify(result.data, null, 2));
          } else {
            formatResult(result, intent.action);
          }

          if (result.metadata) {
            console.log(chalk.gray('\nMetadata:'));
            if (result.metadata.apiCalls !== undefined) {
              console.log(chalk.gray(`  API calls: ${result.metadata.apiCalls}`));
            }
            if (result.metadata.cost) {
              console.log(chalk.gray(`  Est. cost: ${result.metadata.cost}`));
            }
          }
          return;
        }

        console.error(chalk.red('\nx Failed:'), result.error);
        if (opts.debug && result.details) {
          console.log(chalk.gray('\nDebug details:'));
          console.log(JSON.stringify(result.details, null, 2));
        }
        process.exit(1);
      } catch (error) {
        spinner.fail('Error');
        console.error(chalk.red('\nx Unexpected error:'), error.message);
        if (opts.debug) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}

module.exports = registerAiCommands;

const chalk = require('chalk');
const inquirer = require('inquirer');
const { runAgent, memoryCommands } = require('../lib/agent');

function registerAgentCommands(program) {
  const agent = program
    .command('agent')
    .description('Meta DevOps co-pilot (safe, tool-based, with scoped memory)')
    .argument('[intent...]', 'Intent to plan+execute (e.g. "fix whatsapp webhook for clientA")')
    .option('--scope <scope>', 'Memory scope (overrides auto-detection)')
    .option('--no-memory', 'Disable auto-loading/saving memory')
    .option('--provider <provider>', 'LLM provider: openai|anthropic|openrouter|xai|ollama|gemini', 'openai')
    .option('--model <model>', 'LLM model (provider-specific)')
    .option('--json', 'JSON output (plan + results)')
    .option('--yes', 'Auto-approve plan (still prompts for high-risk steps)')
    .option('--plan-only', 'Generate plan only (no execution)')
    .action(async (intentParts, options) => {
      const intent = (intentParts || []).join(' ').trim();
      if (!intent) {
        console.log(chalk.yellow('\nProvide an intent, or use memory subcommands.\n'));
        agent.help();
        return;
      }
      await runAgent({ intent, options });
    });

  const mem = agent.command('memory').description('Manage agent memory scopes');

  mem
    .command('list')
    .description('List available memory scopes')
    .option('--json', 'JSON output')
    .action(async (options) => {
      await memoryCommands.list({ json: Boolean(options.json) });
    });

  mem
    .command('show <scope>')
    .description('Show summary and recent memory entries for a scope')
    .option('--json', 'JSON output')
    .option('--limit <n>', 'How many recent entries to show', '20')
    .action(async (scope, options) => {
      await memoryCommands.show({
        scope,
        json: Boolean(options.json),
        limit: parseInt(options.limit, 10)
      });
    });

  mem
    .command('forget <scope>')
    .description('Delete a scope memory folder')
    .action(async (scope) => {
      const ans = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'ok',
          default: false,
          message: `Delete ALL agent memory for scope "${scope}"?`
        }
      ]);
      if (!ans.ok) return;
      await memoryCommands.forget({ scope });
    });

  mem
    .command('clear')
    .description('Delete all scope memory folders')
    .action(async () => {
      const ans1 = await inquirer.prompt([
        { type: 'confirm', name: 'ok', default: false, message: 'Delete ALL agent memory for ALL scopes?' }
      ]);
      if (!ans1.ok) return;
      const ans2 = await inquirer.prompt([
        { type: 'confirm', name: 'ok', default: false, message: 'Really sure? This cannot be undone.' }
      ]);
      if (!ans2.ok) return;
      await memoryCommands.clear();
    });
}

module.exports = registerAgentCommands;

const path = require('path');
const { spawn } = require('child_process');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const config = require('../lib/config');
const { renderPanel, kv, formatBadge, mint } = require('../lib/ui/chrome');
const { normalizeProvider, defaultModelForProvider, resolveApiKeyForProvider } = require('../lib/llm-providers');

const PROVIDER_CHOICES = [
  { name: 'OpenAI', value: 'openai', env: 'OPENAI_API_KEY' },
  { name: 'OpenRouter', value: 'openrouter', env: 'OPENROUTER_API_KEY' },
  { name: 'xAI (Grok)', value: 'xai', env: 'XAI_API_KEY' },
  { name: 'Anthropic (Claude)', value: 'anthropic', env: 'ANTHROPIC_API_KEY' },
  { name: 'Google Gemini', value: 'gemini', env: 'GEMINI_API_KEY' }
];

function providerMeta(provider) {
  const normalized = normalizeProvider(provider);
  return PROVIDER_CHOICES.find((x) => x.value === normalized) || PROVIDER_CHOICES[0];
}

function runSubprocess(args, opts = {}) {
  const capture = Boolean(opts.capture);
  return new Promise((resolve, reject) => {
    const binPath = path.join(__dirname, '..', 'bin', 'social.js');
    const child = spawn(process.execPath, [binPath, '--no-banner', ...args], {
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      env: process.env
    });

    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`social ${args.join(' ')} exited with code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function makeSpinner(text) {
  if (!process.stdout.isTTY) return null;
  return ora({ text }).start();
}

function flushCaptured(output) {
  const out = String(output?.stdout || '');
  const err = String(output?.stderr || '');
  if (out) process.stdout.write(out);
  if (err) process.stderr.write(err);
}

function printStartHereHeader(profile, defaultApi, hasToken, hasAgent) {
  const rows = [
    kv('Profile', chalk.cyan(profile), { labelWidth: 16 }),
    kv('Default API', chalk.cyan(defaultApi || 'facebook'), { labelWidth: 16 }),
    kv('Token Ready', hasToken ? formatBadge('YES', { tone: 'success' }) : formatBadge('NO', { tone: 'warn' }), { labelWidth: 16 }),
    kv('AI Ready', hasAgent ? formatBadge('YES', { tone: 'success' }) : formatBadge('NO', { tone: 'warn' }), { labelWidth: 16 }),
    '',
    chalk.gray('This flow configures AI provider + key + model, then runs setup and health verification.')
  ];

  console.log('');
  console.log(renderPanel({
    title: ' Start-Here Unified Flow ',
    rows,
    minWidth: 92,
    borderColor: (value) => chalk.cyan(value)
  }));
  console.log('');
}

async function chooseProvider(defaultProvider, quick) {
  if (!process.stdout.isTTY || !process.stdin.isTTY || quick) return normalizeProvider(defaultProvider);
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Choose AI provider:',
      default: normalizeProvider(defaultProvider),
      choices: PROVIDER_CHOICES.map((x) => ({ name: x.name, value: x.value }))
    }
  ]);
  return normalizeProvider(answer.provider);
}

async function promptAiConfig({ provider, key, model, quick }) {
  const meta = providerMeta(provider);
  const defaultModel = String(model || defaultModelForProvider(provider)).trim();
  const hasKey = Boolean(String(key || '').trim());

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return {
      key: String(key || '').trim(),
      model: defaultModel,
      save: true
    };
  }

  if (!quick) {
    console.log(chalk.cyan(`\n[AI] ${meta.name}`));
    console.log(chalk.gray(`If you don't have a key in profile/env, set ${meta.env} or enter it below.`));
  }

  const questions = [];
  if (!hasKey) {
    questions.push({
      type: 'password',
      name: 'apiKey',
      mask: '*',
      message: `Enter ${meta.name} API key:`,
      validate: (value) => Boolean(String(value || '').trim()) || 'API key cannot be empty'
    });
  }
  questions.push({
    type: 'input',
    name: 'model',
    default: defaultModel,
    message: `Model for ${meta.name}:`,
    filter: (value) => String(value || '').trim()
  });
  questions.push({
    type: 'confirm',
    name: 'save',
    default: true,
    message: `Save ${meta.name} provider/key/model to active profile?`
  });

  const answers = questions.length ? await inquirer.prompt(questions) : { save: true, model: defaultModel };
  return {
    key: String(answers.apiKey || key || '').trim(),
    model: String(answers.model || defaultModel).trim() || defaultModel,
    save: Boolean(answers.save)
  };
}

function registerStartHereCommand(program) {
  const defaultHost = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
  const defaultPort = process.env.PORT || '1310';

  program
    .command('start-here')
    .description('Unified first-run flow: AI config + setup + health verification')
    .option('--provider <provider>', 'AI provider: openai|openrouter|xai|anthropic|gemini')
    .option('--model <model>', 'AI model override')
    .option('--api-key <key>', 'AI API key override')
    .option('--skip-ai', 'Skip AI provider/key/model setup', false)
    .option('--quick', 'Run with fewer prompts', false)
    .option('--skip-app', 'Skip App ID/App Secret setup during social setup', false)
    .option('--no-start', 'Do not auto-start gateway during setup')
    .option('--host <host>', 'Gateway host', defaultHost)
    .option('--port <port>', 'Gateway port', defaultPort)
    .action(async (opts) => {
      const activeProfile = config.getActiveProfile();
      const defaultApi = config.getDefaultApi();
      const agentCfg = typeof config.getAgentConfig === 'function' ? config.getAgentConfig() : {};
      const anyToken = Boolean(config.hasToken('facebook') || config.hasToken('instagram') || config.hasToken('whatsapp'));
      const hasAgentReady = Boolean(String(agentCfg.apiKey || '').trim() && String(agentCfg.model || '').trim());

      printStartHereHeader(activeProfile, defaultApi, anyToken, hasAgentReady);

      if (!opts.skipAi) {
        let provider = normalizeProvider(opts.provider || agentCfg.provider || 'openai');
        provider = await chooseProvider(provider, Boolean(opts.quick));
        const resolvedExistingKey = String(
          opts.apiKey
          || resolveApiKeyForProvider(provider, agentCfg.provider === provider ? agentCfg.apiKey : '')
          || ''
        ).trim();
        const resolvedModel = String(opts.model || (agentCfg.provider === provider ? agentCfg.model : '') || defaultModelForProvider(provider)).trim();
        const ai = await promptAiConfig({
          provider,
          key: resolvedExistingKey,
          model: resolvedModel,
          quick: Boolean(opts.quick)
        });

        if (!ai.key) {
          const hint = providerMeta(provider);
          console.error(chalk.red('\nMissing AI API key.'));
          console.error(chalk.gray(`Provide --api-key, set ${hint.env}, or rerun in an interactive terminal.\n`));
          process.exit(1);
        }

        if (ai.save) {
          config.setAgentProvider(provider);
          config.setAgentApiKey(ai.key);
          config.setAgentModel(ai.model);
          console.log(chalk.green(`Saved AI config: ${provider} / ${ai.model}\n`));
        } else {
          console.log(chalk.yellow('AI config not saved to profile.\n'));
        }
      } else {
        console.log(chalk.gray('Skipping AI config step (--skip-ai).\n'));
      }

      const setupArgs = ['setup'];
      if (opts.quick) setupArgs.push('--quick');
      if (opts.skipApp) setupArgs.push('--skip-app');
      if (opts.start === false) setupArgs.push('--no-start');
      setupArgs.push('--host', String(opts.host || defaultHost));
      setupArgs.push('--port', String(opts.port || defaultPort));

      console.log(chalk.cyan('[1/2] Running guided setup\n'));
      await runSubprocess(setupArgs);

      console.log(chalk.cyan('[2/2] Verifying runtime + readiness\n'));
      const verifySpinner = makeSpinner('Checking runtime + readiness...');
      try {
        const verifyOut = await runSubprocess(['status'], { capture: true });
        if (verifySpinner) verifySpinner.succeed('Runtime + readiness check complete');
        flushCaptured(verifyOut);
      } catch (error) {
        if (verifySpinner) verifySpinner.fail('Runtime + readiness check failed');
        flushCaptured(error);
        throw error;
      }

      console.log(chalk.green('Start-here flow complete.'));
      console.log(chalk.gray(`Next: ${mint('social hatch')} for conversational operations, or ${mint('social studio')} for browser status.\n`));
    });
}

module.exports = registerStartHereCommand;

#!/usr/bin/env node

const { Command } = require('commander');
const packageJson = require('../package.json');
const { getBanner } = require('../lib/banner');
const config = require('../lib/config');
const { startLauncherMenu } = require('../lib/ui/launcher-menu');
const i18n = require('../lib/i18n');

const program = new Command();

function getArgValue(name) {
  // Supports: --flag value, --flag=value
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('-')) return process.argv[idx + 1];
  const pref = name + '=';
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : '';
}

function hasArg(name) {
  return process.argv.includes(name) || process.argv.some((a) => a.startsWith(name + '='));
}

function getChalkForBanner() {
  const chalkLib = require('chalk'); // eslint-disable-line global-require

  const noColor = Boolean(process.env.NO_COLOR) || hasArg('--no-color');
  const forceColor = Boolean(process.env.FORCE_COLOR) || hasArg('--color') || hasArg('--force-color');

  if (noColor) return new chalkLib.Instance({ level: 0 });
  if (forceColor) return new chalkLib.Instance({ level: 3 });

  const level = chalkLib.supportsColor ? chalkLib.supportsColor.level : 0;
  return new chalkLib.Instance({ level });
}

// Apply profile override early so all commands use the right config/profile.
try {
  const profile = getArgValue('--profile');
  if (profile) config.useProfile(profile);
} catch (e) {
  // Don't crash on unknown profile before help; show a friendly error later.
}

try {
  const lang = getArgValue('--lang');
  if (lang) i18n.setLanguage(lang);
  else if (process.env.SOCIAL_LANG) i18n.setLanguage(process.env.SOCIAL_LANG);
} catch (e) {
  // Ignore invalid language and fall back to english.
}

function showBanner() {
  const chalk = getChalkForBanner();

  const styleArg = getArgValue('--banner-style');
  const style = (styleArg || process.env.SOCIAL_CLI_BANNER_STYLE || process.env.META_CLI_BANNER_STYLE || 'classic').toLowerCase();
  const banner = getBanner(style);

  const lines = String(banner).split('\n');
  const palette = [
    (s) => chalk.cyanBright(s),
    (s) => chalk.blueBright(s),
    (s) => chalk.cyan(s),
    (s) => chalk.blue(s),
    (s) => chalk.cyanBright(s)
  ];
  const colored = lines.map((l, i) => palette[i % palette.length](l)).join('\n');

  console.log(colored);
  console.log(chalk.yellow('For devs tired of token gymnastics'));
  console.log(chalk.green('Built by Chaos Craft Labs.'));
  console.log('');
}

const shouldShowBanner = process.argv.length <= 2 ||
  process.argv.includes('--help') ||
  process.argv.includes('-h');

if (shouldShowBanner && !process.argv.includes('--no-banner')) {
  showBanner();
}

program
  .name('social')
  .description('Social API CLI for Meta APIs (Facebook, Instagram, WhatsApp).')
  .option('--profile <name>', 'Use a profile (multi-account). Does not persist; use `social accounts switch` to persist.')
  .option('--lang <code>', 'UI language (en|hi). You can also set SOCIAL_LANG.', process.env.SOCIAL_LANG || 'en')
  .option('--no-banner', 'Disable the startup banner')
  .option('--banner-style <style>', 'Banner style: classic|slant|clean|compact', process.env.SOCIAL_CLI_BANNER_STYLE || process.env.META_CLI_BANNER_STYLE || 'classic')
  .option('--color', 'Force colored output (overrides auto-detection)')
  .option('--no-color', 'Disable colored output')
  .version(packageJson.version);

// Import command modules (after profile override is applied)
const authCommands = require('../commands/auth');
const queryCommands = require('../commands/query');
const appCommands = require('../commands/app');
const limitsCommands = require('../commands/limits');
const postCommands = require('../commands/post');
const whatsappCommands = require('../commands/whatsapp');
const instagramCommands = require('../commands/instagram');
const utilsCommands = require('../commands/utils');
const doctorCommands = require('../commands/doctor');
const agentCommands = require('../commands/agent');
const marketingCommands = require('../commands/marketing');
const accountsCommands = require('../commands/accounts');
const batchCommands = require('../commands/batch');
const aiCommands = require('../commands/ai');
const chatCommands = require('../commands/chat');
const gatewayCommands = require('../commands/gateway');
const opsCommands = require('../commands/ops');
const hubCommands = require('../commands/hub');
const tuiCommands = require('../commands/tui');
const onboardCommands = require('../commands/onboard');
const studioCommands = require('../commands/studio');
const integrationsCommands = require('../commands/integrations');
const policyCommands = require('../commands/policy');

// Register command groups
authCommands(program);
queryCommands(program);
appCommands(program);
limitsCommands(program);
postCommands(program);
whatsappCommands(program);
instagramCommands(program);
utilsCommands(program);
doctorCommands(program);
agentCommands(program);
marketingCommands(program);
accountsCommands(program);
batchCommands(program);
aiCommands(program);
chatCommands(program);
gatewayCommands(program);
opsCommands(program);
hubCommands(program);
tuiCommands(program);
onboardCommands(program);
studioCommands(program);
integrationsCommands(program);
policyCommands(program);

// Custom help
program.on('--help', () => {
  const chalk = getChalkForBanner();
  const cmd = (text) => `${chalk.cyan('social')} ${text}`;
  console.log('');
  console.log(chalk.yellow('Examples:'));
  console.log(`  ${cmd('auth login')}              ` + chalk.gray('# Authenticate API access'));
  console.log(`  ${cmd('query me')}                ` + chalk.gray('# Get your profile info'));
  console.log(`  ${cmd('app info')}                ` + chalk.gray('# View app configuration'));
  console.log(`  ${cmd('limits check')}            ` + chalk.gray('# Check rate limits'));
  console.log(`  ${cmd('post create --message "Hello" --page PAGE_ID')}  ` + chalk.gray('# Create a Page post'));
  console.log(`  ${cmd('whatsapp send --from PHONE_ID --to +15551234567 --body "Hello"')}  ` + chalk.gray('# Send a WhatsApp message'));
  console.log(`  ${cmd('instagram accounts list')} ` + chalk.gray('# List connected IG accounts'));
  console.log(`  ${cmd('utils config show')}       ` + chalk.gray('# Show config + defaults'));
  console.log(`  ${cmd('doctor')}                  ` + chalk.gray('# Quick diagnostics (config + setup hints)'));
  console.log(`  ${cmd('onboard')}                 ` + chalk.gray('# Interactive onboarding wizard'));
  console.log(`  ${cmd('agent "fix whatsapp webhook for clientA"')}  ` + chalk.gray('# Plan first, then execute with confirmation'));
  console.log(`  ${cmd('marketing accounts')}      ` + chalk.gray('# List ad accounts'));
  console.log(`  ${cmd('accounts add clientA')}    ` + chalk.gray('# Create a profile'));
  console.log(`  ${cmd('--profile clientA query me')}  ` + chalk.gray('# Use a profile (one-off)'));
  console.log(`  ${cmd('batch run jobs.json')}     ` + chalk.gray('# Run a batch of tool jobs'));
  console.log(`  ${cmd('ai "show my Facebook pages"')}  ` + chalk.gray('# Natural-language Meta command'));
  console.log(`  ${cmd('chat')}                    ` + chalk.gray('# Conversational multi-turn AI assistant'));
  console.log(`  ${cmd('tui')}                     ` + chalk.gray('# Agentic terminal dashboard (chat + approvals + replay)'));
  console.log(`  ${cmd('hatch')}                   ` + chalk.gray('# Alias of tui (terminal agent chat)'));
  console.log(`  ${cmd('gateway --open')}          ` + chalk.gray('# Social API Gateway web UI + API gateway'));
  console.log(`  ${cmd('studio')}                  ` + chalk.gray('# Social Studio (web UI command alias)'));
  console.log(`  ${cmd('integrations connect waba')}  ` + chalk.gray('# Guided WABA integration setup + checks'));
  console.log(`  ${cmd('policy preflight "send whatsapp promo"')}  ` + chalk.gray('# Region-aware policy checks before execution'));
  console.log(`  ${cmd('ops morning-run --all-workspaces --spend 320')}  ` + chalk.gray('# Morning agency ops checks + approvals'));
  console.log(`  ${cmd('ops handoff --workspace clientA --out ./handoff-clientA.md')}  ` + chalk.gray('# Generate team onboarding + runbook handoff'));
  console.log(`  ${cmd('ops handoff --workspace clientA --template enterprise --out ./handoff-clientA-enterprise.md')}  ` + chalk.gray('# Generate enterprise handoff template'));
  console.log(`  ${cmd('ops handoff pack --workspace clientA --out-dir ./handoff-clientA --template enterprise')}  ` + chalk.gray('# Generate full agency handoff pack'));
  console.log(`  ${cmd('ops invite create --workspace clientA --role operator --expires-in 72')}  ` + chalk.gray('# Create invite token for onboarding'));
  console.log(`  ${cmd('ops invite create --workspace clientA --role operator --base-url http://127.0.0.1:1310')}  ` + chalk.gray('# Create shareable Studio invite link'));
  console.log(`  ${cmd('hub search ops')}          ` + chalk.gray('# Search hub packages (connectors/playbooks/skills)'));
  console.log(`  ${cmd('hub trust show')}          ` + chalk.gray('# Inspect package trust policy and keys'));
  console.log('');
  console.log(chalk.cyan('Documentation: https://github.com/vishalgojha/social-CLI'));
});

async function main() {
  await program.parseAsync(process.argv);

  // OpenClaw-style launcher when invoked with no command.
  if (!process.argv.slice(2).length && process.stdout.isTTY) {
    await startLauncherMenu(__filename);
  } else if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(String((error && error.stack) || error));
  process.exit(1);
});

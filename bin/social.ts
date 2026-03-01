#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const packageJson = require('../package.json');
const { getBanner } = require('../lib/banner');
const config = require('../lib/config');
const { startLauncherMenu } = require('../lib/ui/launcher-menu');
const { renderPanel, mint } = require('../lib/ui/chrome');
const i18n = require('../lib/i18n');

const program = new Command();
const localRoot = path.resolve(__dirname, '..');
const repoRoot = fs.existsSync(path.join(localRoot, 'dist-runtime'))
  ? localRoot
  : path.resolve(localRoot, '..');

function loadCommandModule(name) {
  const localRuntimePath = path.join(localRoot, 'src-runtime', 'commands', `${name}.js`);
  if (fs.existsSync(localRuntimePath)) {
    return require(localRuntimePath); // eslint-disable-line global-require
  }

  const distPath = path.join(repoRoot, 'dist-runtime', 'commands', `${name}.js`);
  if (fs.existsSync(distPath)) {
    return require(distPath); // eslint-disable-line global-require
  }

  const compiledLegacyPath = path.join(localRoot, 'commands', `${name}.js`);
  if (fs.existsSync(compiledLegacyPath)) {
    return require(compiledLegacyPath); // eslint-disable-line global-require
  }

  const sourceLegacyPath = path.join(repoRoot, 'commands', `${name}.ts`);
  if (fs.existsSync(sourceLegacyPath)) {
    return require(sourceLegacyPath); // eslint-disable-line global-require
  }

  const sourceRuntimePath = path.join(repoRoot, 'src-runtime', 'commands', `${name}.ts`);
  if (fs.existsSync(sourceRuntimePath)) {
    return require(sourceRuntimePath); // eslint-disable-line global-require
  }

  throw new Error(`Command module not found: ${name}`);
}

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
  const mintBanner = (s) => chalk.hex('#66FFCC')(s);
  const colored = lines.map((l) => mintBanner(l)).join('\n');
  let activeProfile = 'default';
  let defaultApi = 'facebook';
  try {
    activeProfile = config.getActiveProfile();
    defaultApi = config.getDefaultApi();
  } catch {
    // Keep banner rendering best-effort even if config is unavailable.
  }

  console.log(colored);
  console.log(renderPanel({
    title: ' Social Flow Command Deck ',
    rows: [
      `${mint('Profile:')} ${chalk.white(activeProfile)}   ${mint('Version:')} ${chalk.white(packageJson.version)}`,
      `${mint('Default API:')} ${chalk.white(defaultApi)}   ${mint('Mode:')} ${chalk.white('terminal-native')}`,
      chalk.gray('Meta Operations Control Plane for Facebook, Instagram, WhatsApp, and Ads Manager.')
    ],
    minWidth: 64,
    borderColor: (value) => mint(value)
  }));
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
  .description('Meta Operations Control Plane with CLI, chat, gateway APIs, and SDK integration.')
  .option('--profile <name>', 'Use a profile (multi-account). Does not persist; use `social accounts switch` to persist.')
  .option('--lang <code>', 'UI language (en|hi). You can also set SOCIAL_LANG.', process.env.SOCIAL_LANG || 'en')
  .option('--no-banner', 'Disable the startup banner')
  .option('--banner-style <style>', 'Banner style: classic|slant|clean|compact', process.env.SOCIAL_CLI_BANNER_STYLE || process.env.META_CLI_BANNER_STYLE || 'classic')
  .option('--color', 'Force colored output (overrides auto-detection)')
  .option('--no-color', 'Disable colored output')
  .version(packageJson.version);

// Import command modules (after profile override is applied)
const authCommands = loadCommandModule('auth');
const queryCommands = loadCommandModule('query');
const facebookCommands = loadCommandModule('facebook');
const appCommands = loadCommandModule('app');
const limitsCommands = loadCommandModule('limits');
const postCommands = loadCommandModule('post');
const whatsappCommands = loadCommandModule('whatsapp');
const instagramCommands = loadCommandModule('instagram');
const utilsCommands = loadCommandModule('utils');
const doctorCommands = loadCommandModule('doctor');
const agentCommands = loadCommandModule('agent');
const marketingCommands = loadCommandModule('marketing');
const accountsCommands = loadCommandModule('accounts');
const batchCommands = loadCommandModule('batch');
const aiCommands = loadCommandModule('ai');
const chatCommands = loadCommandModule('chat');
const gatewayCommands = loadCommandModule('gateway');
const opsCommands = loadCommandModule('ops');
const hubCommands = loadCommandModule('hub');
const tuiCommands = loadCommandModule('tui');
const onboardCommands = loadCommandModule('onboard');
const integrationsCommands = loadCommandModule('integrations');
const policyCommands = loadCommandModule('policy');
const setupCommands = loadCommandModule('setup');
const startCommands = loadCommandModule('start');
const stopCommands = loadCommandModule('stop');
const statusCommands = loadCommandModule('status');
const logsCommands = loadCommandModule('logs');
const studioCommands = loadCommandModule('studio');
const guideCommands = loadCommandModule('guide');
const startHereCommands = loadCommandModule('start-here');
const industryCommands = loadCommandModule('industry');
const explainCommands = loadCommandModule('explain');

// Register command groups
authCommands(program);
queryCommands(program);
facebookCommands(program);
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
integrationsCommands(program);
policyCommands(program);
setupCommands(program);
startCommands(program);
stopCommands(program);
statusCommands(program);
logsCommands(program);
studioCommands(program);
guideCommands(program);
startHereCommands(program);
industryCommands(program);
explainCommands(program);

// Custom help
program.on('--help', () => {
  const chalk = getChalkForBanner();
  const cmd = (text) => `${mint('social')} ${text}`;
  console.log('');
  console.log(chalk.gray('Legend: [options] are optional flags, [command] is the action you want to run.'));
  console.log(chalk.gray(`Try: ${cmd('<command> --help')} for command-specific flags.\n`));
  console.log(chalk.yellow('Examples:'));
  console.log(`  ${cmd('auth login')}              ` + chalk.gray('# Authenticate API access'));
  console.log(`  ${cmd('explain syntax')}          ` + chalk.gray('# Understand [options], <values>, aliases, and examples'));
  console.log(`  ${cmd('explain starter')}         ` + chalk.gray('# Beginner starter bundle (lowest cognitive load)'));
  console.log(`  ${cmd('facebook me')}             ` + chalk.gray('# Facebook-focused profile shortcut'));
  console.log(`  ${cmd('facebook pages --table')}  ` + chalk.gray('# Facebook Pages via dedicated category'));
  console.log(`  ${cmd('query me')}                ` + chalk.gray('# Get your profile info'));
  console.log(`  ${cmd('app info')}                ` + chalk.gray('# View app configuration'));
  console.log(`  ${cmd('limits check')}            ` + chalk.gray('# Check rate limits'));
  console.log(`  ${cmd('post create --message "Hello" --page PAGE_ID')}  ` + chalk.gray('# Create a Page post'));
  console.log(`  ${cmd('whatsapp send --from PHONE_ID --to +15551234567 --body "Hello"')}  ` + chalk.gray('# Send a WhatsApp message'));
  console.log(`  ${cmd('waba send --from PHONE_ID --to +15551234567 --body "Hello"')}  ` + chalk.gray('# WhatsApp alias category (waba)'));
  console.log(`  ${cmd('insta accounts list')}     ` + chalk.gray('# Instagram alias category (insta)'));
  console.log(`  ${cmd('utils config show')}       ` + chalk.gray('# Show config + defaults'));
  console.log(`  ${cmd('doctor')}                  ` + chalk.gray('# Quick diagnostics (config + setup hints)'));
  console.log(`  ${cmd('onboard')}                 ` + chalk.gray('# Interactive onboarding wizard'));
  console.log(`  ${cmd('agent "fix whatsapp webhook for clientA"')}  ` + chalk.gray('# Plan first, then execute with confirmation'));
  console.log(`  ${cmd('marketing accounts')}      ` + chalk.gray('# List ad accounts'));
  console.log(`  ${cmd('marketing portfolio --preset last_7d --target-daily 250')}  ` + chalk.gray('# Agency portfolio pacing + risk snapshot across profiles'));
  console.log(`  ${cmd('marketing diagnose-poor-ads --preset last_7d --top 15')}  ` + chalk.gray('# Flag likely poor ads and estimate spend at risk'));
  console.log(`  ${cmd('accounts add clientA')}    ` + chalk.gray('# Create a profile'));
  console.log(`  ${cmd('--profile clientA query me')}  ` + chalk.gray('# Use a profile (one-off)'));
  console.log(`  ${cmd('batch run jobs.json')}     ` + chalk.gray('# Run a batch of tool jobs'));
  console.log(`  ${cmd('ai "show my Facebook pages"')}  ` + chalk.gray('# Natural-language Meta command'));
  console.log(`  ${cmd('chat')}                    ` + chalk.gray('# Conversational multi-turn AI assistant'));
  console.log(`  ${cmd('tui')}                     ` + chalk.gray('# Agentic terminal dashboard (chat + approvals + replay)'));
  console.log(`  ${cmd('hatch')}                   ` + chalk.gray('# Alias of tui (terminal agent chat)'));
  console.log(`  ${cmd('gateway')}                 ` + chalk.gray('# Social API/WebSocket Gateway'));
  console.log(`  ${cmd('setup')}                   ` + chalk.gray('# Guided first-run setup + optional gateway start'));
  console.log(`  ${cmd('start')}                   ` + chalk.gray('# Start gateway in background with readiness checks'));
  console.log(`  ${cmd('stop')}                    ` + chalk.gray('# Stop background gateway'));
  console.log(`  ${cmd('status')}                  ` + chalk.gray('# Runtime status + setup readiness'));
  console.log(`  ${cmd('logs --lines 120')}        ` + chalk.gray('# Show gateway logs'));
  console.log(`  ${cmd('studio')}                  ` + chalk.gray('# Open gateway status page (browser)'));
  console.log(`  ${cmd('studio --url https://api.example.com --frontend-url https://studio.example.com')}  ` + chalk.gray('# Open external frontend against remote gateway'));
  console.log(`  ${cmd('guide')}                   ` + chalk.gray('# Universal step-by-step guidance sequence'));
  console.log(`  ${cmd('start-here')}              ` + chalk.gray('# Unified setup: AI config + tokens + health verification'));
  console.log(`  ${cmd('industry detect')}         ` + chalk.gray('# Hybrid industry detection + confidence'));
  console.log(`  ${cmd('industry set real_estate')}  ` + chalk.gray('# Manual industry override + lock'));
  console.log(`  ${cmd('integrations connect waba')}  ` + chalk.gray('# Guided WABA integration setup + checks'));
  console.log(`  ${cmd('policy preflight "send whatsapp promo"')}  ` + chalk.gray('# Region-aware policy checks before execution'));
  console.log(`  ${cmd('ops morning-run --all-workspaces --spend 320')}  ` + chalk.gray('# Morning agency ops checks + approvals'));
  console.log(`  ${cmd('ops handoff --workspace clientA --out ./handoff-clientA.md')}  ` + chalk.gray('# Generate team onboarding + runbook handoff'));
  console.log(`  ${cmd('ops handoff --workspace clientA --template enterprise --out ./handoff-clientA-enterprise.md')}  ` + chalk.gray('# Generate enterprise handoff template'));
  console.log(`  ${cmd('ops handoff pack --workspace clientA --out-dir ./handoff-clientA --template enterprise')}  ` + chalk.gray('# Generate full agency handoff pack'));
  console.log(`  ${cmd('ops invite create --workspace clientA --role operator --expires-in 72')}  ` + chalk.gray('# Create invite token for onboarding'));
  console.log(`  ${cmd('ops invite create --workspace clientA --role operator --base-url http://127.0.0.1:1310')}  ` + chalk.gray('# Create shareable Studio invite link'));
  console.log(`  ${cmd('ops invite resend --workspace clientA --id <INVITE_ID> --base-url http://127.0.0.1:1310')}  ` + chalk.gray('# Rotate invite token and issue new link'));
  console.log(`  ${cmd('ops report weekly --workspace clientA --out ./reports/clientA-weekly.md')}  ` + chalk.gray('# Generate weekly agency admin report'));
  console.log(`  ${cmd('hub search ops')}          ` + chalk.gray('# Search hub packages (connectors/playbooks/skills)'));
  console.log(`  ${cmd('hub trust show')}          ` + chalk.gray('# Inspect package trust policy and keys'));
  console.log('');
  console.log(mint('Documentation: https://github.com/vishalgojha/social-flow'));
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

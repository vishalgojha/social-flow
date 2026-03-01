const chalk = require('chalk');
const { renderPanel, mint } = require('../lib/ui/chrome');

function getSyntaxRows() {
  return [
    `${chalk.cyan('[options]')} = optional flags. Example: ${mint('social status --json')}`,
    `${chalk.cyan('<value>')} = required input. Example: ${mint('social facebook feed --page-id <id>')}`,
    `${chalk.cyan('a|b')} = either command works. Example: ${mint('social instagram')} or ${mint('social insta')}`,
    `${chalk.cyan('...')} = one or more words. Example: ${mint('social ai "show my pages"')}`,
    '',
    `Tip: run ${mint('social <command> --help')} for only that command's options.`
  ];
}

function getStarterRows() {
  return [
    `${chalk.bold('1. One-time setup')}: ${mint('social setup')}`,
    `${chalk.bold('2. Start service')}: ${mint('social start')}`,
    `${chalk.bold('3. Check health')}: ${mint('social status')}`,
    `${chalk.bold('4. Facebook basics')}: ${mint('social facebook me')} / ${mint('social facebook pages --table')}`,
    `${chalk.bold('5. Instagram basics')}: ${mint('social insta accounts list')}`,
    `${chalk.bold('6. WhatsApp basics')}: ${mint('social waba send --from PHONE_ID --to +1555... --body "Hi"')}`,
    `${chalk.bold('7. If something fails')}: ${mint('social logs --lines 120')}`
  ];
}

function getFacebookRows() {
  return [
    `${mint('social facebook login')}  ${chalk.gray('# token login')}`,
    `${mint('social facebook me')}  ${chalk.gray('# your profile')}`,
    `${mint('social facebook pages --table')}  ${chalk.gray('# list pages')}`,
    `${mint('social facebook feed --page-id <id>')}  ${chalk.gray('# list page posts')}`,
    `${mint('social facebook post --message "Hello" --page <id>')}  ${chalk.gray('# create page post')}`
  ];
}

function getInstagramRows() {
  return [
    `${mint('social insta accounts list')}  ${chalk.gray('# connected IG business accounts')}`,
    `${mint('social insta media list --ig-user-id <id>')}  ${chalk.gray('# list media')}`,
    `${mint('social insta comments list --media-id <id>')}  ${chalk.gray('# list comments')}`,
    `${mint('social insta publish --container-id <id> --ig-user-id <id>')}  ${chalk.gray('# publish container')}`
  ];
}

function getWabaRows() {
  return [
    `${mint('social waba send --from PHONE_ID --to +1555... --body "Hi"')}  ${chalk.gray('# send message')}`,
    `${mint('social waba templates list --business-id <id>')}  ${chalk.gray('# list templates')}`,
    `${mint('social waba phone-numbers list --business-id <id>')}  ${chalk.gray('# list phone numbers')}`,
    `${mint('social waba phone-numbers list --business-id <id> --set-default')}  ${chalk.gray('# save default sender')}`
  ];
}

function getRuntimeRows() {
  return [
    `${mint('social setup')}  ${chalk.gray('# guided first run')}`,
    `${mint('social start')}  ${chalk.gray('# start gateway')}`,
    `${mint('social status')}  ${chalk.gray('# readiness + health')}`,
    `${mint('social logs --lines 120')}  ${chalk.gray('# troubleshoot')}`,
    `${mint('social stop')}  ${chalk.gray('# stop gateway')}`,
    `${mint('social studio')}  ${chalk.gray('# open gateway status page')}`,
    `${mint('social studio --url https://api.example.com --frontend-url https://studio.example.com')}  ${chalk.gray('# remote gateway + external frontend')}`
  ];
}

function normalizeTopic(rawTopic) {
  const value = String(rawTopic || 'all').trim().toLowerCase();
  if (!value) return 'all';
  if (value === 'ig') return 'insta';
  if (value === 'instagram') return 'insta';
  if (value === 'whatsapp') return 'waba';
  if (value === 'setup') return 'runtime';
  return value;
}

function knownTopic(topic) {
  return ['all', 'syntax', 'starter', 'facebook', 'insta', 'waba', 'runtime'].includes(topic);
}

function printSection(title, rows) {
  console.log(renderPanel({
    title: ` ${title} `,
    rows,
    minWidth: 92,
    borderColor: (value) => chalk.cyan(value)
  }));
  console.log('');
}

function payloadForTopic(topic) {
  return {
    topic,
    syntax: getSyntaxRows(),
    starter: getStarterRows(),
    facebook: getFacebookRows(),
    insta: getInstagramRows(),
    waba: getWabaRows(),
    runtime: getRuntimeRows()
  };
}

function registerExplainCommand(program) {
  program
    .command('explain [topic]')
    .alias('simple')
    .description('Explain command syntax and show low-cognitive-load starter bundles')
    .option('--json', 'Output explainer content as JSON')
    .action((rawTopic, opts) => {
      const topic = normalizeTopic(rawTopic);
      if (!knownTopic(topic)) {
        console.error(chalk.red(`Unknown topic: ${rawTopic}`));
        console.error(chalk.gray(`Try: social explain syntax | starter | facebook | insta | waba | runtime`));
        process.exit(1);
      }

      const data = payloadForTopic(topic);
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log('');
      if (topic === 'all' || topic === 'syntax') printSection('Command Syntax Explainer', data.syntax);
      if (topic === 'all' || topic === 'starter') printSection('Starter Bundle (Lowest Cognitive Load)', data.starter);
      if (topic === 'all' || topic === 'runtime') printSection('Runtime Bundle', data.runtime);
      if (topic === 'all' || topic === 'facebook') printSection('Facebook Bundle', data.facebook);
      if (topic === 'all' || topic === 'insta') printSection('Instagram Bundle', data.insta);
      if (topic === 'all' || topic === 'waba') printSection('WhatsApp/WABA Bundle', data.waba);

      console.log(chalk.gray(`Next step: ${mint('social start-here')} for guided setup, or ${mint('social guide')}`));
      console.log('');
    });
}

module.exports = registerExplainCommand;

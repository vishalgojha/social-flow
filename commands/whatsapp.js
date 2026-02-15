const chalk = require('chalk');
const ora = require('ora');
const config = require('../lib/config');
const MetaAPIClient = require('../lib/api-client');

function registerWhatsAppCommands(program) {
  const whatsapp = program.command('whatsapp').description('WhatsApp Business (Cloud API)');

  whatsapp
    .command('send')
    .description('Send a WhatsApp text message')
    .requiredOption('--phone-number-id <id>', 'WhatsApp Phone Number ID')
    .requiredOption('--to <e164>', 'Recipient phone number in E.164 format (e.g. +15551234567)')
    .requiredOption('--message <text>', 'Message text')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const token = config.getToken('whatsapp');
      if (!token) {
        console.error(chalk.red('X No WhatsApp token found. Run: meta auth login -a whatsapp'));
        process.exit(1);
      }

      const { phoneNumberId, to, message, json } = options;

      const spinner = ora('Sending WhatsApp message...').start();
      const client = new MetaAPIClient(token, 'whatsapp');
      const result = await client.sendWhatsAppMessage(phoneNumberId, to, message);
      spinner.stop();

      if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.green('OK Message sent'));
      const msgId = result?.messages?.[0]?.id;
      if (msgId) console.log(chalk.cyan('  Message ID:'), msgId);
      console.log(chalk.cyan('  To:'), to);
      console.log('');
    });

  whatsapp
    .command('business')
    .description('Fetch WhatsApp Business Account (WABA) info')
    .requiredOption('--business-id <id>', 'WhatsApp Business Account ID (WABA ID)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const token = config.getToken('whatsapp');
      if (!token) {
        console.error(chalk.red('X No WhatsApp token found. Run: meta auth login -a whatsapp'));
        process.exit(1);
      }

      const { businessId, json } = options;

      const spinner = ora('Fetching WhatsApp business account...').start();
      const client = new MetaAPIClient(token, 'whatsapp');
      const data = await client.getWhatsAppBusinessAccount(businessId);
      spinner.stop();

      if (json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(chalk.bold('\nWhatsApp Business Account:'));
      console.log(chalk.gray('─'.repeat(50)));
      Object.entries(data || {}).forEach(([k, v]) => {
        console.log(chalk.cyan(`${k}:`), v);
      });
      console.log('');
    });
}

module.exports = registerWhatsAppCommands;


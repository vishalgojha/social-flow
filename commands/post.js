const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const config = require('../lib/config');
const MetaAPIClient = require('../lib/api-client');

function parseScheduleToUnixSeconds(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

async function pickFacebookPage(pages, defaultPageId) {
  const choices = pages.map((p) => ({
    name: `${p.name} (${p.id})`,
    value: p.id
  }));

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'pageId',
      message: 'Select a Facebook Page:',
      choices,
      default: defaultPageId && pages.findIndex((p) => p.id === defaultPageId) >= 0
        ? pages.findIndex((p) => p.id === defaultPageId)
        : 0
    }
  ]);

  return answers.pageId;
}

function registerPostCommands(program) {
  const post = program.command('post').description('Create and manage Facebook Page posts');

  post
    .command('set-default <pageId>')
    .description('Set the default Facebook Page ID used for posting')
    .action((pageId) => {
      config.setDefaultFacebookPageId(pageId);
      console.log(chalk.green(`✓ Default Facebook Page set to: ${pageId}`));
      console.log('');
    });

  post
    .command('create')
    .description('Create a Page post (message and/or link)')
    .option('-p, --page <pageId>', 'Facebook Page ID (defaults to configured)')
    .option('-m, --message <message>', 'Post message text')
    .option('-l, --link <url>', 'Link to attach')
    .option('--draft', 'Create an unpublished draft (published=false)')
    .option('--schedule <time>', 'Schedule publish time (unix seconds or ISO date)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const token = config.getToken('facebook');
      if (!token) {
        console.error(chalk.red('✖ No Facebook token found. Run: meta auth login -a facebook'));
        process.exit(1);
      }

      const { page: pageArg, message, link, draft, schedule, json } = options;
      const scheduledPublishTime = parseScheduleToUnixSeconds(schedule);

      if (schedule && !scheduledPublishTime) {
        console.error(chalk.red('✖ Invalid --schedule value. Use unix seconds or an ISO date/time.'));
        process.exit(1);
      }

      if (!message && !link) {
        console.error(chalk.red('✖ Provide at least one of: --message, --link'));
        process.exit(1);
      }

      const spinner = ora('Loading Pages...').start();
      const userClient = new MetaAPIClient(token, 'facebook');
      const pagesResult = await userClient.getFacebookPages();
      spinner.stop();

      const pages = pagesResult?.data || [];
      if (!pages.length) {
        console.error(chalk.red('✖ No Pages found for this token.'));
        console.error(chalk.gray('  Try: meta query pages --json'));
        process.exit(1);
      }

      const defaultPageId = config.getDefaultFacebookPageId();
      let pageId = pageArg || defaultPageId;

      if (!pageId) {
        pageId = await pickFacebookPage(pages, defaultPageId);
        config.setDefaultFacebookPageId(pageId);
        console.log(chalk.gray(`\nSaved default page: ${pageId}\n`));
      }

      const selected = pages.find((p) => p.id === pageId);
      if (!selected) {
        console.error(chalk.red(`✖ Page not found in /me/accounts: ${pageId}`));
        console.error(chalk.gray('  Run: meta query pages'));
        process.exit(1);
      }

      const pageAccessToken = selected.access_token;
      if (!pageAccessToken) {
        console.error(chalk.red('✖ Missing Page access_token in /me/accounts response.'));
        console.error(chalk.gray('  Ensure your token has permissions to list pages and includes access_token.'));
        process.exit(1);
      }

      const payload = {};
      if (message) payload.message = message;
      if (link) payload.link = link;

      if (scheduledPublishTime) {
        payload.published = false;
        payload.scheduled_publish_time = scheduledPublishTime;
        payload.unpublished_content_type = 'SCHEDULED';
      } else if (draft) {
        payload.published = false;
        payload.unpublished_content_type = 'DRAFT';
      }

      const postSpinner = ora('Creating post...').start();
      const pageClient = new MetaAPIClient(pageAccessToken, 'facebook');
      const result = await pageClient.post(`/${pageId}/feed`, payload);
      postSpinner.stop();

      if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.green('✓ Post created'));
      if (result?.id) console.log(chalk.cyan('  ID:'), result.id);
      console.log(chalk.cyan('  Page:'), `${selected.name} (${pageId})`);
      if (scheduledPublishTime) {
        console.log(chalk.cyan('  Scheduled:'), new Date(scheduledPublishTime * 1000).toLocaleString());
      }
      console.log('');
    });
}

module.exports = registerPostCommands;


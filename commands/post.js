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

  const defaultIndex = defaultPageId
    ? pages.findIndex((p) => p.id === defaultPageId)
    : -1;

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'pageId',
      message: 'Select a Facebook Page:',
      choices,
      default: defaultIndex >= 0 ? defaultIndex : 0
    }
  ]);

  return answers.pageId;
}

async function loadFacebookPages(userToken) {
  const spinner = ora('Loading Pages...').start();
  const userClient = new MetaAPIClient(userToken, 'facebook');
  const pagesResult = await userClient.getFacebookPages();
  spinner.stop();

  const pages = pagesResult?.data || [];
  if (!pages.length) {
    console.error(chalk.red('X No Pages found for this token.'));
    console.error(chalk.gray('  Try: meta query pages --json'));
    process.exit(1);
  }

  return pages;
}

async function resolvePageContext(userToken, pageArg) {
  const pages = await loadFacebookPages(userToken);

  const defaultPageId = config.getDefaultFacebookPageId();
  let pageId = pageArg || defaultPageId;

  if (!pageId) {
    pageId = await pickFacebookPage(pages, defaultPageId);
    config.setDefaultFacebookPageId(pageId);
    console.log(chalk.gray(`\nSaved default page: ${pageId}\n`));
  }

  const selected = pages.find((p) => p.id === pageId);
  if (!selected) {
    console.error(chalk.red(`X Page not found in /me/accounts: ${pageId}`));
    console.error(chalk.gray('  Run: meta post pages'));
    process.exit(1);
  }

  const pageAccessToken = selected.access_token;
  if (!pageAccessToken) {
    console.error(chalk.red('X Missing Page access_token in /me/accounts response.'));
    console.error(chalk.gray('  Ensure your token has permissions to list pages and includes access_token.'));
    process.exit(1);
  }

  return {
    pages,
    pageId,
    pageName: selected.name,
    pageAccessToken
  };
}

function printRequestDebug({ method, endpoint, payload }) {
  console.log(chalk.gray('\nRequest:'));
  console.log(chalk.gray(`  ${method} ${endpoint}`));
  if (payload && Object.keys(payload).length) {
    console.log(chalk.gray('Payload:'));
    console.log(JSON.stringify(payload, null, 2));
  }
  console.log('');
}

function registerPostCommands(program) {
  const post = program.command('post').description('Create and manage Facebook Page posts');

  post
    .command('set-default <pageId>')
    .description('Set the default Facebook Page ID used for posting')
    .action((pageId) => {
      config.setDefaultFacebookPageId(pageId);
      console.log(chalk.green(`OK Default Facebook Page set to: ${pageId}`));
      console.log('');
    });

  post
    .command('pages')
    .description('List Facebook Pages available to your token')
    .option('--json', 'Output as JSON')
    .option('--set-default', 'Interactively pick and save a default Page')
    .action(async (options) => {
      const token = config.getToken('facebook');
      if (!token) {
        console.error(chalk.red('X No Facebook token found. Run: meta auth login -a facebook'));
        process.exit(1);
      }

      const pages = await loadFacebookPages(token);
      const defaultPageId = config.getDefaultFacebookPageId();

      if (options.setDefault) {
        const picked = await pickFacebookPage(pages, defaultPageId);
        config.setDefaultFacebookPageId(picked);
        console.log(chalk.green(`OK Default Facebook Page set to: ${picked}`));
        console.log('');
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ data: pages }, null, 2));
        return;
      }

      console.log(chalk.bold('\nYour Facebook Pages:'));
      console.log(chalk.gray('─'.repeat(50)));
      pages.forEach((p, i) => {
        const isDefault = defaultPageId && p.id === defaultPageId;
        const marker = isDefault ? chalk.green('*') : ' ';
        console.log(`${marker} ${chalk.bold(`${i + 1}. ${p.name}`)}`);
        console.log(chalk.cyan('   ID:'), p.id);
      });
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
    .option('--dry-run', 'Print request details without calling the API')
    .option('--verbose', 'Print request details')
    .action(async (options) => {
      const token = config.getToken('facebook');
      if (!token) {
        console.error(chalk.red('X No Facebook token found. Run: meta auth login -a facebook'));
        process.exit(1);
      }

      const { page: pageArg, message, link, draft, schedule, json, dryRun, verbose } = options;
      const scheduledPublishTime = parseScheduleToUnixSeconds(schedule);

      if (schedule && !scheduledPublishTime) {
        console.error(chalk.red('X Invalid --schedule value. Use unix seconds or an ISO date/time.'));
        process.exit(1);
      }

      if (!message && !link) {
        console.error(chalk.red('X Provide at least one of: --message, --link'));
        process.exit(1);
      }

      const { pageId, pageName, pageAccessToken } = await resolvePageContext(token, pageArg);

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

      const endpoint = `/${pageId}/feed`;
      if (verbose || dryRun) {
        printRequestDebug({ method: 'POST', endpoint, payload });
      }
      if (dryRun) return;

      const spinner = ora('Creating post...').start();
      const pageClient = new MetaAPIClient(pageAccessToken, 'facebook');
      const result = await pageClient.post(endpoint, payload);
      spinner.stop();

      if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.green('OK Post created'));
      if (result?.id) console.log(chalk.cyan('  ID:'), result.id);
      console.log(chalk.cyan('  Page:'), `${pageName} (${pageId})`);
      if (scheduledPublishTime) {
        console.log(chalk.cyan('  Scheduled:'), new Date(scheduledPublishTime * 1000).toLocaleString());
      }
      console.log('');
    });

  post
    .command('photo')
    .description('Post a photo by URL to a Facebook Page')
    .option('-p, --page <pageId>', 'Facebook Page ID (defaults to configured)')
    .requiredOption('--url <imageUrl>', 'Publicly accessible image URL')
    .option('-c, --caption <caption>', 'Caption text')
    .option('--draft', 'Upload as unpublished (published=false)')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print request details without calling the API')
    .option('--verbose', 'Print request details')
    .action(async (options) => {
      const token = config.getToken('facebook');
      if (!token) {
        console.error(chalk.red('X No Facebook token found. Run: meta auth login -a facebook'));
        process.exit(1);
      }

      const { page: pageArg, url, caption, draft, json, dryRun, verbose } = options;
      const { pageId, pageName, pageAccessToken } = await resolvePageContext(token, pageArg);

      const payload = { url };
      if (caption) payload.caption = caption;
      if (draft) payload.published = false;

      const endpoint = `/${pageId}/photos`;
      if (verbose || dryRun) {
        printRequestDebug({ method: 'POST', endpoint, payload });
      }
      if (dryRun) return;

      const spinner = ora('Posting photo...').start();
      const pageClient = new MetaAPIClient(pageAccessToken, 'facebook');
      const result = await pageClient.post(endpoint, payload);
      spinner.stop();

      if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.green('OK Photo posted'));
      if (result?.id) console.log(chalk.cyan('  ID:'), result.id);
      console.log(chalk.cyan('  Page:'), `${pageName} (${pageId})`);
      if (draft) console.log(chalk.cyan('  Published:'), chalk.yellow('No (unpublished)'));
      console.log('');
    });
}

module.exports = registerPostCommands;


const chalk = require('chalk');
const inquirer = require('inquirer');
const ora = require('ora');
const config = require('../lib/config');
const MetaAPIClient = require('../lib/api-client');
const { openUrl } = require('../lib/open-url');
const { oauthLogin, exchangeForLongLivedToken } = require('../lib/oauth');

const SCOPES = {
  facebook: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    // Marketing API
    'ads_read',
    'ads_management'
  ],
  instagram: [
    'instagram_basic',
    'instagram_manage_comments',
    'instagram_manage_insights',
    'pages_show_list',
    'pages_read_engagement'
  ],
  whatsapp: [
    'whatsapp_business_messaging',
    'whatsapp_business_management'
  ]
};

function isValidApi(api) {
  return ['facebook', 'instagram', 'whatsapp'].includes(api);
}

async function promptScopes(api) {
  const choices = (SCOPES[api] || []).map((s) => ({ name: s, value: s, checked: true }));
  if (!choices.length) return [];
  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'scopes',
      message: `Select ${api} scopes:`,
      choices
    }
  ]);
  return answers.scopes || [];
}

function tokenHelpUrl(api, apiVersion) {
  if (api === 'whatsapp') return '';
  // Explorer supports picking permissions in UI; we keep it simple.
  return `https://developers.facebook.com/tools/explorer/?version=${encodeURIComponent(apiVersion)}`;
}

function registerAuthCommands(program) {
  const auth = program.command('auth').description('Authentication and token management');

  auth
    .command('scopes')
    .description('List recommended scopes')
    .option('-a, --api <api>', 'API (facebook, instagram, whatsapp)')
    .action((options) => {
      const apis = options.api ? [options.api] : ['facebook', 'instagram', 'whatsapp'];
      apis.forEach((api) => {
        if (!isValidApi(api)) return;
        console.log(chalk.bold(`\n${api} scopes:`));
        (SCOPES[api] || []).forEach((s) => console.log('  - ' + s));
      });
      console.log('');
    });

  auth
    .command('login')
    .description('Login and store an access token (manual or OAuth)')
    .option('-a, --api <api>', 'API to authenticate (facebook, instagram, whatsapp)', 'facebook')
    .option('-t, --token <token>', 'Access token (prompts if not provided)')
    .option('--oauth', 'Use OAuth browser flow (requires app id/secret and valid redirect URI)')
    .option('--scopes', 'Prompt for scopes (used for OAuth or guidance)')
    .option('--scope <scopes>', 'Comma-separated scopes (overrides --scopes)')
    .option('--long-lived', 'Exchange for long-lived token (OAuth only; requires app secret)')
    .option('--no-open', 'Do not open the token page in your browser')
    .action(async (options) => {
      const api = options.api;
      if (!isValidApi(api)) {
        console.error(chalk.red('X Invalid API. Choose: facebook, instagram, whatsapp'));
        process.exit(1);
      }

      const apiVersion = config.getApiVersion();

      let scopes = [];
      if (options.scope) {
        scopes = String(options.scope).split(',').map((s) => s.trim()).filter(Boolean);
      } else if (options.scopes) {
        scopes = await promptScopes(api);
      }

      let token = options.token || '';

      if (options.oauth) {
        const { appId, appSecret } = config.getAppCredentials();
        if (!appId || !appSecret) {
          console.error(chalk.red('X Missing app credentials. Run: social auth app'));
          process.exit(1);
        }

        console.log(chalk.gray('\nStarting OAuth flow...'));
        console.log(chalk.gray('  Note: Your Meta app must allow the redirect URI shown in your browser.\n'));

        try {
          const tokenData = await oauthLogin({
            apiVersion,
            appId,
            appSecret,
            scopes
          });

          token = tokenData.access_token;

          if (options.longLived) {
            const exchanged = await exchangeForLongLivedToken({
              apiVersion,
              appId,
              appSecret,
              shortLivedToken: token
            });
            token = exchanged.access_token;
          }
        } catch (e) {
          console.error(chalk.red(`X OAuth failed: ${e.message}`));
          process.exit(1);
        }
      }

      if (!token) {
        const url = tokenHelpUrl(api, apiVersion);
        if (api === 'whatsapp') {
          console.log(chalk.gray('\nWhatsApp token hint:'));
          console.log(chalk.cyan('  Meta App Dashboard -> WhatsApp -> API Setup -> Generate access token'));
          console.log(chalk.gray('  Then paste the token below.\n'));
        } else if (url) {
          if (options.open !== false) {
            console.log(chalk.gray(`\nOpening ${api} token page...`));
            console.log(chalk.cyan(`  ${url}\n`));
            await openUrl(url);
          } else {
            console.log(chalk.gray(`\nToken page (${api}):`));
            console.log(chalk.cyan(`  ${url}\n`));
          }
        }

        const answers = await inquirer.prompt([
          {
            type: 'password',
            name: 'token',
            message: `Enter your ${api} access token:`,
            validate: (input) => input.length > 0 || 'Token cannot be empty'
          }
        ]);
        token = answers.token;
      }

      const spinner = ora('Validating token...').start();
      try {
        const client = new MetaAPIClient(token, api);
        const me = await client.getMe('id,name');
        spinner.stop();

        config.setToken(api, token);
        config.setDefaultApi(api);

        console.log(chalk.green('OK Authenticated'));
        console.log(chalk.gray(`  User: ${me.name || me.id}`));
        console.log(chalk.gray(`  API: ${api}`));
        console.log(chalk.gray(`  Version: ${apiVersion}`));
        if (scopes.length) console.log(chalk.gray(`  Scopes requested: ${scopes.join(', ')}`));
        console.log('');
      } catch (error) {
        spinner.stop();
        const client = new MetaAPIClient(token, api);
        client.handleError(error);
      }
    });

  auth
    .command('app')
    .description('Configure app credentials (App ID and Secret)')
    .option('--id <appId>', 'App ID')
    .option('--secret <appSecret>', 'App Secret')
    .action(async (options) => {
      let { id, secret } = options;

      if (!id || !secret) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'appId',
            message: 'Enter your App ID:',
            when: !id,
            validate: (input) => input.length > 0 || 'App ID cannot be empty'
          },
          {
            type: 'password',
            name: 'appSecret',
            message: 'Enter your App Secret:',
            when: !secret,
            validate: (input) => input.length > 0 || 'App Secret cannot be empty'
          }
        ]);

        id = id || answers.appId;
        secret = secret || answers.appSecret;
      }

      config.setAppCredentials(id, secret);
      console.log(chalk.green('OK App credentials saved'));
      console.log('');
    });

  auth
    .command('logout')
    .description('Remove stored tokens')
    .option('-a, --api <api>', 'API to logout from (or "all")', 'all')
    .action((options) => {
      const api = options.api;
      if (api === 'all') {
        config.clearAllTokens();
        console.log(chalk.green('OK All tokens removed'));
        console.log('');
        return;
      }
      if (!isValidApi(api)) {
        console.error(chalk.red('X Invalid API. Choose: facebook, instagram, whatsapp, or all'));
        process.exit(1);
      }
      config.removeToken(api);
      console.log(chalk.green(`OK ${api} token removed`));
      console.log('');
    });

  auth
    .command('debug')
    .description('Debug a token (requires app secret for best results)')
    .option('-t, --token <token>', 'Token to debug (defaults to stored facebook token)')
    .action(async (options) => {
      const { appId, appSecret } = config.getAppCredentials();
      const appAccessToken = appId && appSecret ? `${appId}|${appSecret}` : '';

      const inputToken = options.token || config.getToken('facebook');
      if (!inputToken) {
        console.error(chalk.red('X No token provided and no stored facebook token found.'));
        process.exit(1);
      }

      if (!appAccessToken) {
        console.log(chalk.yellow('Warning: No app credentials configured. /debug_token may fail.'));
        console.log(chalk.gray('  Configure with: social auth app\n'));
      }

      const client = new MetaAPIClient(appAccessToken || inputToken, 'facebook');
      try {
        const debugInfo = await client.debugToken(inputToken);
        console.log(JSON.stringify(debugInfo, null, 2));
      } catch (e) {
        client.handleError(e);
      }
    });

  // Back-compat: auth status reads ~/.social-cli/config.json and falls back to legacy ~/.meta-cli/config.json.
  auth
    .command('status')
    .description('Show authentication/config status')
    .action(() => {
      config.display();
    });
}

module.exports = registerAuthCommands;

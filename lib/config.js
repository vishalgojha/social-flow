const Conf = require('conf');
const chalk = require('chalk');

class ConfigManager {
  constructor() {
    this.config = new Conf({
      projectName: 'meta-cli',
      schema: {
        tokens: {
          type: 'object',
          properties: {
            facebook: { type: 'string' },
            instagram: { type: 'string' },
            whatsapp: { type: 'string' }
          }
        },
        appId: { type: 'string' },
        appSecret: { type: 'string' },
        defaultApi: { type: 'string', default: 'facebook' },
        defaultFacebookPageId: { type: 'string' }
      }
    });
  }

  // Token management
  setToken(api, token) {
    const tokens = this.config.get('tokens', {});
    tokens[api] = token;
    this.config.set('tokens', tokens);
  }

  getToken(api) {
    const tokens = this.config.get('tokens', {});
    return tokens[api];
  }

  hasToken(api) {
    const token = this.getToken(api);
    return !!token;
  }

  removeToken(api) {
    const tokens = this.config.get('tokens', {});
    delete tokens[api];
    this.config.set('tokens', tokens);
  }

  clearAllTokens() {
    this.config.set('tokens', {});
  }

  // App credentials
  setAppCredentials(appId, appSecret) {
    this.config.set('appId', appId);
    this.config.set('appSecret', appSecret);
  }

  getAppCredentials() {
    return {
      appId: this.config.get('appId'),
      appSecret: this.config.get('appSecret')
    };
  }

  hasAppCredentials() {
    const { appId, appSecret } = this.getAppCredentials();
    return !!(appId && appSecret);
  }

  // Default API
  setDefaultApi(api) {
    this.config.set('defaultApi', api);
  }

  getDefaultApi() {
    return this.config.get('defaultApi', 'facebook');
  }

  // Default Facebook Page
  setDefaultFacebookPageId(pageId) {
    this.config.set('defaultFacebookPageId', pageId);
  }

  getDefaultFacebookPageId() {
    return this.config.get('defaultFacebookPageId');
  }

  // Config file location
  getConfigPath() {
    return this.config.path;
  }

  // Display current config (sanitized)
  display() {
    const tokens = this.config.get('tokens', {});
    const { appId } = this.getAppCredentials();
    const defaultApi = this.getDefaultApi();
    const defaultFacebookPageId = this.getDefaultFacebookPageId();

    console.log(chalk.bold('\nCurrent Configuration:'));
    console.log(chalk.gray('Config file: ' + this.getConfigPath()));
    console.log('');
    console.log(chalk.bold('Tokens:'));
    
    ['facebook', 'instagram', 'whatsapp'].forEach(api => {
      const token = tokens[api];
      if (token) {
        const masked = token.substring(0, 10) + '...' + token.substring(token.length - 4);
        console.log(`  ${api}: ${chalk.green(masked)}`);
      } else {
        console.log(`  ${api}: ${chalk.red('not set')}`);
      }
    });

    console.log('');
    console.log(chalk.bold('App Credentials:'));
    console.log(`  App ID: ${appId ? chalk.green(appId) : chalk.red('not set')}`);
    console.log(`  App Secret: ${appId ? chalk.green('***configured***') : chalk.red('not set')}`);
    
    console.log('');
    console.log(chalk.bold('Settings:'));
    console.log(`  Default API: ${chalk.cyan(defaultApi)}`);
    console.log(`  Default Facebook Page: ${defaultFacebookPageId ? chalk.cyan(defaultFacebookPageId) : chalk.gray('not set')}`);
    console.log('');
  }
}

module.exports = new ConfigManager();

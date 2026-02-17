const fs = require('fs');
const os = require('os');
const path = require('path');
const chalk = require('chalk');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function sanitizeProfileName(name) {
  const raw = String(name || '').trim();
  const trimmed = raw.startsWith('@') ? raw.slice(1) : raw;
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'default';
}

class ConfigManager {
  constructor() {
    // Allow overriding config location for CI/tests or portable setups.
    // SOCIAL_CLI_HOME is preferred; META_CLI_HOME is kept for backward compatibility.
    // Config lives at: <HOME>/.social-cli/config.json
    const homeRoot = process.env.SOCIAL_CLI_HOME
      ? path.resolve(process.env.SOCIAL_CLI_HOME)
      : (process.env.META_CLI_HOME ? path.resolve(process.env.META_CLI_HOME) : os.homedir());
    this.homeRoot = homeRoot;
    this.dir = path.join(homeRoot, '.social-cli');
    this.file = path.join(this.dir, 'config.json');
    this.legacyFile = path.join(homeRoot, '.meta-cli', 'config.json');
    this.data = null;
    this._activeProfileOverride = '';
    this._load();
  }

  _defaultsProfile() {
    return {
      apiVersion: 'v20.0',
      defaultApi: 'facebook',
      agent: {
        provider: 'openai',
        model: '',
        apiKey: ''
      },
      tokens: {
        facebook: '',
        instagram: '',
        whatsapp: ''
      },
      app: {
        id: '',
        secret: ''
      },
      defaults: {
        facebookPageId: '',
        igUserId: '',
        whatsappPhoneNumberId: '',
        marketingAdAccountId: ''
      },
      region: {
        country: '',
        timezone: '',
        regulatoryMode: 'standard'
      },
      integrations: {
        waba: {
          connected: false,
          businessId: '',
          wabaId: '',
          phoneNumberId: '',
          webhookCallbackUrl: '',
          webhookVerifyToken: '',
          connectedAt: '',
          provider: ''
        }
      }
    };
  }

  _defaults() {
    return {
      activeProfile: 'default',
      operator: {
        id: '',
        name: ''
      },
      profiles: {
        default: this._defaultsProfile()
      }
    };
  }

  _mergeProfile(existingProfile) {
    const d = this._defaultsProfile();
    const p = existingProfile || {};
    return {
      ...d,
      ...p,
      agent: { ...d.agent, ...(p.agent || {}) },
      tokens: { ...d.tokens, ...(p.tokens || {}) },
      app: { ...d.app, ...(p.app || {}) },
      defaults: { ...d.defaults, ...(p.defaults || {}) },
      region: { ...d.region, ...(p.region || {}) },
      integrations: {
        ...d.integrations,
        ...(p.integrations || {}),
        waba: {
          ...(d.integrations || {}).waba,
          ...((p.integrations || {}).waba || {})
        }
      }
    };
  }

  _load() {
    try {
      ensureDir(this.dir);
    } catch {
      // Fallback for restricted environments where creating ~/.social-cli is denied.
      this.dir = path.join(this.homeRoot, '.meta-cli');
      this.file = path.join(this.dir, 'config.json');
      ensureDir(this.dir);
    }
    let existing = readJson(this.file);
    if (!existing) {
      existing = readJson(this.legacyFile);
      if (existing) {
        writeJsonAtomic(this.file, existing);
      }
    }

    if (!existing) {
      this.data = this._defaults();
      writeJsonAtomic(this.file, this.data);
      return;
    }

    // New schema: { activeProfile, profiles: { name: profileData } }
    if (existing.profiles && typeof existing.profiles === 'object') {
      const d = this._defaults();
      const profiles = {};
      Object.keys(existing.profiles).forEach((k) => {
        profiles[sanitizeProfileName(k)] = this._mergeProfile(existing.profiles[k]);
      });
      const active = sanitizeProfileName(existing.activeProfile || d.activeProfile);
      if (!profiles[active]) profiles[active] = this._defaultsProfile();

      this.data = {
        ...d,
        ...existing,
        activeProfile: active,
        profiles
      };
      return;
    }

    // Legacy schema (top-level fields): migrate into profiles.default.
    const d = this._defaults();
    const migratedProfile = this._mergeProfile({
      apiVersion: existing.apiVersion,
      defaultApi: existing.defaultApi,
      agent: existing.agent,
      tokens: existing.tokens,
      app: existing.app,
      defaults: existing.defaults
    });

    this.data = {
      ...d,
      activeProfile: 'default',
      profiles: { default: migratedProfile }
    };
  }

  _save() {
    writeJsonAtomic(this.file, this.data);
  }

  // Paths
  getConfigPath() {
    return this.file;
  }

  // Profiles
  listProfiles() {
    return Object.keys(this.data.profiles || {}).sort();
  }

  hasProfile(name) {
    const n = sanitizeProfileName(name);
    return Boolean((this.data.profiles || {})[n]);
  }

  createProfile(name) {
    const n = sanitizeProfileName(name);
    this.data.profiles = this.data.profiles || {};
    if (this.data.profiles[n]) {
      throw new Error(`Profile already exists: ${n}`);
    }
    this.data.profiles[n] = this._defaultsProfile();
    this._save();
    return n;
  }

  deleteProfile(name) {
    const n = sanitizeProfileName(name);
    const active = this.getActiveProfile();
    if (n === active) throw new Error('Cannot delete the active profile. Switch first.');
    if (!this.hasProfile(n)) throw new Error(`Profile not found: ${n}`);
    delete this.data.profiles[n];
    this._save();
  }

  setActiveProfile(name) {
    const n = sanitizeProfileName(name);
    if (!this.hasProfile(n)) throw new Error(`Profile not found: ${n}`);
    this.data.activeProfile = n;
    this._save();
  }

  getActiveProfile() {
    const rawOverride = String(this._activeProfileOverride || '').trim();
    if (rawOverride) {
      const override = sanitizeProfileName(rawOverride);
      if (this.hasProfile(override)) return override;
    }
    return sanitizeProfileName(this.data.activeProfile || 'default');
  }

  // Temporary override (does not write to disk), used by --profile flag.
  useProfile(name) {
    const n = sanitizeProfileName(name);
    if (!this.hasProfile(n)) throw new Error(`Profile not found: ${n}`);
    this._activeProfileOverride = n;
  }

  clearProfileOverride() {
    this._activeProfileOverride = '';
  }

  _profile(profileName) {
    const name = sanitizeProfileName(profileName || this.getActiveProfile());
    this.data.profiles = this.data.profiles || {};
    if (!this.data.profiles[name]) this.data.profiles[name] = this._defaultsProfile();
    return this.data.profiles[name];
  }

  // API version
  setApiVersion(apiVersion) {
    const p = this._profile();
    p.apiVersion = apiVersion;
    this._save();
  }

  getApiVersion() {
    const p = this._profile();
    return p.apiVersion || 'v20.0';
  }

  // Tokens
  setToken(api, token) {
    const p = this._profile();
    p.tokens = p.tokens || {};
    p.tokens[api] = token;
    this._save();
  }

  getToken(api) {
    const p = this._profile();
    return (p.tokens || {})[api] || '';
  }

  hasToken(api) {
    return Boolean(this.getToken(api));
  }

  removeToken(api) {
    const p = this._profile();
    p.tokens = p.tokens || {};
    delete p.tokens[api];
    this._save();
  }

  clearAllTokens() {
    const p = this._profile();
    p.tokens = {};
    this._save();
  }

  // App credentials
  setAppCredentials(appId, appSecret) {
    const p = this._profile();
    p.app = { id: appId || '', secret: appSecret || '' };
    this._save();
  }

  getAppCredentials() {
    const p = this._profile();
    return {
      appId: (p.app || {}).id || '',
      appSecret: (p.app || {}).secret || ''
    };
  }

  hasAppCredentials() {
    const { appId, appSecret } = this.getAppCredentials();
    return Boolean(appId && appSecret);
  }

  // Default API
  setDefaultApi(api) {
    const p = this._profile();
    p.defaultApi = api;
    this._save();
  }

  getDefaultApi() {
    const p = this._profile();
    return p.defaultApi || 'facebook';
  }

  // Defaults: Facebook Page / IG user / WhatsApp phone / Marketing ad account
  setDefaultFacebookPageId(pageId) {
    const p = this._profile();
    p.defaults = p.defaults || {};
    p.defaults.facebookPageId = pageId || '';
    this._save();
  }

  getDefaultFacebookPageId() {
    const p = this._profile();
    return (p.defaults || {}).facebookPageId || '';
  }

  setDefaultIgUserId(igUserId) {
    const p = this._profile();
    p.defaults = p.defaults || {};
    p.defaults.igUserId = igUserId || '';
    this._save();
  }

  getDefaultIgUserId() {
    const p = this._profile();
    return (p.defaults || {}).igUserId || '';
  }

  setDefaultWhatsAppPhoneNumberId(phoneNumberId) {
    const p = this._profile();
    p.defaults = p.defaults || {};
    p.defaults.whatsappPhoneNumberId = phoneNumberId || '';
    this._save();
  }

  getDefaultWhatsAppPhoneNumberId() {
    const p = this._profile();
    return (p.defaults || {}).whatsappPhoneNumberId || '';
  }

  setDefaultMarketingAdAccountId(adAccountId) {
    const p = this._profile();
    p.defaults = p.defaults || {};
    p.defaults.marketingAdAccountId = adAccountId || '';
    this._save();
  }

  getDefaultMarketingAdAccountId() {
    const p = this._profile();
    return (p.defaults || {}).marketingAdAccountId || '';
  }

  // Agent config (LLM provider/key/model). WARNING: apiKey is sensitive.
  getAgentConfig() {
    const p = this._profile();
    return { ...(p.agent || {}) };
  }

  setAgentProvider(provider) {
    const p = this._profile();
    p.agent = p.agent || {};
    p.agent.provider = provider || 'openai';
    this._save();
  }

  setAgentModel(model) {
    const p = this._profile();
    p.agent = p.agent || {};
    p.agent.model = model || '';
    this._save();
  }

  setAgentApiKey(apiKey) {
    const p = this._profile();
    p.agent = p.agent || {};
    p.agent.apiKey = apiKey || '';
    this._save();
  }

  getWabaIntegration() {
    const p = this._profile();
    const base = (((p || {}).integrations || {}).waba || {});
    return {
      connected: Boolean(base.connected),
      businessId: String(base.businessId || ''),
      wabaId: String(base.wabaId || ''),
      phoneNumberId: String(base.phoneNumberId || ''),
      webhookCallbackUrl: String(base.webhookCallbackUrl || ''),
      webhookVerifyToken: String(base.webhookVerifyToken || ''),
      connectedAt: String(base.connectedAt || ''),
      provider: String(base.provider || '')
    };
  }

  setWabaIntegration(patch = {}) {
    const p = this._profile();
    p.integrations = p.integrations || {};
    const current = this.getWabaIntegration();
    p.integrations.waba = {
      ...current,
      ...(patch || {})
    };
    this._save();
    return this.getWabaIntegration();
  }

  getRegionConfig() {
    const p = this._profile();
    const region = (p.region || {});
    const modeRaw = String(region.regulatoryMode || 'standard').trim().toLowerCase();
    const regulatoryMode = ['standard', 'strict'].includes(modeRaw) ? modeRaw : 'standard';
    return {
      country: String(region.country || '').trim().toUpperCase(),
      timezone: String(region.timezone || '').trim(),
      regulatoryMode
    };
  }

  setRegionConfig(patch = {}) {
    const p = this._profile();
    const next = { ...this.getRegionConfig(), ...(patch || {}) };
    if (next.country) next.country = String(next.country).trim().toUpperCase();
    if (next.timezone) next.timezone = String(next.timezone).trim();
    const modeRaw = String(next.regulatoryMode || 'standard').trim().toLowerCase();
    next.regulatoryMode = ['standard', 'strict'].includes(modeRaw) ? modeRaw : 'standard';
    p.region = next;
    this._save();
    return this.getRegionConfig();
  }

  clearWabaIntegration() {
    return this.setWabaIntegration({
      connected: false,
      businessId: '',
      wabaId: '',
      phoneNumberId: '',
      webhookCallbackUrl: '',
      webhookVerifyToken: '',
      connectedAt: '',
      provider: ''
    });
  }

  // Team/operator identity for audit trails and RBAC defaults.
  setOperator(input = {}) {
    const id = String(input.id || '').trim();
    const name = String(input.name || '').trim();
    this.data.operator = { id, name };
    this._save();
    return this.getOperator();
  }

  getOperator() {
    const raw = this.data.operator && typeof this.data.operator === 'object'
      ? this.data.operator
      : {};
    return {
      id: String(raw.id || '').trim(),
      name: String(raw.name || '').trim()
    };
  }

  clearOperator() {
    this.data.operator = { id: '', name: '' };
    this._save();
  }

  // Display (sanitized)
  display({ profile } = {}) {
    const active = this.getActiveProfile();
    const selected = sanitizeProfileName(profile || active);
    const p = this._profile(selected);
    const tokens = p.tokens || {};
    const app = { appId: (p.app || {}).id || '', appSecret: (p.app || {}).secret || '' };

    console.log(chalk.bold('\nCurrent Configuration:'));
    console.log(chalk.gray('Config file: ' + this.getConfigPath()));
    console.log(chalk.gray('Active profile: ' + active));
    console.log(chalk.gray('Profiles: ' + this.listProfiles().join(', ')));
    const operator = this.getOperator();
    console.log(chalk.gray('Operator: ' + (operator.id || 'not set')));
    console.log('');

    if (selected !== active) {
      console.log(chalk.gray(`Showing profile: ${selected}`));
      console.log('');
    }

    console.log(chalk.bold('Tokens:'));
    ['facebook', 'instagram', 'whatsapp'].forEach((api) => {
      const token = tokens[api];
      if (token) {
        const masked = token.substring(0, 6) + '...' + token.substring(token.length - 4);
        console.log(`  ${api}: ${chalk.green(masked)}`);
      } else {
        console.log(`  ${api}: ${chalk.red('not set')}`);
      }
    });

    console.log('');
    console.log(chalk.bold('App Credentials:'));
    console.log(`  App ID: ${app.appId ? chalk.green(app.appId) : chalk.red('not set')}`);
    console.log(`  App Secret: ${app.appSecret ? chalk.green('***configured***') : chalk.red('not set')}`);

    console.log('');
    console.log(chalk.bold('Settings:'));
    console.log(`  API Version: ${chalk.cyan(p.apiVersion || 'v20.0')}`);
    console.log(`  Default API: ${chalk.cyan(p.defaultApi || 'facebook')}`);
    console.log(`  Agent Provider: ${chalk.cyan((p.agent || {}).provider || 'openai')}`);
    console.log(`  Agent Model: ${chalk.cyan((p.agent || {}).model || '(default)')}`);
    console.log(`  Agent API Key: ${(p.agent || {}).apiKey ? chalk.green('***configured***') : chalk.gray('not set')}`);

    console.log('');
    console.log(chalk.bold('Defaults:'));
    console.log(`  Default Facebook Page: ${(p.defaults || {}).facebookPageId ? chalk.cyan((p.defaults || {}).facebookPageId) : chalk.gray('not set')}`);
    console.log(`  Default IG User: ${(p.defaults || {}).igUserId ? chalk.cyan((p.defaults || {}).igUserId) : chalk.gray('not set')}`);
    console.log(`  Default WhatsApp Phone: ${(p.defaults || {}).whatsappPhoneNumberId ? chalk.cyan((p.defaults || {}).whatsappPhoneNumberId) : chalk.gray('not set')}`);
    console.log(`  Default Ad Account: ${(p.defaults || {}).marketingAdAccountId ? chalk.cyan((p.defaults || {}).marketingAdAccountId) : chalk.gray('not set')}`);
    const region = this.getRegionConfig();
    console.log('');
    console.log(chalk.bold('Region:'));
    console.log(`  Country: ${region.country ? chalk.cyan(region.country) : chalk.gray('not set')}`);
    console.log(`  Timezone: ${region.timezone ? chalk.cyan(region.timezone) : chalk.gray('not set')}`);
    console.log(`  Regulatory Mode: ${chalk.cyan(region.regulatoryMode)}`);
    console.log('');
  }
}

const singleton = new ConfigManager();
singleton.ConfigManager = ConfigManager;
singleton.sanitizeProfileName = sanitizeProfileName;

module.exports = singleton;

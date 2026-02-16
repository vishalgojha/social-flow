const axios = require('axios');
const MetaAPIClient = require('../api-client');
const { sanitizeForLog } = require('../api');
const { normalizeAct, paginate, summarizeInsights } = require('../marketing');
const hubStorage = require('../hub/storage');
const { getIntentById, listIntents, disambiguationQuestions } = require('./contract');

function parseHeaderJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function graphErrorMessage(error) {
  const apiError = error?.response?.data?.error;
  if (!apiError) {
    if (error?.name === 'AggregateError' && Array.isArray(error?.errors) && error.errors.length) {
      const first = error.errors[0];
      return `Network error: ${first?.message || 'multiple connection failures'}`;
    }
    if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT' || error?.code === 'EACCES') {
      return `Network error: ${error.message || error.code}`;
    }
    return error?.message || String(error);
  }
  const code = apiError.code || error?.response?.status || 'unknown';
  const subcode = apiError.error_subcode ? ` (${apiError.error_subcode})` : '';
  return `Meta API error ${code}${subcode}: ${apiError.message || 'unknown error'}`;
}

function tokenFor(api, config) {
  const explicit = config?.getToken ? config.getToken(api) : '';
  if (explicit) return explicit;
  if (api === 'instagram' && config?.getToken) return config.getToken('facebook');
  return '';
}

async function resolveFacebookPageContext(pageInput, config) {
  const userToken = tokenFor('facebook', config);
  if (!userToken) throw new Error('No Facebook token found. Run: social auth login -a facebook');

  const userClient = new MetaAPIClient(userToken, 'facebook');
  const pagesRes = await userClient.getFacebookPages(100);
  const pages = pagesRes?.data || [];
  if (!pages.length) throw new Error('No Facebook pages found for your token.');

  const fallbackId = config?.getDefaultFacebookPageId ? config.getDefaultFacebookPageId() : '';
  const raw = String(pageInput || fallbackId || '').trim();
  if (!raw) throw new Error('Missing target page. Set one with social post pages --set-default or specify it in the prompt.');

  const found = pages.find((p) => String(p.id) === raw) ||
    pages.find((p) => String(p.name).toLowerCase() === raw.toLowerCase()) ||
    pages.find((p) => String(p.name).toLowerCase().includes(raw.toLowerCase()));

  if (!found) {
    throw new Error(`Could not resolve Facebook page: ${raw}`);
  }
  if (!found.access_token) {
    throw new Error(`Page "${found.name}" is missing page access token in /me/accounts response.`);
  }

  return {
    pageId: found.id,
    pageName: found.name,
    pageAccessToken: found.access_token
  };
}

function baseMetadata(started, apiCalls, cost = null) {
  return {
    apiCalls,
    executionTime: Date.now() - started,
    cost
  };
}

async function runPostFacebook(intent, config, counters) {
  const ctx = await resolveFacebookPageContext(intent.page, config);
  counters.apiCalls += 1; // /me/accounts lookup

  const payload = {};
  if (intent.message) payload.message = intent.message;
  if (intent.link) payload.link = intent.link;

  if (intent.action === 'schedule_post' || intent.datetime) {
    const unix = Math.floor(new Date(intent.datetime).getTime() / 1000);
    payload.published = false;
    payload.scheduled_publish_time = unix;
    payload.unpublished_content_type = 'SCHEDULED';
  }

  const pageClient = new MetaAPIClient(ctx.pageAccessToken, 'facebook');
  const result = await pageClient.post(`/${ctx.pageId}/feed`, payload);
  counters.apiCalls += 1;
  return {
    ...result,
    page: { id: ctx.pageId, name: ctx.pageName }
  };
}

async function runPostInstagram(intent, config, counters) {
  const token = tokenFor('instagram', config);
  if (!token) throw new Error('No Instagram/Facebook token found. Run: social auth login -a facebook');

  const igUserId = intent.accountId || (config?.getDefaultIgUserId ? config.getDefaultIgUserId() : '');
  if (!igUserId) {
    throw new Error('Missing IG user id. Set default via social instagram accounts list --set-default.');
  }

  const client = new MetaAPIClient(token, 'instagram');
  const container = await client.post(`/${igUserId}/media`, {
    image_url: intent.imageUrl,
    caption: intent.caption || ''
  });
  counters.apiCalls += 1;

  const publish = await client.publishInstagramContainer(igUserId, container.id);
  counters.apiCalls += 1;
  return { container, publish };
}

async function runPostWhatsApp(intent, config, counters) {
  const token = tokenFor('whatsapp', config);
  if (!token) throw new Error('No WhatsApp token found. Run: social auth login -a whatsapp');

  const from = intent.phoneId || (config?.getDefaultWhatsAppPhoneNumberId ? config.getDefaultWhatsAppPhoneNumberId() : '');
  if (!from) throw new Error('Missing WhatsApp phone id. Provide phoneId or set default phone id.');

  const payload = {
    messaging_product: 'whatsapp',
    to: intent.phone,
    type: 'text',
    text: { body: intent.message }
  };

  const client = new MetaAPIClient(token, 'whatsapp');
  const result = await client.sendWhatsAppMessage(from, payload);
  counters.apiCalls += 1;
  return result;
}

async function runQueryPages(intent, config, counters) {
  const token = tokenFor(intent.api || 'facebook', config);
  if (!token) throw new Error('No Facebook token found. Run: social auth login -a facebook');
  const client = new MetaAPIClient(token, 'facebook');
  const result = await client.getFacebookPages(intent.limit || 25);
  counters.apiCalls += 1;
  return result;
}

async function runQueryWhatsAppPhoneNumbers(intent, config, counters) {
  const token = tokenFor('whatsapp', config);
  if (!token) throw new Error('No WhatsApp token found. Run: social auth login -a whatsapp');
  const businessId = String(intent.businessId || '').trim();
  if (!businessId) {
    throw new Error('Missing WhatsApp business id (WABA). Provide businessId in your prompt.');
  }
  const client = new MetaAPIClient(token, 'whatsapp');
  const result = await client.listWhatsAppPhoneNumbers(businessId);
  counters.apiCalls += 1;
  return {
    businessId,
    data: result?.data || []
  };
}

async function runQueryMe(intent, config, counters) {
  const api = intent.api || (config?.getDefaultApi ? config.getDefaultApi() : 'facebook');
  const token = tokenFor(api, config);
  if (!token) throw new Error(`No ${api} token found. Run: social auth login -a ${api}`);
  const client = new MetaAPIClient(token, api);
  const fields = Array.isArray(intent.fields) && intent.fields.length ? intent.fields.join(',') : 'id,name';
  const result = await client.getMe(fields);
  counters.apiCalls += 1;
  return result;
}

async function runQueryInstagramMedia(intent, config, counters) {
  const token = tokenFor('instagram', config);
  if (!token) throw new Error('No Instagram/Facebook token found. Run: social auth login -a facebook');
  const igUserId = intent.accountId || (config?.getDefaultIgUserId ? config.getDefaultIgUserId() : '');
  if (!igUserId) {
    throw new Error('Missing IG user id. Set one with social instagram accounts list --set-default.');
  }
  const client = new MetaAPIClient(token, 'instagram');
  const result = await client.getInstagramMedia(igUserId, intent.limit || 10);
  counters.apiCalls += 1;
  return result;
}

async function runCheckLimits(intent, config, counters) {
  const api = intent.api || (config?.getDefaultApi ? config.getDefaultApi() : 'facebook');
  const token = tokenFor(api, config);
  if (!token) throw new Error(`No ${api} token found. Run: social auth login -a ${api}`);
  const client = new MetaAPIClient(token, api);

  const response = await axios.get(`${client.baseUrl}/me`, {
    params: { access_token: token, fields: 'id' },
    validateStatus: () => true
  });
  counters.apiCalls += 1;

  return {
    usage: parseHeaderJson(response?.headers?.['x-app-usage']),
    businessUsage: parseHeaderJson(response?.headers?.['x-business-use-case-usage'])
  };
}

async function runQueryInsights(intent, config, counters) {
  const token = tokenFor('facebook', config);
  if (!token) throw new Error('No Facebook token found. Run: social auth login -a facebook');
  const act = normalizeAct(intent.accountId || (config?.getDefaultMarketingAdAccountId ? config.getDefaultMarketingAdAccountId() : ''));
  if (!act) {
    throw new Error('Missing ad account id. Provide accountId in prompt or set default via social marketing set-default-account.');
  }

  const fields = Array.isArray(intent.fields) && intent.fields.length
    ? intent.fields.join(',')
    : 'spend,impressions,clicks,ctr,cpc,cpm';
  const datePreset = intent.preset || 'last_7d';

  const client = new MetaAPIClient(token, 'facebook');
  const result = await client.get(`/${act}/insights`, {
    date_preset: datePreset,
    level: 'campaign',
    fields,
    limit: intent.limit || 50
  }, { maxRetries: 5 });
  counters.apiCalls += 1;

  const rows = result?.data || [];
  return {
    accountId: act,
    preset: datePreset,
    rows,
    summary: summarizeInsights(rows)
  };
}

async function runListCampaigns(intent, config, counters) {
  const token = tokenFor('facebook', config);
  if (!token) throw new Error('No Facebook token found. Run: social auth login -a facebook');
  const act = normalizeAct(intent.accountId || (config?.getDefaultMarketingAdAccountId ? config.getDefaultMarketingAdAccountId() : ''));
  if (!act) {
    throw new Error('Missing ad account id. Provide accountId in prompt or set default via social marketing set-default-account.');
  }

  const params = {
    fields: 'id,name,objective,status,daily_budget',
    limit: intent.limit || 100
  };
  if (intent.status) params.effective_status = JSON.stringify([String(intent.status).toUpperCase()]);

  const client = new MetaAPIClient(token, 'facebook');
  const rows = await paginate(client, `/${act}/campaigns`, params, { maxRetries: 5 });
  counters.apiCalls += Math.max(1, Math.ceil(rows.length / (intent.limit || 100)));
  return rows;
}

async function runCreateCampaign(intent, config, counters) {
  const token = tokenFor('facebook', config);
  if (!token) throw new Error('No Facebook token found. Run: social auth login -a facebook');
  const act = normalizeAct(intent.accountId || (config?.getDefaultMarketingAdAccountId ? config.getDefaultMarketingAdAccountId() : ''));
  if (!act) {
    throw new Error('Missing ad account id. Provide accountId in prompt or set default via social marketing set-default-account.');
  }

  const payload = {
    name: intent.name,
    objective: intent.objective,
    status: intent.status || 'PAUSED',
    special_ad_categories: []
  };
  if (intent.budget) payload.daily_budget = String(intent.budget);

  const client = new MetaAPIClient(token, 'facebook');
  const result = await client.post(`/${act}/campaigns`, payload, {}, { maxRetries: 5 });
  counters.apiCalls += 1;
  return result;
}

function mapContractToLegacyIntent(intent) {
  const action = String(intent?.action || '').trim();
  if (action === 'publish_post') {
    const platform = String(intent.platform || intent.api || 'facebook').toLowerCase();
    if (platform === 'instagram') {
      return {
        action: 'post_instagram',
        api: 'instagram',
        accountId: intent.accountId || '',
        caption: intent.message || '',
        imageUrl: intent.mediaUrl || intent.link || ''
      };
    }
    return {
      action: intent.scheduledAt ? 'schedule_post' : 'post_facebook',
      api: 'facebook',
      page: intent.accountId || '',
      message: intent.message || '',
      link: intent.mediaUrl || intent.link || '',
      datetime: intent.scheduledAt || null
    };
  }

  if (action === 'create_ad') {
    return {
      action: 'create_campaign',
      api: 'facebook',
      accountId: intent.accountId || '',
      name: intent.adName || '',
      objective: intent.objective || '',
      budget: intent.dailyBudget !== null && intent.dailyBudget !== undefined ? String(intent.dailyBudget) : '',
      status: 'PAUSED'
    };
  }

  if (action === 'get_metrics') {
    return {
      action: 'get_analytics',
      api: String(intent.platform || 'facebook').toLowerCase(),
      accountId: intent.accountId || '',
      fields: intent.metricType ? [String(intent.metricType)] : null,
      preset: 'last_7d'
    };
  }

  if (action === 'send_dm') {
    if (String(intent.platform || '').toLowerCase() !== 'whatsapp') {
      return null;
    }
    return {
      action: 'post_whatsapp',
      api: 'whatsapp',
      phoneId: intent.accountId || '',
      phone: intent.recipientId || '',
      message: intent.messageBody || intent.message || ''
    };
  }

  if (action === 'broadcast_message') {
    return {
      action: 'broadcast_message',
      api: 'whatsapp',
      phoneId: intent.accountId || '',
      recipientList: intent.recipientList || '',
      message: intent.messageBody || intent.message || ''
    };
  }

  return null;
}

function parseRecipients(recipientList) {
  return String(recipientList || '')
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function runConnectAccount(intent) {
  const provider = String(intent.platform || intent.api || '').trim().toLowerCase();
  if (!provider) throw new Error('connect_account requires platform.');
  return {
    provider,
    account: intent.accountId || '',
    scopes: [],
    status: 'pending_oauth',
    guidance: `Run: social auth login -a ${provider}`
  };
}

function runSetDefaultAccount(intent, config) {
  const platform = String(intent.platform || intent.api || '').toLowerCase();
  const id = String(intent.accountId || '').trim();
  if (!platform || !id) {
    throw new Error('set_default_account requires platform and accountId.');
  }
  if (platform === 'facebook') {
    config.setDefaultFacebookPageId(id);
  } else if (platform === 'instagram') {
    config.setDefaultIgUserId(id);
  } else if (platform === 'whatsapp') {
    config.setDefaultWhatsAppPhoneNumberId(id);
  } else {
    throw new Error(`Unsupported platform for defaults: ${platform}`);
  }
  return {
    platform,
    accountId: id,
    default: true
  };
}

function runDisconnectAccount(intent, config) {
  const platform = String(intent.platform || intent.api || '').toLowerCase();
  if (!platform) throw new Error('disconnect_account requires platform.');
  if (typeof config.setToken !== 'function') {
    throw new Error('Config manager does not support token updates.');
  }
  config.setToken(platform, '');
  return {
    platform,
    status: 'disconnected'
  };
}

function runRefreshToken(intent, config) {
  const platform = String(intent.platform || intent.api || '').toLowerCase();
  if (!platform) throw new Error('refresh_token requires platform.');
  const token = typeof config.getToken === 'function' ? String(config.getToken(platform) || '') : '';
  return {
    provider: platform,
    account: intent.accountId || '',
    status: token ? 'reauth_required' : 'missing_token',
    guidance: token
      ? `Provider ${platform} refresh is not automated in CLI. Re-authenticate: social auth login -a ${platform}`
      : `No token configured. Run: social auth login -a ${platform}`
  };
}

async function runBroadcastMessage(intent, config, counters) {
  const recipients = parseRecipients(intent.recipientList);
  if (!recipients.length) {
    throw new Error('broadcast_message requires recipientList with at least one recipient.');
  }
  const message = String(intent.messageBody || intent.message || '').trim();
  if (!message) throw new Error('broadcast_message requires messageBody.');

  const deliveries = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const recipient of recipients) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runPostWhatsApp({
      action: 'post_whatsapp',
      phoneId: intent.accountId || intent.phoneId || '',
      phone: recipient,
      message
    }, config, counters);
    deliveries.push({
      recipient,
      message_id: result?.messages?.[0]?.id || '',
      status: 'sent'
    });
  }

  return {
    platform: 'whatsapp',
    delivery_count: deliveries.length,
    status: 'sent',
    deliveries
  };
}

function runDoctor(intent, config) {
  const platform = String(intent.platform || '').toLowerCase();
  const checks = [];
  const apis = platform ? [platform] : ['facebook', 'instagram', 'whatsapp'];
  apis.forEach((api) => {
    const token = String(config.getToken(api) || '');
    checks.push({
      check: `${api}_token`,
      status: token ? 'ok' : 'warn',
      message: token ? 'Token configured.' : `Token missing. Run: social auth login -a ${api}`
    });
  });
  const trust = hubStorage.loadTrustPolicy();
  checks.push({
    check: 'hub_trust_mode',
    status: trust.mode === 'enforce' ? 'ok' : 'warn',
    message: `Hub trust mode is ${trust.mode}.`
  });
  return {
    checks
  };
}

function runSearchIntents(intent) {
  const q = String(intent.query || '').trim().toLowerCase();
  const domain = String(intent.domain || '').trim().toLowerCase();
  const rows = listIntents().filter((row) => {
    if (domain && String(row.domain || '').toLowerCase() !== domain) return false;
    if (!q) return true;
    const hay = `${row.id} ${row.title} ${row.domain}`.toLowerCase();
    return hay.includes(q);
  }).map((row) => ({
    id: row.id,
    title: row.title,
    domain: row.domain,
    risk: row.risk
  }));
  return { intents: rows };
}

function runInspectIntent(intent) {
  const id = String(intent.intentId || '').trim();
  if (!id) throw new Error('inspect_intent requires intentId.');
  const row = getIntentById(id);
  if (!row) throw new Error(`Intent not found: ${id}`);
  return row;
}

function runUnknownInput() {
  return {
    message: 'Unable to map this request to a deterministic intent.',
    choices: disambiguationQuestions('unknown_input')
  };
}

function runVerifyTrust(intent) {
  const pkg = String(intent.packageName || '').trim();
  if (!pkg) throw new Error('verify_trust requires packageName.');
  const inspection = hubStorage.inspectPackage(pkg);
  const selected = inspection.selectedVersion || inspection.versions?.[0];
  const trust = hubStorage.assessTrust({
    id: inspection.id,
    versions: [selected]
  }, selected, hubStorage.loadTrustPolicy());
  return {
    package: inspection.id,
    version: selected?.version || '',
    signature_valid: trust.ok,
    signer: selected?.publisher || '',
    chain_ok: trust.ok,
    trust
  };
}

function runInstallHubPackage(intent) {
  const pkg = String(intent.packageName || '').trim();
  if (!pkg) throw new Error('install_hub_package requires packageName.');
  const version = String(intent.version || '').trim();
  const spec = version ? `${pkg}@${version}` : pkg;
  const result = hubStorage.installPackage(spec, { enforceTrust: true });
  return {
    package: result.package.id,
    version: result.version.version,
    status: result.status,
    trust: result.trust
  };
}

function runUpdateHubPackages(intent) {
  const pkg = String(intent.packageName || '').trim();
  if (pkg) {
    const result = hubStorage.updatePackage(pkg);
    return {
      updated: [`${result.package.id}@${result.version.version}`],
      skipped: [],
      details: [result]
    };
  }
  const updates = hubStorage.updateAll();
  return {
    updated: updates.map((x) => `${x.package.id}@${x.version.version}`),
    skipped: [],
    details: updates
  };
}

function runRollbackUpdate(intent) {
  const pkg = String(intent.packageName || '').trim().toLowerCase();
  if (!pkg) throw new Error('rollback_update requires packageName.');

  const installed = hubStorage.listInstalled().find((x) => String(x.id || '').toLowerCase() === pkg);
  if (!installed) throw new Error(`Package not installed: ${pkg}`);

  const inspection = hubStorage.inspectPackage(pkg);
  const versions = Array.isArray(inspection.versions) ? inspection.versions : [];
  const currentIdx = versions.findIndex((v) => v.version === installed.version);
  const target = currentIdx >= 0 ? versions[currentIdx + 1] : null;
  if (!target) {
    throw new Error(`No previous version found for ${pkg}; current version is ${installed.version}.`);
  }

  const result = hubStorage.installPackage(`${pkg}@${target.version}`, { enforceTrust: true });
  return {
    package: result.package.id,
    previous_version: target.version,
    status: 'rolled_back',
    trust: result.trust
  };
}

function runWebhookAction(intent) {
  const platform = String(intent.platform || intent.api || '').toLowerCase();
  const account = String(intent.accountId || '').trim();
  return {
    platform,
    account,
    status: 'not_implemented',
    guidance: 'Use gateway ops endpoints to manage webhooks until direct CLI tooling is added.'
  };
}

function runConnectorAction(intent) {
  return {
    connectorType: intent.connectorType || '',
    connectorId: intent.connectorId || '',
    status: 'not_implemented',
    guidance: 'Connector registry APIs are not implemented in this CLI build yet.'
  };
}

/**
 * Execute parsed intent by mapping to safe, internal API client functions.
 * No shell execution is used.
 * @param {object} intent
 * @param {object} config
 * @returns {Promise<{success: boolean, data: any, error: string|null, details?: any, metadata: {apiCalls: number, executionTime: number, cost: string|null}}>}
 */
async function executeIntent(intent, config) {
  const started = Date.now();
  const counters = { apiCalls: 0 };

  try {
    let runtimeIntent = { ...(intent || {}) };
    let action = String(runtimeIntent.action || '').trim();

    if (action === 'unknown_input') {
      return {
        success: true,
        data: runUnknownInput(),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'search_intents') {
      return {
        success: true,
        data: runSearchIntents(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'inspect_intent') {
      return {
        success: true,
        data: runInspectIntent(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'doctor') {
      return {
        success: true,
        data: runDoctor(runtimeIntent, config),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'set_default_account') {
      return {
        success: true,
        data: runSetDefaultAccount(runtimeIntent, config),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'connect_account') {
      return {
        success: true,
        data: runConnectAccount(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'disconnect_account') {
      return {
        success: true,
        data: runDisconnectAccount(runtimeIntent, config),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'refresh_token') {
      return {
        success: true,
        data: runRefreshToken(runtimeIntent, config),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'install_hub_package') {
      return {
        success: true,
        data: runInstallHubPackage(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'update_hub_packages') {
      return {
        success: true,
        data: runUpdateHubPackages(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'rollback_update') {
      return {
        success: true,
        data: runRollbackUpdate(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'verify_trust') {
      return {
        success: true,
        data: runVerifyTrust(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'subscribe_webhook' || action === 'unsubscribe_webhook' || action === 'list_subscribers') {
      return {
        success: true,
        data: runWebhookAction(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'register_connector' || action === 'unregister_connector') {
      return {
        success: true,
        data: runConnectorAction(runtimeIntent),
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, null)
      };
    }

    if (action === 'broadcast_message') {
      const data = await runBroadcastMessage(runtimeIntent, config, counters);
      return {
        success: true,
        data,
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, 'depends on conversation category and region')
      };
    }

    if (action === 'publish_post' || action === 'create_ad' || action === 'get_metrics' || action === 'send_dm') {
      const mapped = mapContractToLegacyIntent(runtimeIntent);
      if (!mapped) {
        if (action === 'send_dm') {
          throw new Error('send_dm currently supports whatsapp only in this build.');
        }
        throw new Error(`Could not map contract action to executor path: ${action}`);
      }
      runtimeIntent = { ...runtimeIntent, ...mapped };
      action = runtimeIntent.action;
    }

    let data;
    if (action === 'post_facebook') {
      data = await runPostFacebook(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'schedule_post') {
      if ((runtimeIntent.api || 'facebook') !== 'facebook') {
        throw new Error('schedule_post currently supports facebook only.');
      }
      data = await runPostFacebook(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'post_instagram') {
      data = await runPostInstagram(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'post_whatsapp') {
      data = await runPostWhatsApp(runtimeIntent, config, counters);
      return {
        success: true,
        data,
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, 'depends on conversation category and region')
      };
    }

    if (action === 'query_pages') {
      data = await runQueryPages(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'query_whatsapp_phone_numbers') {
      data = await runQueryWhatsAppPhoneNumbers(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'query_me') {
      data = await runQueryMe(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'query_instagram_media') {
      data = await runQueryInstagramMedia(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'check_limits') {
      data = await runCheckLimits(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'query_insights' || action === 'get_analytics') {
      data = await runQueryInsights(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'list_campaigns') {
      data = await runListCampaigns(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (action === 'create_campaign') {
      data = await runCreateCampaign(runtimeIntent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (error) {
    return {
      success: false,
      data: null,
      error: graphErrorMessage(error),
      details: sanitizeForLog(error?.response?.data || { message: error?.message || String(error) }),
      metadata: baseMetadata(started, counters.apiCalls, null)
    };
  }
}

module.exports = {
  executeIntent
};

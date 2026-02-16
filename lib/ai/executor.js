const axios = require('axios');
const MetaAPIClient = require('../api-client');
const { sanitizeForLog } = require('../api');
const { normalizeAct, paginate, summarizeInsights } = require('../marketing');

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
    let data;
    if (intent.action === 'post_facebook') {
      data = await runPostFacebook(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'schedule_post') {
      if ((intent.api || 'facebook') !== 'facebook') {
        throw new Error('schedule_post currently supports facebook only.');
      }
      data = await runPostFacebook(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'post_instagram') {
      data = await runPostInstagram(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'post_whatsapp') {
      data = await runPostWhatsApp(intent, config, counters);
      return {
        success: true,
        data,
        error: null,
        metadata: baseMetadata(started, counters.apiCalls, 'depends on conversation category and region')
      };
    }

    if (intent.action === 'query_pages') {
      data = await runQueryPages(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'query_whatsapp_phone_numbers') {
      data = await runQueryWhatsAppPhoneNumbers(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'query_me') {
      data = await runQueryMe(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'query_instagram_media') {
      data = await runQueryInstagramMedia(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'check_limits') {
      data = await runCheckLimits(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'query_insights' || intent.action === 'get_analytics') {
      data = await runQueryInsights(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'list_campaigns') {
      data = await runListCampaigns(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    if (intent.action === 'create_campaign') {
      data = await runCreateCampaign(intent, config, counters);
      return { success: true, data, error: null, metadata: baseMetadata(started, counters.apiCalls, null) };
    }

    throw new Error(`Unsupported action: ${intent.action}`);
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

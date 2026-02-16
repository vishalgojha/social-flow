const {
  normalizeProvider,
  defaultModelForProvider,
  resolveApiKeyForProvider,
  hasProviderCredential,
  chatComplete
} = require('../llm-providers');
const { deterministicParse, listIntents } = require('./contract');
const ACTIONS = new Set([
  'post_facebook',
  'post_instagram',
  'post_whatsapp',
  'query_pages',
  'query_me',
  'query_whatsapp_phone_numbers',
  'query_insights',
  'schedule_post',
  'get_analytics',
  'check_limits',
  'list_campaigns',
  'create_campaign',
  'query_instagram_media',
  ...listIntents().map((x) => String(x.id || '').trim()).filter(Boolean)
]);

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\b/;
const URL_RE = /\bhttps?:\/\/[^\s)>"']+/gi;
const PHONE_RE = /\+\d{8,15}\b/;
const ACT_ID_RE = /\bact_\d+\b/i;

/**
 * @typedef {Object} ParsedIntent
 * @property {string} action
 * @property {"facebook"|"instagram"|"whatsapp"|null} api
 * @property {string|null} message
 * @property {string|null} caption
 * @property {string|null} page
 * @property {string|null} link
 * @property {string|null} imageUrl
 * @property {string|null} phone
 * @property {string|null} phoneId
 * @property {string[]|null} fields
 * @property {string|null} datetime
 * @property {string|null} accountId
 * @property {string|null} businessId
 * @property {string|null} campaignId
 * @property {"last_7d"|"last_30d"|"today"|null} preset
 * @property {number} confidence
 * @property {string|null} platform
 * @property {string|null} businessId
 * @property {string|null} recipientId
 * @property {string|null} recipientList
 * @property {string|null} messageBody
 * @property {string|null} packageName
 * @property {string|null} version
 * @property {string|null} connectorType
 * @property {string|null} connectorId
 * @property {string|null} callbackUrl
 * @property {string|null} verifyToken
 * @property {string|null} intentId
 * @property {string|null} domain
 * @property {string|null} metricType
 * @property {string|number|null} dailyBudget
 * @property {string|null} name
 * @property {string|null} objective
 * @property {string|null} budget
 * @property {string|null} status
 * @property {number|null} limit
 */

/**
 * @returns {ParsedIntent}
 */
function emptyIntent() {
  return {
    action: 'query_me',
    api: null,
    message: null,
    caption: null,
    page: null,
    link: null,
    imageUrl: null,
    phone: null,
    phoneId: null,
    fields: null,
    datetime: null,
    accountId: null,
    businessId: null,
    campaignId: null,
    preset: null,
    platform: null,
    businessId: null,
    recipientId: null,
    recipientList: null,
    messageBody: null,
    packageName: null,
    version: null,
    connectorType: null,
    connectorId: null,
    callbackUrl: null,
    verifyToken: null,
    intentId: null,
    domain: null,
    metricType: null,
    dailyBudget: null,
    confidence: 0.35,
    name: null,
    objective: null,
    budget: null,
    status: null,
    limit: null
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactToken(token) {
  if (!token) return '';
  const s = String(token);
  if (s.length < 10) return '***redacted***';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function logDebug(debug, message, payload) {
  if (!debug) return;
  if (payload === undefined) {
    console.log(`[social-ai] ${message}`);
    return;
  }
  console.log(`[social-ai] ${message}`, payload);
}

function firstMatch(text, re) {
  const m = String(text || '').match(re);
  return m ? m[0] : '';
}

function parseTimeParts(text) {
  const m = String(text || '').match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = (m[3] || '').toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseDateTimeFromText(text, now = new Date()) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const time = parseTimeParts(raw);

  let base = null;
  if (lower.includes('tomorrow')) {
    base = new Date(now.getTime());
    base.setDate(base.getDate() + 1);
  } else if (lower.includes('today')) {
    base = new Date(now.getTime());
  } else if (lower.includes('next week')) {
    base = new Date(now.getTime());
    base.setDate(base.getDate() + 7);
  }

  const isoDateMatch = raw.match(ISO_DATE_RE);
  if (isoDateMatch && isoDateMatch[0]) {
    const parsedMs = Date.parse(isoDateMatch[0].replace(' ', 'T'));
    if (!Number.isNaN(parsedMs)) {
      const out = new Date(parsedMs);
      if (time) {
        out.setHours(time.hour, time.minute, 0, 0);
      }
      return out.toISOString();
    }
  }

  if (base) {
    const out = new Date(base.getTime());
    if (time) {
      out.setHours(time.hour, time.minute, 0, 0);
    } else {
      out.setHours(9, 0, 0, 0);
    }
    return out.toISOString();
  }

  return null;
}

function parseQuotedText(text) {
  const m = String(text || '').match(/["']([^"']{2,500})["']/);
  return m ? m[1].trim() : '';
}

function parsePreset(text) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('last 7') || lower.includes('last seven') || lower.includes('last week')) return 'last_7d';
  if (lower.includes('last 30') || lower.includes('last month')) return 'last_30d';
  if (lower.includes('today')) return 'today';
  return null;
}

function parsePageName(text) {
  const raw = String(text || '');
  const quoted = raw.match(/to\s+["']([^"']+)["']\s+page/i);
  if (quoted) return quoted[1].trim();

  const unquoted = raw.match(/to\s+([A-Za-z0-9][A-Za-z0-9 '&._-]{2,80})\s+page/i);
  if (unquoted) {
    const name = unquoted[1].trim();
    const generic = new Set([
      'my',
      'my page',
      'facebook',
      'my facebook',
      'facebook page',
      'my facebook page'
    ]);
    if (generic.has(name.toLowerCase())) return null;
    return name;
  }
  return null;
}

function parsePhoneId(text) {
  const m = String(text || '').match(/\b(?:phone(?:[\s-]?id)?|from)\s*(?:is|=|:)?\s*(\d{6,20})\b/i);
  return m ? m[1] : null;
}

function parseBusinessId(text) {
  const raw = String(text || '');
  const hint = raw.match(/\b(?:business(?:[\s-]?id)?|waba)\s*(?:is|=|:|id)?\s*(\d{6,20})\b/i);
  if (hint) return hint[1];
  const generic = raw.match(/\b(\d{10,20})\b/);
  return generic ? generic[1] : null;
}

function parseFields(text) {
  const m = String(text || '').match(/\bfields?\s*[:=]?\s*([a-z0-9_, ]+)/i);
  if (!m || !m[1]) return null;
  const list = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

function normalizeAction(rawAction) {
  const action = String(rawAction || '').trim();
  if (ACTIONS.has(action)) return action;
  return 'query_me';
}

/**
 * Parse an LLM text payload into JSON.
 * @param {string} content
 * @returns {object|null}
 */
function parseJsonPayload(content) {
  const raw = String(content || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Normalize an intent payload to strict shape.
 * @param {object} src
 * @returns {ParsedIntent}
 */
function normalizeIntent(src) {
  const base = emptyIntent();
  const inObj = src && typeof src === 'object' ? src : {};
  const confidence = Number(inObj.confidence);

  base.action = normalizeAction(inObj.action);
  base.api = inObj.api === 'facebook' || inObj.api === 'instagram' || inObj.api === 'whatsapp'
    ? inObj.api
    : null;
  base.message = inObj.message ? String(inObj.message) : null;
  base.caption = inObj.caption ? String(inObj.caption) : null;
  base.page = inObj.page ? String(inObj.page) : null;
  base.link = inObj.link ? String(inObj.link) : null;
  base.imageUrl = inObj.imageUrl ? String(inObj.imageUrl) : null;
  base.phone = inObj.phone ? String(inObj.phone) : null;
  base.phoneId = inObj.phoneId ? String(inObj.phoneId) : null;
  base.fields = Array.isArray(inObj.fields) ? inObj.fields.map((s) => String(s)).filter(Boolean) : null;
  base.datetime = inObj.datetime ? String(inObj.datetime) : null;
  base.accountId = inObj.accountId ? String(inObj.accountId) : null;
  base.businessId = inObj.businessId ? String(inObj.businessId) : null;
  base.campaignId = inObj.campaignId ? String(inObj.campaignId) : null;
  base.platform = inObj.platform ? String(inObj.platform) : null;
  base.businessId = inObj.businessId ? String(inObj.businessId) : null;
  base.recipientId = inObj.recipientId ? String(inObj.recipientId) : null;
  base.recipientList = inObj.recipientList ? String(inObj.recipientList) : null;
  base.messageBody = inObj.messageBody ? String(inObj.messageBody) : null;
  base.packageName = inObj.packageName ? String(inObj.packageName) : null;
  base.version = inObj.version ? String(inObj.version) : null;
  base.connectorType = inObj.connectorType ? String(inObj.connectorType) : null;
  base.connectorId = inObj.connectorId ? String(inObj.connectorId) : null;
  base.callbackUrl = inObj.callbackUrl ? String(inObj.callbackUrl) : null;
  base.verifyToken = inObj.verifyToken ? String(inObj.verifyToken) : null;
  base.intentId = inObj.intentId ? String(inObj.intentId) : null;
  base.domain = inObj.domain ? String(inObj.domain) : null;
  base.metricType = inObj.metricType ? String(inObj.metricType) : null;
  base.dailyBudget = inObj.dailyBudget !== null && inObj.dailyBudget !== undefined ? inObj.dailyBudget : null;
  base.preset = inObj.preset === 'last_7d' || inObj.preset === 'last_30d' || inObj.preset === 'today'
    ? inObj.preset
    : null;
  base.confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : base.confidence;
  base.name = inObj.name ? String(inObj.name) : null;
  base.objective = inObj.objective ? String(inObj.objective) : null;
  base.budget = inObj.budget !== null && inObj.budget !== undefined ? String(inObj.budget) : null;
  base.status = inObj.status ? String(inObj.status).toUpperCase() : null;
  base.limit = Number.isFinite(Number(inObj.limit)) ? Number(inObj.limit) : null;
  return base;
}

function inferAction(text, url, phone) {
  const lower = String(text || '').toLowerCase();

  if (
    (lower.includes('whatsapp') || lower.includes('waba') || lower.includes('business id') || lower.includes('mobile number') || lower.includes('phone number')) &&
    (lower.includes('list') || lower.includes('listed') || lower.includes('show') || lower.includes('have any'))
  ) {
    return 'query_whatsapp_phone_numbers';
  }
  if (lower.includes('rate limit') || lower.includes('limit usage')) return 'check_limits';
  if ((lower.includes('create') || lower.includes('new')) && lower.includes('campaign')) return 'create_campaign';
  if ((lower.includes('list') || lower.includes('show')) && lower.includes('campaign')) return 'list_campaigns';
  if (lower.includes('insight') || lower.includes('analytics') || lower.includes('ad performance') || lower.includes('spend')) {
    return 'get_analytics';
  }
  if (lower.includes('schedule') || lower.includes('tomorrow') || lower.includes('next week')) return 'schedule_post';
  if ((lower.includes('whatsapp') || phone) && (lower.includes('send') || lower.includes('message'))) return 'post_whatsapp';
  if (lower.includes('instagram') && (lower.includes('post') || lower.includes('publish'))) return 'post_instagram';
  if (lower.includes('instagram') && (lower.includes('media') || lower.includes('posts') || lower.includes('recent'))) {
    return 'query_instagram_media';
  }
  if (lower.includes('page') && (lower.includes('list') || lower.includes('show') || lower.includes('what are'))) return 'query_pages';
  if (lower.includes('who am i') || lower.includes('my profile')) return 'query_me';
  if (lower.includes('post') && (lower.includes('facebook') || lower.includes('page'))) return 'post_facebook';
  if (lower.includes('post') && url) return 'post_facebook';
  return 'query_me';
}

function inferApi(text, action) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('whatsapp') || action === 'post_whatsapp' || action === 'query_whatsapp_phone_numbers') return 'whatsapp';
  if (lower.includes('instagram') || action === 'post_instagram' || action === 'query_instagram_media') return 'instagram';
  if (lower.includes('facebook') || action === 'post_facebook' || action === 'query_pages') return 'facebook';
  if (action === 'check_limits' || action === 'query_me' || action === 'get_analytics' || action === 'query_insights') return 'facebook';
  return null;
}

function parseCampaignParams(text, intent) {
  const raw = String(text || '');
  const nameMatch = raw.match(/campaign\s+["']([^"']+)["']/i);
  if (nameMatch) intent.name = nameMatch[1].trim();

  const objectiveMatch = raw.match(/\bobjective\s+([A-Z_]+)/i);
  if (objectiveMatch) intent.objective = objectiveMatch[1].trim().toUpperCase();

  const budgetMatch = raw.match(/\b(?:budget|daily budget)\s+(\d+)/i);
  if (budgetMatch) intent.budget = budgetMatch[1];

  const statusMatch = raw.match(/\bstatus\s+(ACTIVE|PAUSED)\b/i);
  if (statusMatch) intent.status = statusMatch[1].toUpperCase();
}

/**
 * Heuristic parser used as fallback when LLM parsing is unavailable.
 * @param {string} text
 * @returns {ParsedIntent}
 */
function heuristicParse(text) {
  const raw = String(text || '');
  const urls = raw.match(URL_RE) || [];
  const firstUrl = urls[0] || null;
  const phone = firstMatch(raw, PHONE_RE) || null;
  const quoted = parseQuotedText(raw);

  const intent = emptyIntent();
  intent.action = inferAction(raw, firstUrl, phone);
  intent.api = inferApi(raw, intent.action);
  intent.link = firstUrl;
  intent.imageUrl = firstUrl;
  intent.phone = phone;
  intent.phoneId = parsePhoneId(raw);
  intent.datetime = parseDateTimeFromText(raw);
  intent.page = parsePageName(raw);
  intent.fields = parseFields(raw);
  intent.preset = parsePreset(raw);
  intent.accountId = firstMatch(raw, ACT_ID_RE) || null;
  intent.businessId = parseBusinessId(raw);
  intent.confidence = 0.58;

  const limitMatch = raw.match(/\b(?:last|recent)\s+(\d{1,3})\b/i) || raw.match(/\blimit\s+(\d{1,3})\b/i);
  intent.limit = limitMatch ? parseInt(limitMatch[1], 10) : null;

  if (intent.action === 'post_facebook' || intent.action === 'schedule_post' || intent.action === 'post_whatsapp') {
    intent.message = quoted || null;
  }

  if (intent.action === 'post_instagram') {
    intent.caption = quoted || null;
  }

  if (intent.action === 'create_campaign') {
    parseCampaignParams(raw, intent);
    intent.confidence = 0.62;
  }

  if (!intent.message && (intent.action === 'post_facebook' || intent.action === 'post_whatsapp')) {
    const fallbackMessage = raw.match(/\bpost\s+(.+?)(?:\s+to\s+|\s+via\s+|$)/i);
    if (fallbackMessage && fallbackMessage[1]) intent.message = fallbackMessage[1].trim();
  }

  if (!intent.caption && intent.action === 'post_instagram') {
    const cap = raw.match(/\bcaption\s+["']?([^"']+)["']?/i);
    if (cap && cap[1]) intent.caption = cap[1].trim();
  }

  return intent;
}

function systemPrompt() {
  return [
    'You parse natural-language intents for a Meta APIs CLI.',
    'Return ONLY JSON. No markdown. No prose.',
    'Strict schema:',
    '{',
    '  "action": "post_facebook" | "post_instagram" | "post_whatsapp" | "query_pages" | "query_me" | "query_whatsapp_phone_numbers" | "query_insights" | "schedule_post" | "get_analytics" | "check_limits" | "list_campaigns" | "create_campaign" | "query_instagram_media",',
    '  "api": "facebook" | "instagram" | "whatsapp" | null,',
    '  "message": string | null,',
    '  "caption": string | null,',
    '  "page": string | null,',
    '  "link": string | null,',
    '  "imageUrl": string | null,',
    '  "phone": string | null,',
    '  "phoneId": string | null,',
    '  "fields": string[] | null,',
    '  "datetime": string | null,',
    '  "accountId": string | null,',
    '  "businessId": string | null,',
    '  "campaignId": string | null,',
    '  "preset": "last_7d" | "last_30d" | "today" | null,',
    '  "confidence": number,',
    '  "name": string | null,',
    '  "objective": string | null,',
    '  "budget": string | null,',
    '  "status": string | null,',
    '  "limit": number | null',
    '}',
    'Rules:',
    '- For missing values use null.',
    '- Convert relative datetime phrases to ISO8601.',
    '- Extract URLs and E.164 phone numbers.',
    '- Infer API from language context.',
    '- Confidence must be 0.0 to 1.0.'
  ].join('\n');
}

/**
 * Parse user intent with an OpenAI-compatible endpoint.
 * Falls back to heuristic parsing if LLM is unavailable.
 * @param {string} text
 * @param {object} [cfg]
 * @param {boolean} [cfg.debug]
 * @returns {Promise<ParsedIntent>}
 */
async function aiParseIntent(text, cfg = {}) {
  const input = String(text || '').trim();
  const debug = Boolean(cfg.debug);
  if (!input) {
    return normalizeIntent({ action: 'unknown_input', confidence: 1 });
  }
  const parsed = deterministicParse(input);
  if (!parsed) {
    logDebug(debug, 'Deterministic parser returned empty; routing to unknown_input.');
    return normalizeIntent({ action: 'unknown_input', confidence: 1 });
  }
  const normalized = normalizeIntent(parsed);
  if (!normalized.api && normalized.platform) normalized.api = normalized.platform;
  if (!normalized.datetime) normalized.datetime = parseDateTimeFromText(input);
  if (!normalized.link) normalized.link = firstMatch(input, URL_RE) || null;
  if (!normalized.phone) normalized.phone = firstMatch(input, PHONE_RE) || null;
  if (!normalized.page) normalized.page = parsePageName(input);
  return normalized;
}

module.exports = {
  aiParseIntent,
  heuristicParse,
  normalizeIntent,
  parseJsonPayload,
  parseDateTimeFromText
};

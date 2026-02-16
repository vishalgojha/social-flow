const {
  normalizeProvider,
  defaultModelForProvider,
  resolveApiKeyForProvider,
  hasProviderCredential,
  chatComplete
} = require('../llm-providers');
const ACTIONS = new Set([
  'post_facebook',
  'post_instagram',
  'post_whatsapp',
  'query_pages',
  'query_me',
  'query_insights',
  'schedule_post',
  'get_analytics',
  'check_limits',
  'list_campaigns',
  'create_campaign',
  'query_instagram_media'
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
 * @property {string|null} campaignId
 * @property {"last_7d"|"last_30d"|"today"|null} preset
 * @property {number} confidence
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
    campaignId: null,
    preset: null,
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
  base.campaignId = inObj.campaignId ? String(inObj.campaignId) : null;
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
  if (lower.includes('whatsapp') || action === 'post_whatsapp') return 'whatsapp';
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
    '  "action": "post_facebook" | "post_instagram" | "post_whatsapp" | "query_pages" | "query_me" | "query_insights" | "schedule_post" | "get_analytics" | "check_limits" | "list_campaigns" | "create_campaign" | "query_instagram_media",',
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
    return emptyIntent();
  }

  const provider = normalizeProvider(
    cfg.provider ||
    process.env.SOCIAL_AI_PROVIDER ||
    process.env.META_AI_PROVIDER ||
    'openai'
  );
  const model = process.env.SOCIAL_AI_MODEL || process.env.META_AI_MODEL || defaultModelForProvider(provider);
  const apiKey = resolveApiKeyForProvider(
    provider,
    process.env.SOCIAL_AI_KEY || process.env.META_AI_KEY || process.env.SOCIAL_AGENT_API_KEY || process.env.META_AGENT_API_KEY || ''
  );

  if (!hasProviderCredential(provider, apiKey)) {
    logDebug(debug, 'No LLM key available; using heuristic parser.');
    return heuristicParse(input);
  }

  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    try {
      logDebug(debug, `LLM parse attempt ${attempt}/${maxAttempts}`, {
        provider,
        model,
        auth: redactToken(apiKey)
      });
      const content = await chatComplete({
        provider,
        model,
        apiKey,
        system: systemPrompt(),
        user: input,
        temperature: 0,
        timeoutMs: 2200
      });
      const ms = Date.now() - started;
      logDebug(debug, `LLM parse request completed in ${ms}ms`);

      const parsed = parseJsonPayload(content);
      if (!parsed) {
        throw new Error('Model returned non-JSON response.');
      }

      const normalized = normalizeIntent(parsed);
      if (!normalized.datetime) {
        normalized.datetime = parseDateTimeFromText(input);
      }
      if (!normalized.link) {
        normalized.link = firstMatch(input, URL_RE) || null;
      }
      if (!normalized.imageUrl && normalized.action === 'post_instagram') {
        normalized.imageUrl = normalized.link;
      }
      if (!normalized.phone) {
        normalized.phone = firstMatch(input, PHONE_RE) || null;
      }
      if (!normalized.page) {
        normalized.page = parsePageName(input);
      }
      if (!normalized.api) {
        normalized.api = inferApi(input, normalized.action);
      }
      if (!normalized.preset) {
        normalized.preset = parsePreset(input);
      }
      return normalized;
    } catch (err) {
      lastErr = err;
      const isTimeout = err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message || ''));
      const status = Number(err?.response?.status || 0);
      const retryable = isTimeout || status >= 500 || status === 429;
      logDebug(debug, `LLM parse attempt ${attempt} failed`, {
        retryable,
        status,
        error: err?.message || String(err)
      });
      if (!retryable || attempt === maxAttempts) break;
      await sleep(150 * Math.pow(2, attempt - 1));
    }
  }

  logDebug(debug, 'Falling back to heuristic parser after LLM failure', {
    error: lastErr?.message || String(lastErr || '')
  });
  const fallback = heuristicParse(input);
  fallback.confidence = Math.min(fallback.confidence, 0.6);
  return fallback;
}

module.exports = {
  aiParseIntent,
  heuristicParse,
  normalizeIntent,
  parseJsonPayload,
  parseDateTimeFromText
};

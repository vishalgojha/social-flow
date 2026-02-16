const MetaAPIClient = require('../api-client');
const intentsSchema = require('./intents.json');
const {
  getIntentById,
  requiredSlots: contractRequiredSlots,
  disambiguationQuestions
} = require('./contract');

const E164_RE = /^\+\d{8,15}$/;

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === '') return [];
  return [v];
}

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFutureIso(value) {
  const ms = Date.parse(String(value || ''));
  if (Number.isNaN(ms)) return false;
  return ms > Date.now();
}

function normalizeDefaultApi(intent, config) {
  if (intent.platform && !intent.api) {
    intent.api = intent.platform;
    return;
  }
  if (intent.api) return;
  if (intent.action === 'query_pages') {
    intent.api = 'facebook';
    return;
  }
  if (intent.action === 'query_whatsapp_phone_numbers') {
    intent.api = 'whatsapp';
    return;
  }
  if (intent.action === 'broadcast_message' || intent.action === 'send_dm') {
    intent.api = intent.platform || 'whatsapp';
    return;
  }
  if (intent.action === 'query_me') {
    intent.api = config?.getDefaultApi ? config.getDefaultApi() : 'facebook';
    return;
  }
  if (intent.action === 'query_insights' || intent.action === 'get_analytics' || intent.action === 'list_campaigns' || intent.action === 'create_campaign') {
    intent.api = 'facebook';
  }
}

/**
 * Best-effort page resolver for friendly page names.
 * @param {string} pageInput
 * @param {object} config
 * @returns {Promise<{matched: object|null, pages: object[]}>}
 */
async function resolvePageByName(pageInput, config) {
  const token = config?.getToken ? config.getToken('facebook') : '';
  if (!token) return { matched: null, pages: [] };

  const client = new MetaAPIClient(token, 'facebook');
  const result = await client.getFacebookPages(100);
  const pages = result?.data || [];
  const raw = String(pageInput || '').trim();
  if (!raw) return { matched: null, pages };

  const exactId = pages.find((p) => String(p.id) === raw);
  if (exactId) return { matched: exactId, pages };

  const exactName = pages.find((p) => String(p.name).toLowerCase() === raw.toLowerCase());
  if (exactName) return { matched: exactName, pages };

  const contains = pages.find((p) => String(p.name).toLowerCase().includes(raw.toLowerCase()));
  return { matched: contains || null, pages };
}

function addMissingSuggestions(field, out) {
  if (field === 'page') {
    out.push("Missing page name. Which page should I post to? (e.g., 'My Business Page')");
  } else if (field === 'imageUrl') {
    out.push("Missing image URL for Instagram. Please provide a public image URL.");
  } else if (field === 'datetime') {
    out.push("When should this be posted? (e.g., 'tomorrow at 10am', '2026-02-20 15:00')");
  } else if (field === 'phone') {
    out.push("Missing phone number. Provide recipient in E.164 format (e.g., '+15551234567').");
  } else if (field === 'phoneId') {
    out.push("Missing WhatsApp phone id. Provide phone id (e.g., '123456789012345').");
  } else if (field === 'businessId') {
    out.push("Missing WhatsApp business id (WABA). Example: \"list my WhatsApp numbers for business id 123456789\".");
  } else if (field === 'platform') {
    out.push('Specify a platform: facebook, instagram, or whatsapp.');
  } else if (field === 'accountId') {
    out.push('Provide account id (for ads use act_123..., for WhatsApp use phone number id).');
  } else if (field === 'packageName') {
    out.push('Provide package name. Example: connector.slack.alerts');
  } else if (field === 'callbackUrl') {
    out.push('Provide callback URL for webhook registration.');
  } else if (field === 'verifyToken') {
    out.push('Provide webhook verify token.');
  } else if (field === 'recipientId') {
    out.push('Provide recipient id (E.164 phone for WhatsApp).');
  } else if (field === 'recipientList') {
    out.push('Provide recipient list (comma-separated).');
  } else if (field === 'metricType') {
    out.push('Metric type required: reach, impressions, engagement, conversions.');
  } else if (field === 'name') {
    out.push("Missing campaign name. Example: \"create campaign 'Summer Sale' ...\"");
  } else if (field === 'objective') {
    out.push('Missing campaign objective. Example: OUTCOME_SALES or LEAD_GENERATION.');
  } else if (field === 'budget') {
    out.push('Missing campaign budget. Example: daily budget 10000.');
  } else {
    out.push(`Missing required field: ${field}`);
  }
}

/**
 * Validate and enrich parsed intent.
 * @param {object} intent
 * @param {object} config
 * @returns {Promise<{valid: boolean, errors: string[], warnings: string[], suggestions: string[], missingFields: string[]}>}
 */
async function validateIntent(intent, config) {
  const errors = [];
  const warnings = [];
  const suggestions = [];
  const missingFields = [];

  if (!intent || typeof intent !== 'object') {
    return {
      valid: false,
      errors: ['Intent is empty or invalid.'],
      warnings: [],
      suggestions: ['Try a clearer instruction, e.g. "show my Facebook pages".'],
      missingFields: []
    };
  }

  const schemaAction = intentsSchema[intent.action];
  const contractAction = getIntentById(intent.action);
  if (!schemaAction && !contractAction) {
    errors.push(`Unsupported action: ${intent.action}`);
  }

  normalizeDefaultApi(intent, config);

  if (typeof intent.confidence === 'number' && intent.confidence < 0.45) {
    warnings.push(`Low parser confidence (${intent.confidence.toFixed(2)}). Please verify fields before executing.`);
  }

  const required = schemaAction
    ? toArray(schemaAction.required)
    : contractRequiredSlots(intent.action);
  required.forEach((field) => {
    if (intent[field] === null || intent[field] === undefined || intent[field] === '') {
      errors.push(`Missing required field: ${field}`);
      missingFields.push(field);
      addMissingSuggestions(field, suggestions);
    }
  });

  if (intent.action === 'unknown_input') {
    return {
      valid: true,
      errors: [],
      warnings: [],
      suggestions: disambiguationQuestions('unknown_input'),
      missingFields: []
    };
  }

  if (intent.action === 'post_whatsapp' && !intent.phoneId && config?.getDefaultWhatsAppPhoneNumberId) {
    const fromConfig = config.getDefaultWhatsAppPhoneNumberId();
    if (fromConfig) intent.phoneId = fromConfig;
  }

  if (intent.action === 'query_whatsapp_phone_numbers' && !intent.businessId) {
    const fromConfig = config?.getDefaultWhatsAppBusinessId ? config.getDefaultWhatsAppBusinessId() : '';
    const fromEnv = process.env.SOCIAL_DEFAULT_WABA_ID || process.env.META_DEFAULT_WABA_ID || '';
    const businessId = String(fromConfig || fromEnv || '').trim();
    if (businessId) {
      intent.businessId = businessId;
      warnings.push(`Using default WhatsApp business id: ${businessId}`);
    }
  }

  if (intent.action === 'post_facebook' && !intent.page && config?.getDefaultFacebookPageId) {
    const fromConfig = config.getDefaultFacebookPageId();
    if (fromConfig) {
      intent.page = fromConfig;
      warnings.push(`Using default Facebook page id from config: ${fromConfig}`);
    }
  }

  if ((intent.action === 'post_instagram' || intent.action === 'query_instagram_media') && !intent.accountId && config?.getDefaultIgUserId) {
    const fromConfig = config.getDefaultIgUserId();
    if (fromConfig) {
      intent.accountId = fromConfig;
      warnings.push(`Using default IG user id from config: ${fromConfig}`);
    }
  }

  if (intent.action === 'post_whatsapp' && intent.phone && !E164_RE.test(String(intent.phone))) {
    errors.push('Invalid phone format. Expected E.164 format like +15551234567.');
  }
  if (intent.action === 'query_whatsapp_phone_numbers' && intent.businessId && !/^\d{6,20}$/.test(String(intent.businessId))) {
    errors.push('Invalid businessId. Expected numeric WABA id (6-20 digits).');
  }

  if (intent.link && !isHttpUrl(intent.link)) {
    errors.push(`Invalid link URL: ${intent.link}`);
  }
  if (intent.imageUrl && !isHttpUrl(intent.imageUrl)) {
    errors.push(`Invalid imageUrl URL: ${intent.imageUrl}`);
  }

  if (intent.action === 'schedule_post') {
    if (!intent.datetime) {
      errors.push('Missing required field: datetime');
      missingFields.push('datetime');
      addMissingSuggestions('datetime', suggestions);
    } else if (!isFutureIso(intent.datetime)) {
      errors.push('Scheduled datetime must be in the future.');
    }
  }

  if (intent.datetime && Number.isNaN(Date.parse(intent.datetime))) {
    errors.push(`Invalid datetime: ${intent.datetime}`);
  }

  if ((intent.action === 'query_insights' || intent.action === 'get_analytics' || intent.action === 'list_campaigns' || intent.action === 'create_campaign')
    && intent.accountId && !String(intent.accountId).startsWith('act_')) {
    warnings.push(`Ad account id usually starts with "act_". Received: ${intent.accountId}`);
  }

  if (intent.action === 'create_campaign') {
    if (intent.budget && !/^\d+$/.test(String(intent.budget))) {
      errors.push('Campaign budget must be an integer in minor currency units (e.g. 10000).');
    }
    if (intent.status && intent.status !== 'ACTIVE' && intent.status !== 'PAUSED') {
      errors.push('Campaign status must be ACTIVE or PAUSED.');
    }
  }

  if (intent.action === 'post_facebook' || (intent.action === 'schedule_post' && intent.api === 'facebook')) {
    if (!intent.page) {
      warnings.push('No page provided; default page id will be used if configured.');
      suggestions.push("Specify a target page for safer posting (e.g., \"to My Business Page\").");
    } else {
      try {
        const { matched, pages } = await resolvePageByName(intent.page, config);
        if (!matched) {
          const preview = pages.slice(0, 5).map((p) => p.name).join(', ');
          errors.push(`Could not match page "${intent.page}" to your accessible pages.`);
          if (preview) {
            suggestions.push(`Try one of your known pages: ${preview}`);
          }
        } else {
          intent.page = matched.id;
          intent.pageName = matched.name; // eslint-disable-line no-param-reassign
        }
      } catch (e) {
        warnings.push(`Could not validate page name against API: ${e.message}`);
      }
    }
  }

  if (!intent.api && intent.action !== 'create_campaign' && intent.action !== 'list_campaigns' && intent.action !== 'query_insights' && intent.action !== 'get_analytics') {
    warnings.push('API could not be inferred; default API will be used.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    suggestions,
    missingFields
  };
}

module.exports = {
  validateIntent,
  isHttpUrl,
  resolvePageByName
};

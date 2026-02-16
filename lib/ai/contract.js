const contract = require('./intent-contract.json');

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[!?.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listIntents() {
  return Array.isArray(contract.intents) ? contract.intents : [];
}

function getIntentById(id) {
  const key = String(id || '').trim();
  return listIntents().find((x) => x.id === key) || null;
}

function unknownIntent() {
  return getIntentById('unknown_input');
}

function containsWholePhrase(text, phrase) {
  const hay = ` ${normalizeText(text)} `;
  const needle = ` ${normalizeText(phrase)} `;
  return hay.includes(needle);
}

function pickBestIntent(text) {
  const raw = normalizeText(text);
  if (!raw) return unknownIntent();
  let best = null;
  let score = -1;
  const intents = listIntents().filter((x) => x.id !== 'unknown_input');
  intents.forEach((intent) => {
    const negatives = Array.isArray(intent.negative_utterances) ? intent.negative_utterances : [];
    if (negatives.some((n) => containsWholePhrase(raw, n))) return;
    const utterances = Array.isArray(intent.utterances) ? intent.utterances : [];
    utterances.forEach((u) => {
      if (!containsWholePhrase(raw, u)) return;
      const s = normalizeText(u).length;
      if (s > score) {
        score = s;
        best = intent;
      }
    });
  });
  return best || unknownIntent();
}

function parseQuoted(raw) {
  const m = String(raw || '').match(/["']([^"']{1,500})["']/);
  return m ? m[1].trim() : '';
}

function parsePlatform(raw) {
  const s = normalizeText(raw);
  if (/\bfacebook\b/.test(s)) return 'facebook';
  if (/\binstagram\b/.test(s)) return 'instagram';
  if (/\bwhatsapp\b/.test(s)) return 'whatsapp';
  return '';
}

function parseUrl(raw) {
  const m = String(raw || '').match(/\bhttps?:\/\/[^\s)>"']+/i);
  return m ? m[0] : '';
}

function parseNumber(raw, pattern) {
  const m = String(raw || '').match(pattern);
  return m ? m[1] : '';
}

function parseSemver(raw) {
  const m = String(raw || '').match(/\b\d+\.\d+\.\d+\b/);
  return m ? m[0] : '';
}

function parseDatetime(raw) {
  const direct = String(raw || '').match(/\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b/);
  if (!direct) return '';
  const ms = Date.parse(direct[0].replace(' ', 'T'));
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toISOString();
}

function parseObjective(raw) {
  const m = String(raw || '').toUpperCase().match(/\b(AWARENESS|TRAFFIC|LEADS|SALES)\b/);
  return m ? m[1] : '';
}

function parseMetricType(raw) {
  const m = normalizeText(raw).match(/\b(reach|impressions|engagement|conversions)\b/);
  return m ? m[1] : '';
}

function parseConnectorType(raw) {
  const m = normalizeText(raw).match(/\b(facebook_webhook|instagram_webhook|whatsapp_webhook|custom)\b/);
  return m ? m[1] : '';
}

function parseIntentId(raw) {
  const all = listIntents().map((x) => x.id);
  const text = normalizeText(raw);
  return all.find((id) => containsWholePhrase(text, id)) || '';
}

function parseAccountId(raw) {
  const exactAct = parseNumber(raw, /\b(act_[A-Za-z0-9_]+)\b/i);
  if (exactAct) return exactAct;
  const explicit = parseNumber(raw, /\baccount(?: id)?\s*(?:is|=|:)?\s*([A-Za-z0-9_+-]{3,64})\b/i);
  if (explicit) return explicit;
  return '';
}

function parsePackageName(raw) {
  const explicit = parseNumber(raw, /\bpackage(?: name)?\s*(?:is|=|:)?\s*([A-Za-z0-9._-]{2,128})\b/i);
  if (explicit) return explicit;
  const verbs = String(raw || '').match(/\b(?:install|update|rollback|verify trust)\s+([A-Za-z0-9._-]{2,128})\b/i);
  return verbs ? verbs[1] : '';
}

function parseRecipientId(raw) {
  const phone = parseNumber(raw, /(\+\d{8,15})\b/);
  if (phone) return phone;
  const generic = parseNumber(raw, /\brecipient(?: id)?\s*(?:is|=|:)?\s*([A-Za-z0-9_+-]{3,64})\b/i);
  return generic || '';
}

function parseRecipientList(raw) {
  const m = String(raw || '').match(/\b(?:recipients?|list)\s*(?:is|=|:)?\s*([A-Za-z0-9+_, -]{3,500})\b/i);
  return m ? m[1].trim() : '';
}

function parseSlot(raw, slotName) {
  const s = String(slotName || '');
  if (s === 'platform') return parsePlatform(raw);
  if (s === 'accountId') return parseAccountId(raw);
  if (s === 'message') return parseQuoted(raw);
  if (s === 'messageBody') return parseQuoted(raw);
  if (s === 'mediaUrl') return parseUrl(raw);
  if (s === 'scheduledAt') return parseDatetime(raw);
  if (s === 'recipientId') return parseRecipientId(raw);
  if (s === 'adName') return parseQuoted(raw);
  if (s === 'objective') return parseObjective(raw);
  if (s === 'dailyBudget') {
    const v = parseNumber(raw, /\b(?:daily budget|budget)\s*(?:is|=|:)?\s*(\d{1,12})\b/i);
    return v ? Number(v) : null;
  }
  if (s === 'creativeText') return parseQuoted(raw);
  if (s === 'creativeUrl') return parseUrl(raw);
  if (s === 'recipientList') return parseRecipientList(raw);
  if (s === 'templateName') return parseNumber(raw, /\btemplate(?: name)?\s*(?:is|=|:)?\s*([A-Za-z0-9._-]{2,128})\b/i);
  if (s === 'metricType') return parseMetricType(raw);
  if (s === 'since') return parseDatetime(raw);
  if (s === 'until') return parseDatetime(raw);
  if (s === 'callbackUrl') return parseUrl(raw);
  if (s === 'verifyToken') return parseNumber(raw, /\bverify(?: token)?\s*(?:is|=|:)?\s*([A-Za-z0-9._-]{3,128})\b/i);
  if (s === 'packageName') return parsePackageName(raw);
  if (s === 'version') return parseSemver(raw);
  if (s === 'query') return parseQuoted(raw) || normalizeText(raw);
  if (s === 'domain') return parseNumber(raw, /\b(marketing|developer|ops|connector|auth|hub)\b/i).toLowerCase();
  if (s === 'connectorType') return parseConnectorType(raw);
  if (s === 'connectorId') return parseNumber(raw, /\bconnector(?: id)?\s*(?:is|=|:)?\s*([A-Za-z0-9._-]{2,128})\b/i);
  if (s === 'intentId') return parseIntentId(raw);
  return '';
}

function deterministicParse(text) {
  const chosen = pickBestIntent(text);
  if (!chosen) return null;
  const out = {
    action: chosen.id,
    confidence: 0.98
  };
  const slots = [
    ...(Array.isArray(chosen.required_slots) ? chosen.required_slots : []),
    ...(Array.isArray(chosen.optional_slots) ? chosen.optional_slots : [])
  ];
  slots.forEach((slot) => {
    const key = slot?.name;
    if (!key) return;
    const val = parseSlot(text, key);
    if (val !== '' && val !== null && val !== undefined) out[key] = val;
  });
  return out;
}

function intentRisk(action) {
  const row = getIntentById(action);
  return row ? row.risk : 'low';
}

function requiredSlots(action) {
  const row = getIntentById(action);
  if (!row || !Array.isArray(row.required_slots)) return [];
  return row.required_slots.map((x) => String(x.name || '').trim()).filter(Boolean);
}

function disambiguationQuestions(action) {
  const row = getIntentById(action);
  if (!row || !Array.isArray(row.disambiguation_questions)) return [];
  return row.disambiguation_questions.map((x) => String(x || '').trim()).filter(Boolean);
}

module.exports = {
  contract,
  listIntents,
  getIntentById,
  unknownIntent,
  deterministicParse,
  intentRisk,
  requiredSlots,
  disambiguationQuestions
};

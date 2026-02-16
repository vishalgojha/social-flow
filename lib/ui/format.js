const intentsSchema = require('../ai/intents.json');
const { getIntentById, intentRisk } = require('../ai/contract');

function titleForAction(action) {
  const labels = {
    post_facebook: 'Post to Facebook Page',
    post_instagram: 'Post to Instagram',
    post_whatsapp: 'Send WhatsApp Message',
    query_whatsapp_phone_numbers: 'List WhatsApp Phone Numbers',
    query_pages: 'List Facebook Pages',
    query_me: 'Get Profile',
    query_insights: 'Get Campaign Insights',
    schedule_post: 'Schedule Post',
    get_analytics: 'Get Analytics',
    check_limits: 'Check Rate Limits',
    list_campaigns: 'List Campaigns',
    create_campaign: 'Create Campaign',
    query_instagram_media: 'Get Instagram Media'
  };
  if (labels[action]) return labels[action];
  const contractIntent = getIntentById(action);
  if (contractIntent?.title) return contractIntent.title;
  return action;
}

function riskForAction(action) {
  return intentsSchema[action]?.risk || intentRisk(action) || 'low';
}

function pair(label, value) {
  return `${label.padEnd(10)} ${value === null || value === undefined || value === '' ? '-' : String(value)}`;
}

function box(lines) {
  const width = Math.max(...lines.map((l) => l.length), 48);
  const top = `+${'-'.repeat(width + 2)}+`;
  const body = lines.map((line) => `| ${line.padEnd(width)} |`).join('\n');
  return `${top}\n${body}\n${top}`;
}

/**
 * Build a human-friendly parsed intent panel for confirmation screens.
 * @param {object} intent
 * @returns {string}
 */
function formatParsedIntent(intent) {
  const risk = riskForAction(intent.action).toUpperCase();
  const lines = [
    'Parsed Intent',
    '',
    pair('Action:', titleForAction(intent.action)),
    pair('API:', intent.api || 'facebook'),
    pair('Platform:', intent.platform || ''),
    pair('Account:', intent.accountId || ''),
    pair('Page:', intent.pageName || intent.page || ''),
    pair('Message:', intent.message || intent.caption || intent.messageBody || ''),
    pair('Link:', intent.link || intent.imageUrl || ''),
    pair('Phone:', intent.phone || ''),
    pair('Business:', intent.businessId || ''),
    pair('Package:', intent.packageName || ''),
    pair('Time:', intent.datetime ? new Date(intent.datetime).toLocaleString() : 'Now'),
    pair('Risk:', risk)
  ];
  return box(lines);
}

module.exports = {
  formatParsedIntent,
  riskForAction,
  titleForAction
};

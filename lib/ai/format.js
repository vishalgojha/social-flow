const chalk = require('chalk');
const { formatTable } = require('../formatters');

function withCommas(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return n.toLocaleString();
}

function printPostResult(data) {
  if (data?.id) console.log(chalk.cyan('  ID:'), data.id);
  if (data?.page?.name || data?.page?.id) {
    console.log(chalk.cyan('  Page:'), `${data.page.name || ''} (${data.page.id || ''})`.trim());
  }
  if (data?.publish?.id) {
    console.log(chalk.cyan('  Publish ID:'), data.publish.id);
  }
}

function printUsage(result) {
  const usage = result?.usage || {};
  const keys = ['call_count', 'total_time', 'total_cputime'];
  console.log(chalk.bold('\nRate Limit Usage:'));
  keys.forEach((k) => {
    if (usage[k] === undefined) return;
    console.log(chalk.cyan(`  ${k}:`), `${usage[k]}%`);
  });
  if (!keys.some((k) => usage[k] !== undefined)) {
    console.log(chalk.gray('  No usage header returned.'));
  }
  console.log('');
}

/**
 * Pretty-print AI command results based on action type.
 * @param {{data: any}} result
 * @param {string} actionType
 */
function formatResult(result, actionType) {
  const data = result?.data;

  if (actionType === 'post_facebook' || actionType === 'schedule_post' || actionType === 'post_instagram' || actionType === 'post_whatsapp') {
    console.log(chalk.bold('\nWrite Result:'));
    printPostResult(data);
    if (actionType === 'post_whatsapp') {
      const msgId = data?.messages?.[0]?.id;
      if (msgId) console.log(chalk.cyan('  Message ID:'), msgId);
    }
    console.log('');
    return;
  }

  if (actionType === 'query_pages') {
    const rows = (data?.data || []).map((p, idx) => ({
      '#': idx + 1,
      name: p.name || '',
      category: p.category || '',
      fans: withCommas(p.fan_count || 0)
    }));
    console.log(formatTable(rows, ['#', 'name', 'category', 'fans']));
    console.log('');
    return;
  }

  if (actionType === 'query_me') {
    console.log(chalk.bold('\nProfile:'));
    Object.entries(data || {}).forEach(([k, v]) => {
      console.log(chalk.cyan(`  ${k}:`), typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    console.log('');
    return;
  }

  if (actionType === 'query_whatsapp_phone_numbers') {
    const rows = (data?.data || []).map((n, idx) => ({
      '#': idx + 1,
      number: n.display_phone_number || '',
      verified_name: n.verified_name || '',
      quality: n.quality_rating || '',
      status: n.name_status || '',
      id: n.id || ''
    }));
    if (!rows.length) {
      console.log(chalk.yellow('\nNo WhatsApp phone numbers found for this business id.\n'));
      return;
    }
    console.log(formatTable(rows, ['#', 'number', 'verified_name', 'quality', 'status', 'id']));
    console.log('');
    return;
  }

  if (actionType === 'query_instagram_media') {
    const rows = (data?.data || []).map((m, idx) => ({
      '#': idx + 1,
      id: m.id,
      type: m.media_type,
      timestamp: m.timestamp || '',
      permalink: m.permalink || ''
    }));
    console.log(formatTable(rows, ['#', 'type', 'id', 'timestamp']));
    console.log('');
    return;
  }

  if (actionType === 'doctor') {
    const rows = Array.isArray(data?.checks) ? data.checks : [];
    if (!rows.length) {
      console.log(chalk.yellow('\nNo diagnostics returned.\n'));
      return;
    }
    console.log(formatTable(rows, ['check', 'status', 'message']));
    console.log('');
    return;
  }

  if (actionType === 'search_intents') {
    const rows = Array.isArray(data?.intents) ? data.intents : [];
    if (!rows.length) {
      console.log(chalk.yellow('\nNo intents matched.\n'));
      return;
    }
    console.log(formatTable(rows, ['id', 'title', 'domain', 'risk']));
    console.log('');
    return;
  }

  if (
    actionType === 'connect_account' ||
    actionType === 'disconnect_account' ||
    actionType === 'refresh_token' ||
    actionType === 'install_hub_package' ||
    actionType === 'update_hub_packages' ||
    actionType === 'rollback_update' ||
    actionType === 'verify_trust' ||
    actionType === 'inspect_intent' ||
    actionType === 'set_default_account' ||
    actionType === 'unknown_input'
  ) {
    console.log(chalk.bold('\nResult:'));
    console.log(JSON.stringify(data, null, 2));
    console.log('');
    return;
  }

  if (actionType === 'query_insights' || actionType === 'get_analytics') {
    const rows = data?.rows || [];
    if (!rows.length) {
      console.log(chalk.yellow('\nNo insights rows returned.\n'));
      return;
    }
    const cols = ['campaign_name', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm']
      .filter((c) => Object.prototype.hasOwnProperty.call(rows[0], c));
    const columns = cols.length ? cols : Object.keys(rows[0]).slice(0, 8);
    console.log(formatTable(rows, columns));
    if (data?.summary) {
      console.log(chalk.bold('\nSummary:'));
      console.log(chalk.cyan('  Spend:'), data.summary.spend);
      console.log(chalk.cyan('  Impressions:'), withCommas(data.summary.impressions));
      console.log(chalk.cyan('  Clicks:'), withCommas(data.summary.clicks));
    }
    console.log('');
    return;
  }

  if (actionType === 'list_campaigns') {
    const rows = (data || []).map((c, idx) => ({
      '#': idx + 1,
      name: c.name || '',
      id: c.id,
      objective: c.objective || '',
      status: c.status || ''
    }));
    console.log(formatTable(rows, ['#', 'name', 'id', 'objective', 'status']));
    console.log('');
    return;
  }

  if (actionType === 'check_limits') {
    printUsage(data);
    return;
  }

  if (actionType === 'create_campaign') {
    console.log(chalk.bold('\nCampaign Created:'));
    if (data?.id) console.log(chalk.cyan('  ID:'), data.id);
    console.log('');
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

module.exports = {
  formatResult
};

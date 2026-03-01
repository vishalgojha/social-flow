const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const config = require('../lib/config');
const {
  parseCsv,
  normalizeAct,
  ensureMarketingToken,
  warnIfOldApiVersion,
  paginate,
  summarizeInsights,
  printInsightsSummary,
  getAdsRateLimitSnapshot,
  startAsyncInsightsJob,
  pollInsightsJob,
  fetchAsyncInsightsResults,
  printTableOrJson,
  exportInsights,
  resolveActForCampaign,
  resolveActForAdSet,
  uploadAdImageByUrl,
  uploadAdVideoByUrl,
  createAdSet,
  createCreative,
  createAd,
  MetaAPIClient
} = require('../lib/marketing');
const { sanitizeForLog } = require('../lib/api');

function getDefaultActOrFromArg(adAccountId) {
  const fromCfg = config.getDefaultMarketingAdAccountId();
  return normalizeAct(adAccountId || fromCfg);
}

function requireAct(adAccountId) {
  const act = getDefaultActOrFromArg(adAccountId);
  if (!act) {
    console.error(chalk.red('X Missing ad account id.'));
    console.error(chalk.gray('  Provide an id like: act_123 or 123'));
    console.error(chalk.gray('  Or set a default: social marketing set-default-account act_123'));
    process.exit(1);
  }
  return act;
}

function presetToDatePreset(preset) {
  const p = String(preset || '').toLowerCase().trim();
  if (p === 'last_7d') return 'last_7d';
  if (p === 'last_30d') return 'last_30d';
  if (p === 'last_90d') return 'last_90d';
  if (p === 'today') return 'today';
  if (p === 'yesterday') return 'yesterday';
  // Pass-through for power users.
  return p || 'last_7d';
}

function parseJsonArgOrFile(value, filePath, label) {
  if (filePath) {
    const p = String(filePath);
    const raw = fs.readFileSync(p, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON in ${label} file: ${p}`);
    }
  }
  if (!value) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error(`Invalid JSON for ${label}. Provide valid JSON or use --${label}-file.`);
  }
}

function parseNumberOrZero(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value || '0'));
  if (!Number.isFinite(n)) return 0;
  return n;
}

function parsePositiveNumber(value, fallback = 0) {
  const n = parseFloat(String(value || ''));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function daysForPreset(preset) {
  const p = String(preset || '').toLowerCase().trim();
  if (p === 'last_7d') return 7;
  if (p === 'last_30d') return 30;
  if (p === 'last_90d') return 90;
  if (p === 'today') return 1;
  if (p === 'yesterday') return 1;
  return 7;
}

function parseTotalCountFromPagingResponse(response) {
  const n = parseInt(String(response?.summary?.total_count || ''), 10);
  if (Number.isFinite(n)) return n;
  if (Array.isArray(response?.data)) return response.data.length;
  return 0;
}

function parseTargetsFile(filePath) {
  const fullPath = path.resolve(String(filePath || '').trim());
  if (!fullPath) return {};
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Targets file not found: ${fullPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    throw new Error(`Invalid JSON in targets file: ${fullPath}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Targets file must be a JSON object: {"profileName": 120.5, "default": 95}');
  }
  const out = {};
  Object.entries(parsed).forEach(([k, v]) => {
    const key = String(k || '').trim();
    if (!key) return;
    const n = parsePositiveNumber(v, -1);
    if (n >= 0) out[key] = n;
  });
  return out;
}

function resolveDailyTarget({ profile, targetsByProfile, defaultDailyTarget }) {
  if (Object.prototype.hasOwnProperty.call(targetsByProfile, profile)) {
    return parsePositiveNumber(targetsByProfile[profile], defaultDailyTarget);
  }
  if (Object.prototype.hasOwnProperty.call(targetsByProfile, 'default')) {
    return parsePositiveNumber(targetsByProfile.default, defaultDailyTarget);
  }
  return defaultDailyTarget;
}

function paceStatus(spend, targetWindow) {
  if (!(targetWindow > 0)) return 'n/a';
  const ratio = spend / targetWindow;
  if (ratio > 1.2) return 'over';
  if (ratio < 0.8) return 'under';
  return 'on_track';
}

function summarizePortfolioRows(rows) {
  const cleanRows = Array.isArray(rows) ? rows : [];
  const actionable = cleanRows.filter((r) => r.health !== 'error' && r.health !== 'config_missing' && r.health !== 'profile_missing');
  const totalSpend = actionable.reduce((acc, r) => acc + parseNumberOrZero(r.spend), 0);
  const totalTargetWindow = actionable.reduce((acc, r) => acc + parseNumberOrZero(r.target_window), 0);
  const healthCounts = cleanRows.reduce((acc, r) => {
    const key = String(r.health || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    profiles_scanned: cleanRows.length,
    actionable_profiles: actionable.length,
    total_spend: Number(totalSpend.toFixed(2)),
    total_target_window: Number(totalTargetWindow.toFixed(2)),
    over_pacing_count: actionable.filter((r) => r.pace_status === 'over').length,
    under_pacing_count: actionable.filter((r) => r.pace_status === 'under').length,
    health_counts: healthCounts
  };
}

function parseIntegerOrFallback(value, fallback = 0) {
  const n = parseInt(String(value || ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function median(values) {
  const sorted = (Array.isArray(values) ? values : [])
    .map((v) => parseNumberOrZero(v))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundMetric(value, digits = 2) {
  const n = parseNumberOrZero(value);
  return Number(n.toFixed(digits));
}

function normalizeAdInsightRow(row) {
  return {
    ad_id: String(row?.ad_id || ''),
    ad_name: String(row?.ad_name || ''),
    campaign_id: String(row?.campaign_id || ''),
    campaign_name: String(row?.campaign_name || ''),
    adset_id: String(row?.adset_id || ''),
    adset_name: String(row?.adset_name || ''),
    spend: parseNumberOrZero(row?.spend),
    impressions: Math.round(parseNumberOrZero(row?.impressions)),
    clicks: Math.round(parseNumberOrZero(row?.clicks)),
    ctr: parseNumberOrZero(row?.ctr), // % value from Ads Insights
    cpc: parseNumberOrZero(row?.cpc),
    cpm: parseNumberOrZero(row?.cpm)
  };
}

function reasonLabel(code) {
  if (code === 'no_clicks_on_spend') return 'spent_with_no_clicks';
  if (code === 'low_ctr') return 'low_ctr_vs_baseline';
  if (code === 'high_cpc') return 'high_cpc_vs_baseline';
  if (code === 'high_cpm') return 'high_cpm_vs_baseline';
  return code;
}

function recommendationForReasons(reasons) {
  const set = new Set(Array.isArray(reasons) ? reasons : []);
  if (set.has('no_clicks_on_spend')) {
    return 'Pause or refresh this ad before more spend.';
  }
  if (set.has('low_ctr') && set.has('high_cpc')) {
    return 'Refresh creative and tighten audience/placements.';
  }
  if (set.has('low_ctr')) return 'Test a new hook/creative variant.';
  if (set.has('high_cpc')) return 'Adjust targeting or bid strategy.';
  if (set.has('high_cpm')) return 'Review placement mix and audience overlap.';
  return 'Review relevance, audience fit, and landing page intent.';
}

function diagnosePoorAds(rows, options = {}) {
  const minImpressions = parsePositiveNumber(options.minImpressions, 1000);
  const minClicks = parsePositiveNumber(options.minClicks, 5);
  const minSpend = parsePositiveNumber(options.minSpend, 10);
  const ctrDropFactor = parsePositiveNumber(options.ctrDropFactor, 0.6) || 0.6;
  const cpcRiseFactor = parsePositiveNumber(options.cpcRiseFactor, 1.5) || 1.5;
  const cpmRiseFactor = parsePositiveNumber(options.cpmRiseFactor, 1.4) || 1.4;

  const normalized = (Array.isArray(rows) ? rows : [])
    .map(normalizeAdInsightRow)
    .filter((r) => r.ad_id || r.ad_name);

  const ctrBaseline = median(
    normalized
      .filter((r) => r.impressions >= minImpressions && r.ctr > 0)
      .map((r) => r.ctr)
  ) || 1.0;

  const cpcBaseline = median(
    normalized
      .filter((r) => r.clicks >= minClicks && r.cpc > 0)
      .map((r) => r.cpc)
  ) || 2.0;

  const cpmBaseline = median(
    normalized
      .filter((r) => r.impressions >= minImpressions && r.cpm > 0)
      .map((r) => r.cpm)
  ) || 20.0;

  const ctrThreshold = Math.max(0.1, ctrBaseline * ctrDropFactor);
  const cpcThreshold = Math.max(0.1, cpcBaseline * cpcRiseFactor);
  const cpmThreshold = Math.max(0.1, cpmBaseline * cpmRiseFactor);

  const flagged = [];
  normalized.forEach((r) => {
    if (r.spend < minSpend && r.impressions < minImpressions) return;

    const reasons = [];
    let score = 0;

    if (r.spend >= minSpend && r.clicks === 0) {
      reasons.push('no_clicks_on_spend');
      score += 4;
    }
    if (r.impressions >= minImpressions && r.ctr <= ctrThreshold) {
      reasons.push('low_ctr');
      score += 3;
    }
    if (r.clicks >= minClicks && r.cpc >= cpcThreshold) {
      reasons.push('high_cpc');
      score += 2;
    }
    if (r.impressions >= minImpressions && r.cpm >= cpmThreshold) {
      reasons.push('high_cpm');
      score += 1;
    }
    if (!reasons.length) return;

    let spendAtRisk = 0;
    if (reasons.includes('no_clicks_on_spend')) spendAtRisk = r.spend;
    else if (reasons.includes('low_ctr')) spendAtRisk = r.spend * 0.45;
    if (reasons.includes('high_cpc')) spendAtRisk += r.spend * 0.2;
    spendAtRisk = Math.min(r.spend, spendAtRisk);

    flagged.push({
      ...r,
      score,
      reasons,
      reason_labels: reasons.map(reasonLabel),
      recommended_action: recommendationForReasons(reasons),
      spend_at_risk_estimate: roundMetric(spendAtRisk, 2)
    });
  });

  flagged.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.spend !== a.spend) return b.spend - a.spend;
    return b.impressions - a.impressions;
  });

  const scannedSpend = normalized.reduce((acc, r) => acc + parseNumberOrZero(r.spend), 0);
  const flaggedSpend = flagged.reduce((acc, r) => acc + parseNumberOrZero(r.spend), 0);
  const spendAtRisk = flagged.reduce((acc, r) => acc + parseNumberOrZero(r.spend_at_risk_estimate), 0);

  return {
    thresholds: {
      min_impressions: minImpressions,
      min_clicks: minClicks,
      min_spend: roundMetric(minSpend, 2),
      ctr_drop_factor: roundMetric(ctrDropFactor, 2),
      cpc_rise_factor: roundMetric(cpcRiseFactor, 2),
      cpm_rise_factor: roundMetric(cpmRiseFactor, 2),
      ctr_threshold_pct: roundMetric(ctrThreshold, 2),
      cpc_threshold: roundMetric(cpcThreshold, 2),
      cpm_threshold: roundMetric(cpmThreshold, 2)
    },
    baselines: {
      median_ctr_pct: roundMetric(ctrBaseline, 2),
      median_cpc: roundMetric(cpcBaseline, 2),
      median_cpm: roundMetric(cpmBaseline, 2)
    },
    summary: {
      ads_scanned: normalized.length,
      flagged_ads: flagged.length,
      scanned_spend: roundMetric(scannedSpend, 2),
      flagged_spend: roundMetric(flaggedSpend, 2),
      spend_at_risk_estimate: roundMetric(spendAtRisk, 2)
    },
    rows: flagged
  };
}

async function confirmHighRisk(message, yesFlag) {
  if (yesFlag) return true;
  if (!process.stdout.isTTY) return false;
  const ans = await inquirer.prompt([
    { type: 'confirm', name: 'ok', default: false, message }
  ]);
  return Boolean(ans.ok);
}

function normalizeStatus(status) {
  const s = String(status || '').toUpperCase().trim();
  if (!s) return '';
  return s;
}

function normalizeType(type) {
  const t = String(type || '').toLowerCase().trim();
  if (t === 'campaign' || t === 'campaigns') return 'campaign';
  if (t === 'adset' || t === 'adsets' || t === 'ad_set') return 'adset';
  if (t === 'ad' || t === 'ads') return 'ad';
  return '';
}

function typeLabel(type) {
  if (type === 'campaign') return 'campaign';
  if (type === 'adset') return 'ad set';
  if (type === 'ad') return 'ad';
  return 'object';
}

async function doSetStatus({ type, id, status, options }) {
  warnIfOldApiVersion();
  const token = ensureMarketingToken();
  const objType = normalizeType(type);
  if (!objType) {
    console.error(chalk.red('X Invalid type. Use: campaign, adset, ad'));
    process.exit(1);
  }

  const st = normalizeStatus(status);
  if (!st || (st !== 'ACTIVE' && st !== 'PAUSED')) {
    console.error(chalk.red('X Invalid --status. Use ACTIVE or PAUSED'));
    process.exit(1);
  }

  const payload = { status: st };
  if (options.verbose || options.dryRun) {
    console.log(chalk.gray('\nUpdate payload:'));
    console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
    console.log('');
  }
  if (options.dryRun) return;

  const ok = await confirmHighRisk(
    `This updates a ${typeLabel(objType)}. Changing status can affect spend. Proceed?`,
    Boolean(options.yes)
  );
  if (!ok) {
    console.log(chalk.yellow('Cancelled.\n'));
    return;
  }

  const client = new MetaAPIClient(token, 'facebook');
  const spinner = ora(`Updating ${typeLabel(objType)} status...`).start();
  try {
    const result = await client.post(`/${id}`, {}, payload, { verbose: Boolean(options.verbose), maxRetries: 5 });
    spinner.stop();
    if (options.json) {
      console.log(JSON.stringify(sanitizeForLog(result), null, 2));
      return;
    }
    console.log(chalk.green('OK Status updated'));
    console.log(chalk.cyan('  ID:'), id);
    console.log(chalk.cyan('  Status:'), st);
    console.log('');
  } catch (e) {
    spinner.stop();
    client.handleError(e, { scopes: ['ads_management'] });
  }
}

function registerMarketingCommands(program) {
  const marketing = program.command('marketing').description('Meta Marketing API (ads, campaigns, insights, creatives)');

  marketing
    .command('set-default-account <adAccountId>')
    .description('Set default Marketing ad account id (e.g. act_123)')
    .action((adAccountId) => {
      const act = normalizeAct(adAccountId);
      if (!act) process.exit(1);
      config.setDefaultMarketingAdAccountId(act);
      console.log(chalk.green(`OK Default ad account set: ${act}\n`));
    });

  marketing
    .command('accounts')
    .description('List ad accounts for the current user (/me/adaccounts)')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const client = new MetaAPIClient(token, 'facebook');

      const spinner = ora('Fetching ad accounts...').start();
      try {
        const rows = await paginate(client, '/me/adaccounts', {
          fields: 'id,name,account_id,currency,timezone_name,amount_spent',
          limit: 50
        }, { verbose: Boolean(options.verbose) });
        spinner.stop();

        const mapped = rows.map((a) => ({
          id: a.id,
          account_id: a.account_id,
          name: a.name,
          currency: a.currency,
          timezone: a.timezone_name,
          amount_spent: a.amount_spent
        }));

        if (options.json) {
          console.log(JSON.stringify(mapped, null, 2));
          return;
        }

        if (options.table) {
          printTableOrJson({ rows: mapped, columns: ['name', 'id', 'currency', 'timezone', 'amount_spent'], json: false });
          return;
        }

        console.log(chalk.bold('\nAd Accounts:'));
        mapped.forEach((a) => {
          console.log(chalk.bold(`- ${a.name}`));
          console.log(chalk.cyan('  ID:'), a.id);
          console.log(chalk.cyan('  Account ID:'), a.account_id);
          console.log(chalk.cyan('  Currency:'), a.currency);
        });
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('portfolio')
    .description('Agency portfolio snapshot across profiles with pacing + risk flags')
    .option('--profiles <names>', 'Comma-separated profile names (default: all profiles)', '')
    .option('--preset <preset>', 'Date preset: last_7d|last_30d|last_90d|today|yesterday', 'last_7d')
    .option('--target-daily <amount>', 'Default target daily spend per profile/account', '0')
    .option('--targets-file <path>', 'JSON map: {"profileA": 200, "default": 120}')
    .option('--include-missing', 'Include profiles missing token/account config')
    .option('--with-rate-limits', 'Include x-ad-account-usage header snapshot')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (options) => {
      if (!options.json) warnIfOldApiVersion();

      const preset = presetToDatePreset(options.preset);
      const windowDays = daysForPreset(preset);
      const defaultDailyTarget = parsePositiveNumber(options.targetDaily, 0);

      if (defaultDailyTarget < 0) {
        console.error(chalk.red('X --target-daily must be >= 0'));
        process.exit(1);
      }

      let targetsByProfile = {};
      if (options.targetsFile) {
        try {
          targetsByProfile = parseTargetsFile(options.targetsFile);
        } catch (e) {
          console.error(chalk.red(`X ${e.message}`));
          process.exit(1);
        }
      }

      const explicitProfiles = parseCsv(options.profiles);
      const allProfiles = config.listProfiles();
      const selectedProfiles = explicitProfiles.length ? explicitProfiles : allProfiles;
      const profileQueue = Array.from(new Set(selectedProfiles.map((x) => String(x || '').trim()).filter(Boolean)));

      if (!profileQueue.length) {
        console.log(chalk.yellow('! No profiles found. Add one with: social accounts add <name>'));
        console.log('');
        return;
      }

      const rows = [];
      const currentProfile = config.getActiveProfile();
      const spinner = (!options.json && process.stdout.isTTY)
        ? ora('Building agency portfolio snapshot...').start()
        : null;
      try {
        for (let i = 0; i < profileQueue.length; i += 1) {
          const profileName = profileQueue[i];
          if (spinner) spinner.text = `Scanning profile ${profileName} (${i + 1}/${profileQueue.length})`;

          if (!config.hasProfile(profileName)) {
            rows.push({
              profile: profileName,
              ad_account: '',
              account_name: '',
              currency: '',
              spend: 0,
              impressions: 0,
              clicks: 0,
              active_campaigns: 0,
              target_daily: 0,
              target_window: 0,
              pace_pct: 0,
              pace_status: 'n/a',
              health: 'profile_missing',
              alerts: ['profile_not_found']
            });
            continue;
          }

          config.useProfile(profileName);
          const token = config.getToken('facebook');
          const act = normalizeAct(config.getDefaultMarketingAdAccountId());
          const targetDaily = resolveDailyTarget({
            profile: profileName,
            targetsByProfile,
            defaultDailyTarget
          });
          const targetWindow = targetDaily > 0 ? targetDaily * windowDays : 0;

          if (!token || !act) {
            rows.push({
              profile: profileName,
              ad_account: act || '',
              account_name: '',
              currency: '',
              spend: 0,
              impressions: 0,
              clicks: 0,
              active_campaigns: 0,
              target_daily: Number(targetDaily.toFixed(2)),
              target_window: Number(targetWindow.toFixed(2)),
              pace_pct: 0,
              pace_status: targetWindow > 0 ? 'under' : 'n/a',
              health: 'config_missing',
              alerts: [
                !token ? 'missing_facebook_token' : '',
                !act ? 'missing_default_ad_account' : ''
              ].filter(Boolean)
            });
            continue;
          }

          const client = new MetaAPIClient(token, 'facebook');
          try {
            const requestOptions = { verbose: Boolean(options.verbose), maxRetries: 5 };
            const accountPromise = client.get(`/${act}`, {
              fields: 'id,name,account_id,account_status,currency,timezone_name'
            }, requestOptions);
            const insightsPromise = client.get(`/${act}/insights`, {
              date_preset: preset,
              level: 'account',
              fields: 'spend,impressions,clicks,ctr,cpc,cpm',
              limit: 1
            }, requestOptions);
            const activeCampaignsPromise = client.get(`/${act}/campaigns`, {
              fields: 'id',
              effective_status: JSON.stringify(['ACTIVE']),
              limit: 1,
              summary: 'total_count'
            }, requestOptions);

            const [accountInfo, insightsResult, activeCampaignsResult] = await Promise.all([
              accountPromise,
              insightsPromise,
              activeCampaignsPromise
            ]);

            let rateLimitUsage = '';
            if (options.withRateLimits) {
              const rl = await getAdsRateLimitSnapshot(act, token);
              rateLimitUsage = String(rl.x_ad_account_usage || '').slice(0, 220);
            }

            const row = (insightsResult?.data || [])[0] || {};
            const spend = parseNumberOrZero(row.spend);
            const impressions = Math.round(parseNumberOrZero(row.impressions));
            const clicks = Math.round(parseNumberOrZero(row.clicks));
            const activeCampaigns = parseTotalCountFromPagingResponse(activeCampaignsResult);
            const pacePct = targetWindow > 0 ? (spend / targetWindow) * 100 : 0;
            const pace = paceStatus(spend, targetWindow);
            const alerts = [];

            const accountStatus = String(accountInfo?.account_status || '').trim();
            if (accountStatus && accountStatus !== '1') {
              alerts.push(`account_status_${accountStatus}`);
            }
            if (activeCampaigns === 0) {
              alerts.push('no_active_campaigns');
            }
            if (pace === 'over') {
              alerts.push('overspend_risk');
            } else if (pace === 'under' && targetWindow > 0) {
              alerts.push('underspend_vs_target');
            }

            let health = 'ok';
            if (alerts.some((x) => x === 'overspend_risk' || x.startsWith('account_status_'))) {
              health = 'high';
            } else if (alerts.length) {
              health = 'watch';
            }

            rows.push({
              profile: profileName,
              ad_account: act,
              account_name: String(accountInfo?.name || ''),
              currency: String(accountInfo?.currency || ''),
              spend: Number(spend.toFixed(2)),
              impressions,
              clicks,
              active_campaigns: activeCampaigns,
              target_daily: Number(targetDaily.toFixed(2)),
              target_window: Number(targetWindow.toFixed(2)),
              pace_pct: Number(pacePct.toFixed(1)),
              pace_status: pace,
              health,
              alerts,
              rate_limit_usage: rateLimitUsage
            });
          } catch (error) {
            rows.push({
              profile: profileName,
              ad_account: act,
              account_name: '',
              currency: '',
              spend: 0,
              impressions: 0,
              clicks: 0,
              active_campaigns: 0,
              target_daily: Number(targetDaily.toFixed(2)),
              target_window: Number(targetWindow.toFixed(2)),
              pace_pct: 0,
              pace_status: 'n/a',
              health: 'error',
              alerts: ['fetch_failed'],
              error: String(error?.message || error)
            });
          }
        }
      } finally {
        if (spinner) spinner.stop();
        try {
          config.useProfile(currentProfile);
        } catch {
          config.clearProfileOverride();
        }
      }

      const outputRows = options.includeMissing
        ? rows
        : rows.filter((r) => r.health !== 'config_missing' && r.health !== 'profile_missing');
      const summary = summarizePortfolioRows(outputRows);

      if (options.json) {
        console.log(JSON.stringify(sanitizeForLog({
          generated_at: new Date().toISOString(),
          preset,
          window_days: windowDays,
          rows: outputRows,
          summary
        }), null, 2));
        return;
      }

      if (!outputRows.length) {
        console.log(chalk.yellow('! No eligible profiles to show. Use --include-missing to inspect config gaps.'));
        console.log('');
        return;
      }

      const tableRows = outputRows.map((r) => ({
        profile: r.profile,
        ad_account: r.ad_account || '-',
        account_name: r.account_name || '-',
        spend: parseNumberOrZero(r.spend).toFixed(2),
        target_window: parseNumberOrZero(r.target_window) > 0 ? parseNumberOrZero(r.target_window).toFixed(2) : '-',
        pace_pct: parseNumberOrZero(r.target_window) > 0 ? `${parseNumberOrZero(r.pace_pct).toFixed(1)}%` : '-',
        pace_status: r.pace_status,
        active_campaigns: String(r.active_campaigns || 0),
        health: r.health,
        alerts: (r.alerts || []).join('|') || '-'
      }));
      const columns = ['profile', 'ad_account', 'account_name', 'spend', 'target_window', 'pace_pct', 'pace_status', 'active_campaigns', 'health', 'alerts'];
      printTableOrJson({ rows: tableRows, columns, json: false });

      console.log(chalk.bold('Portfolio Summary:'));
      console.log(chalk.cyan('  Profiles scanned:'), String(summary.profiles_scanned));
      console.log(chalk.cyan('  Actionable profiles:'), String(summary.actionable_profiles));
      console.log(chalk.cyan('  Total spend:'), chalk.green(summary.total_spend.toFixed(2)));
      if (summary.total_target_window > 0) {
        console.log(chalk.cyan('  Total target window:'), chalk.green(summary.total_target_window.toFixed(2)));
      }
      console.log(chalk.cyan('  Over pacing:'), String(summary.over_pacing_count));
      console.log(chalk.cyan('  Under pacing:'), String(summary.under_pacing_count));
      console.log('');
    });

  marketing
    .command('campaigns [adAccountId]')
    .description('List campaigns for an ad account (/act_<id>/campaigns)')
    .option('--status <status>', 'Filter by effective_status (ACTIVE, PAUSED, ARCHIVED, etc.)')
    .option('--fields <fields>', 'Fields (comma-separated)', 'id,name,objective,status,daily_budget')
    .option('--limit <n>', 'Page size (default 100)', '100')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');

      const params = {
        fields: options.fields,
        limit: parseInt(options.limit, 10) || 100
      };
      if (options.status) {
        // effective_status expects JSON array strings in many setups.
        params.effective_status = JSON.stringify([String(options.status).toUpperCase()]);
      }

      const spinner = ora('Fetching campaigns...').start();
      try {
        const rows = await paginate(client, `/${act}/campaigns`, params, { verbose: Boolean(options.verbose) });
        spinner.stop();
        const mapped = rows.map((c) => ({
          id: c.id,
          name: c.name,
          objective: c.objective,
          status: c.status,
          daily_budget: c.daily_budget
        }));

        if (options.json) {
          console.log(JSON.stringify(mapped, null, 2));
          return;
        }
        if (options.table) {
          printTableOrJson({ rows: mapped, columns: ['name', 'id', 'objective', 'status', 'daily_budget'], json: false });
          return;
        }
        console.log(chalk.bold('\nCampaigns:'));
        mapped.forEach((c) => {
          console.log(chalk.bold(`- ${c.name}`));
          console.log(chalk.cyan('  ID:'), c.id);
          if (c.objective) console.log(chalk.cyan('  Objective:'), c.objective);
          if (c.status) console.log(chalk.cyan('  Status:'), c.status);
        });
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('adsets <campaignId>')
    .description('List ad sets for a campaign (/<campaign_id>/adsets)')
    .option('--fields <fields>', 'Fields (comma-separated)', 'id,name,status,daily_budget,lifetime_budget,billing_event,optimization_goal')
    .option('--limit <n>', 'Page size (default 100)', '100')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (campaignId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const client = new MetaAPIClient(token, 'facebook');
      const spinner = ora('Fetching ad sets...').start();
      try {
        const rows = await paginate(client, `/${campaignId}/adsets`, {
          fields: options.fields,
          limit: parseInt(options.limit, 10) || 100
        }, { verbose: Boolean(options.verbose) });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (options.table) {
          const mapped = rows.map((a) => ({
            name: a.name,
            id: a.id,
            status: a.status,
            daily_budget: a.daily_budget,
            optimization_goal: a.optimization_goal
          }));
          printTableOrJson({ rows: mapped, columns: ['name', 'id', 'status', 'daily_budget', 'optimization_goal'], json: false });
          return;
        }
        console.log(JSON.stringify(rows, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('creatives [adAccountId]')
    .description('List creatives for an ad account (/act_<id>/adcreatives)')
    .option('--fields <fields>', 'Fields (comma-separated)', 'id,name,object_story_spec,thumbnail_url')
    .option('--limit <n>', 'Page size (default 100)', '100')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');
      const spinner = ora('Fetching creatives...').start();
      try {
        const rows = await paginate(client, `/${act}/adcreatives`, {
          fields: options.fields,
          limit: parseInt(options.limit, 10) || 100
        }, { verbose: Boolean(options.verbose) });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (options.table) {
          const mapped = rows.map((c) => ({
            name: c.name || '',
            id: c.id,
            thumbnail_url: c.thumbnail_url || ''
          }));
          printTableOrJson({ rows: mapped, columns: ['name', 'id', 'thumbnail_url'], json: false });
          return;
        }
        console.log(JSON.stringify(rows, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('insights [adAccountId]')
    .description('Fetch insights via async report run (recommended for breakdowns)')
    .requiredOption('--preset <preset>', 'Date preset: last_7d|last_30d|last_90d|today|yesterday')
    .requiredOption('--level <level>', 'Level: account|campaign|adset|ad')
    .option('--fields <fields>', 'Fields (comma-separated)', 'spend,impressions,clicks,ctr,cpc,cpm')
    .option('--breakdowns <breakdowns>', 'Breakdowns (comma-separated), e.g. age,gender,placement,device_platform', '')
    .option('--time-increment <n>', 'Time increment (1 for daily)', '')
    .option('--async-poll-interval <sec>', 'Poll interval seconds', '10')
    .option('--timeout <sec>', 'Timeout seconds for job', '600')
    .option('--limit <n>', 'Result page size', '500')
    .option('--export <path>', 'Write results to a file (csv or json)')
    .option('--export-format <fmt>', 'Export format: csv|json (default from extension)', '')
    .option('--append', 'Append to export file (CSV: append rows; JSON: append into array if possible)')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');

      const datePreset = presetToDatePreset(options.preset);
      const level = String(options.level).toLowerCase();
      const fields = parseCsv(options.fields).join(',');
      const breakdowns = parseCsv(options.breakdowns);

      const params = {
        date_preset: datePreset,
        level,
        fields
      };
      if (breakdowns.length) params.breakdowns = breakdowns.join(',');
      if (options.timeIncrement) params.time_increment = String(options.timeIncrement);
      params.limit = parseInt(options.limit, 10) || 500;

      const spinner = ora('Submitting async insights job...').start();
      try {
        let rows = [];
        try {
          const reportRunId = await startAsyncInsightsJob({ client, act, params, opts: { verbose: Boolean(options.verbose), maxRetries: 5 } });
          spinner.text = `Polling insights job ${reportRunId}...`;
          await pollInsightsJob({
            client,
            reportRunId,
            pollIntervalSec: parseInt(options.asyncPollInterval, 10) || 10,
            timeoutSec: parseInt(options.timeout, 10) || 600,
            verbose: Boolean(options.verbose),
            onProgress: ({ status, percent }) => {
              const pct = percent !== undefined && percent !== null ? `${percent}%` : '?%';
              spinner.text = `Polling insights job ${reportRunId}: ${status || 'running'} (${pct})`;
            }
          });
          spinner.text = 'Fetching insights results...';
          rows = await fetchAsyncInsightsResults({ client, reportRunId, opts: { verbose: Boolean(options.verbose), maxRetries: 5 } });
        } catch (jobErr) {
          spinner.stop();
          console.log(chalk.yellow('! Async insights failed; falling back to sync insights.'));
          console.log(chalk.gray(`  Reason: ${jobErr?.message || String(jobErr)}`));
          console.log(chalk.gray('  Tip: reduce breakdowns/date range, or re-try later (Ads throttling is common).'));
          console.log('');
          spinner.start('Fetching sync insights...');
          const res = await client.get(`/${act}/insights`, params, { verbose: Boolean(options.verbose), maxRetries: 5 });
          rows = res?.data || [];
        }

        spinner.stop();

        if (options.export) {
          try {
            const out = exportInsights({
              rows,
              exportPath: options.export,
              format: options.exportFormat,
              append: Boolean(options.append)
            });
            console.log(chalk.green(`OK Exported insights to: ${out.path}`));
            if (out.appended) console.log(chalk.gray('  (appended)'));
          } catch (e) {
            console.error(chalk.red(`X Export failed: ${e.message}`));
            process.exit(1);
          }
          console.log('');
        }

        if (options.json) {
          console.log(JSON.stringify(sanitizeForLog(rows), null, 2));
          return;
        }

        const summary = summarizeInsights(rows);
        if (options.table) {
          // Show a reasonable default subset.
          const cols = ['date_start', 'date_stop', 'account_id', 'campaign_id', 'adset_id', 'ad_id', 'spend', 'impressions', 'clicks'];
          const available = cols.filter((c) => rows[0] && Object.prototype.hasOwnProperty.call(rows[0], c));
          const columns = available.length ? available : Object.keys(rows[0] || {}).slice(0, 8);
          printTableOrJson({ rows, columns, json: false });
          printInsightsSummary(summary);
          return;
        }

        // Default: table if not huge, else json-ish summary.
        const columns = Object.keys(rows[0] || {}).slice(0, 10);
        if (rows.length && columns.length) {
          printTableOrJson({ rows, columns, json: false });
        } else {
          console.log(chalk.gray('(no rows)'));
        }
        printInsightsSummary(summary);

        console.log(chalk.gray('Note: attribution is retroactive; re-pull daily for 7-28 days for stable numbers.'));
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('diagnose-poor-ads [adAccountId]')
    .description('Detect likely underperforming ads from insights data (cost/risk focused)')
    .option('--preset <preset>', 'Date preset: last_7d|last_30d|last_90d|today|yesterday', 'last_7d')
    .option('--min-impressions <n>', 'Minimum impressions before CTR/CPM diagnostics', '1000')
    .option('--min-clicks <n>', 'Minimum clicks before CPC diagnostics', '5')
    .option('--min-spend <amount>', 'Minimum spend before diagnosis', '10')
    .option('--ctr-drop-factor <n>', 'Flag when CTR <= median_ctr * factor', '0.6')
    .option('--cpc-rise-factor <n>', 'Flag when CPC >= median_cpc * factor', '1.5')
    .option('--cpm-rise-factor <n>', 'Flag when CPM >= median_cpm * factor', '1.4')
    .option('--top <n>', 'Max flagged ads to show', '20')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');

      const preset = presetToDatePreset(options.preset);
      const top = Math.max(1, parseIntegerOrFallback(options.top, 20) || 20);
      const minImpressions = parsePositiveNumber(options.minImpressions, 1000);
      const minClicks = parsePositiveNumber(options.minClicks, 5);
      const minSpend = parsePositiveNumber(options.minSpend, 10);

      const params = {
        date_preset: preset,
        level: 'ad',
        fields: 'ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,ctr,cpc,cpm',
        limit: 500
      };

      const spinner = ora('Submitting async diagnostics query...').start();
      try {
        let rows = [];
        try {
          const reportRunId = await startAsyncInsightsJob({
            client,
            act,
            params,
            opts: { verbose: Boolean(options.verbose), maxRetries: 5 }
          });
          spinner.text = `Polling diagnostics job ${reportRunId}...`;
          await pollInsightsJob({
            client,
            reportRunId,
            pollIntervalSec: 10,
            timeoutSec: 600,
            verbose: Boolean(options.verbose),
            onProgress: ({ status, percent }) => {
              const pct = percent !== undefined && percent !== null ? `${percent}%` : '?%';
              spinner.text = `Polling diagnostics job ${reportRunId}: ${status || 'running'} (${pct})`;
            }
          });
          spinner.text = 'Fetching diagnostics results...';
          rows = await fetchAsyncInsightsResults({
            client,
            reportRunId,
            opts: { verbose: Boolean(options.verbose), maxRetries: 5 }
          });
        } catch (jobErr) {
          spinner.stop();
          console.log(chalk.yellow('! Async diagnostics failed; falling back to sync insights.'));
          console.log(chalk.gray(`  Reason: ${jobErr?.message || String(jobErr)}`));
          console.log(chalk.gray('  Tip: reduce load or re-try later (Ads throttling is common).'));
          console.log('');
          spinner.start('Fetching sync insights for diagnostics...');
          const res = await client.get(`/${act}/insights`, params, { verbose: Boolean(options.verbose), maxRetries: 5 });
          rows = res?.data || [];
        }

        spinner.stop();

        const diagnosis = diagnosePoorAds(rows, {
          minImpressions,
          minClicks,
          minSpend,
          ctrDropFactor: options.ctrDropFactor,
          cpcRiseFactor: options.cpcRiseFactor,
          cpmRiseFactor: options.cpmRiseFactor
        });
        const flaggedRows = diagnosis.rows.slice(0, top);

        const payload = sanitizeForLog({
          generated_at: new Date().toISOString(),
          ad_account: act,
          preset,
          thresholds: diagnosis.thresholds,
          baselines: diagnosis.baselines,
          summary: diagnosis.summary,
          top_limit: top,
          rows: flaggedRows
        });

        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        if (!flaggedRows.length) {
          console.log(chalk.green('OK No clearly poor ads found for the current thresholds.'));
          console.log(chalk.gray('  Try wider lookback (e.g. --preset last_30d) or lower thresholds if needed.'));
          console.log('');
          return;
        }

        const tableRows = flaggedRows.map((r) => ({
          ad_name: r.ad_name || '-',
          ad_id: r.ad_id || '-',
          spend: parseNumberOrZero(r.spend).toFixed(2),
          impressions: String(r.impressions || 0),
          clicks: String(r.clicks || 0),
          ctr_pct: `${roundMetric(r.ctr, 2).toFixed(2)}%`,
          cpc: roundMetric(r.cpc, 2).toFixed(2),
          cpm: roundMetric(r.cpm, 2).toFixed(2),
          score: String(r.score || 0),
          reasons: (r.reason_labels || []).join('|'),
          action: r.recommended_action
        }));
        const columns = ['ad_name', 'ad_id', 'spend', 'impressions', 'clicks', 'ctr_pct', 'cpc', 'cpm', 'score', 'reasons', 'action'];
        if (options.table || !options.json) {
          printTableOrJson({ rows: tableRows, columns, json: false });
        }

        console.log(chalk.bold('Poor Ad Diagnosis Summary:'));
        console.log(chalk.cyan('  Ads scanned:'), String(diagnosis.summary.ads_scanned));
        console.log(chalk.cyan('  Ads flagged:'), String(diagnosis.summary.flagged_ads));
        console.log(chalk.cyan('  Scanned spend:'), chalk.green(diagnosis.summary.scanned_spend.toFixed(2)));
        console.log(chalk.cyan('  Flagged spend:'), chalk.yellow(diagnosis.summary.flagged_spend.toFixed(2)));
        console.log(chalk.cyan('  Spend at risk (estimate):'), chalk.red(diagnosis.summary.spend_at_risk_estimate.toFixed(2)));
        console.log(chalk.cyan('  Median CTR baseline:'), `${diagnosis.baselines.median_ctr_pct.toFixed(2)}%`);
        console.log(chalk.cyan('  Median CPC baseline:'), diagnosis.baselines.median_cpc.toFixed(2));
        console.log(chalk.cyan('  Median CPM baseline:'), diagnosis.baselines.median_cpm.toFixed(2));
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('upload-image [adAccountId]')
    .description('Upload an ad image to get an image_hash (for create-creative)')
    .requiredOption('--file <path>', 'Local image file path')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);

      const filePath = path.resolve(String(options.file));
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`X File not found: ${filePath}`));
        process.exit(1);
      }

      const apiVersion = config.getApiVersion();
      const url = `https://graph.facebook.com/${apiVersion}/${act}/adimages`;

      const fd = new FormData();
      fd.append('filename', fs.createReadStream(filePath));

      const spinner = ora('Uploading image...').start();
      try {
        const res = await require('axios').post(url, fd, { // eslint-disable-line global-require
          params: { access_token: token },
          headers: fd.getHeaders(),
          timeout: 60000,
          validateStatus: () => true
        });
        spinner.stop();

        if (res.status >= 400) {
          const client = new MetaAPIClient(token, 'facebook');
          client.handleError({ response: { status: res.status, data: res.data } }, { scopes: ['ads_management'] });
        }

        const images = res.data?.images || {};
        const firstKey = Object.keys(images)[0];
        const first = firstKey ? images[firstKey] : null;
        const payload = sanitizeForLog({
          act,
          image_hash: first?.hash || '',
          url: first?.url || '',
          id: first?.id || '',
          raw: res.data
        });

        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(chalk.green('OK Image uploaded'));
        if (payload.image_hash) console.log(chalk.cyan('  image_hash:'), payload.image_hash);
        if (payload.url) console.log(chalk.cyan('  url:'), payload.url);
        console.log('');
      } catch (e) {
        spinner.stop();
        const client = new MetaAPIClient(token, 'facebook');
        client.handleError(e, { scopes: ['ads_management'] });
      }
    });

  marketing
    .command('create-adset <campaignId>')
    .description('Create an ad set for a campaign (high risk: can affect spend once activated)')
    .requiredOption('--name <name>', 'Ad set name')
    .option('--status <status>', 'Status (ACTIVE or PAUSED)', 'PAUSED')
    .requiredOption('--targeting <json>', 'Targeting JSON (string)')
    .option('--targeting-file <path>', 'Targeting JSON file')
    .option('--bidding <json>', 'Bidding JSON (string), e.g. {\"bid_strategy\":\"LOWEST_COST_WITHOUT_CAP\"}')
    .option('--bidding-file <path>', 'Bidding JSON file')
    .option('--billing-event <event>', 'Billing event (e.g. IMPRESSIONS, LINK_CLICKS)', 'IMPRESSIONS')
    .option('--optimization-goal <goal>', 'Optimization goal (e.g. OFFSITE_CONVERSIONS, LINK_CLICKS)', 'LINK_CLICKS')
    .option('--promoted-object <json>', 'Promoted object JSON (string)')
    .option('--promoted-object-file <path>', 'Promoted object JSON file')
    .option('--daily-budget <amount>', 'Daily budget in minor units (e.g. 10000)', '')
    .option('--lifetime-budget <amount>', 'Lifetime budget in minor units', '')
    .option('--start-time <iso>', 'Start time (ISO)', '')
    .option('--end-time <iso>', 'End time (ISO)', '')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print payload without calling the API')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (campaignId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const client = new MetaAPIClient(token, 'facebook');

      let targeting;
      let bidding;
      let promotedObject;
      try {
        targeting = parseJsonArgOrFile(options.targeting, options.targetingFile, 'targeting');
        bidding = parseJsonArgOrFile(options.bidding, options.biddingFile, 'bidding');
        promotedObject = parseJsonArgOrFile(options.promotedObject, options.promotedObjectFile, 'promoted-object');
      } catch (e) {
        console.error(chalk.red(`X ${e.message}`));
        process.exit(1);
      }

      if (!targeting || typeof targeting !== 'object') {
        console.error(chalk.red('X --targeting is required and must be valid JSON object.'));
        process.exit(1);
      }
      if (bidding && typeof bidding !== 'object') {
        console.error(chalk.red('X --bidding must be valid JSON object.'));
        process.exit(1);
      }

      let act = '';
      try {
        act = await resolveActForCampaign(client, campaignId, { verbose: Boolean(options.verbose), maxRetries: 5 });
      } catch (e) {
        console.error(chalk.red(`X Failed to resolve ad account for campaign ${campaignId}: ${e.message}`));
        process.exit(1);
      }

      const payload = {
        name: options.name,
        campaign_id: campaignId,
        billing_event: String(options.billingEvent).toUpperCase(),
        optimization_goal: String(options.optimizationGoal).toUpperCase(),
        status: String(options.status || 'PAUSED').toUpperCase(),
        targeting
      };

      if (bidding) Object.assign(payload, bidding);
      if (promotedObject) payload.promoted_object = promotedObject;
      if (options.dailyBudget) payload.daily_budget = String(options.dailyBudget);
      if (options.lifetimeBudget) payload.lifetime_budget = String(options.lifetimeBudget);
      if (options.startTime) payload.start_time = String(options.startTime);
      if (options.endTime) payload.end_time = String(options.endTime);

      if (options.verbose || options.dryRun) {
        console.log(chalk.gray('\nCreate payload:'));
        console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
        console.log('');
      }
      if (options.dryRun) return;

      const ok = await confirmHighRisk('This creates a real ad set. It can spend money when ACTIVE. Proceed?', Boolean(options.yes));
      if (!ok) {
        console.log(chalk.yellow('Cancelled.\n'));
        return;
      }

      const spinner = ora('Creating ad set...').start();
      try {
        const result = await createAdSet(client, act, payload, { verbose: Boolean(options.verbose), maxRetries: 5 });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.green('OK Ad set created'));
        if (result?.id) console.log(chalk.cyan('  ID:'), result.id);
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_management'] });
      }
    });

  marketing
    .command('create-creative [adAccountId]')
    .description('Create an ad creative (safe by itself; used by ads)')
    .requiredOption('--name <name>', 'Creative name')
    .option('--object-story-spec <json>', 'Full object_story_spec JSON (string)')
    .option('--object-story-spec-file <path>', 'Full object_story_spec JSON file')
    .option('--page-id <id>', 'Page ID (for simple link creative)')
    .option('--instagram-actor-id <id>', 'Instagram actor id (optional)')
    .option('--link <url>', 'Link URL (for simple link creative)')
    .option('--body-text <text>', 'Primary text/copy (alias of --message)', '')
    .option('--headline <text>', 'Headline (link_data.name)', '')
    .option('--message <text>', 'Message (legacy alias of --body-text)', '')
    .option('--image-hash <hash>', 'Image hash (from upload-image)', '')
    .option('--image-url <url>', 'Image URL to upload (creates image_hash automatically)', '')
    .option('--video-url <url>', 'Video URL to upload (creates video_id automatically)', '')
    .option('--call-to-action <type>', 'CTA type (e.g. SHOP_NOW, LEARN_MORE)', '')
    .option('--cta-link <url>', 'CTA link override (defaults to --link)', '')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print payload without calling the API')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');

      let objectStorySpec = null;
      try {
        objectStorySpec = parseJsonArgOrFile(options.objectStorySpec, options.objectStorySpecFile, 'object-story-spec');
      } catch (e) {
        console.error(chalk.red(`X ${e.message}`));
        process.exit(1);
      }

      if (!objectStorySpec) {
        // Build a minimal link/video creative.
        if (!options.pageId || !options.link) {
          console.error(chalk.red('X Provide either --object-story-spec (json/file) OR (--page-id and --link).'));
          process.exit(1);
        }
        const bodyText = options.bodyText || options.message || '';
        const headline = options.headline || '';

        if (options.imageUrl && options.videoUrl) {
          console.error(chalk.red('X Provide only one: --image-url or --video-url'));
          process.exit(1);
        }

        let imageHash = options.imageHash || '';
        let videoId = '';
        if (options.dryRun) {
          if (options.imageUrl && !imageHash) imageHash = '<IMAGE_HASH_FROM_UPLOAD>';
          if (options.videoUrl) videoId = '<VIDEO_ID_FROM_UPLOAD>';
        } else {
          try {
            if (options.imageUrl) {
              const up = await uploadAdImageByUrl(client, act, options.imageUrl, { verbose: Boolean(options.verbose), maxRetries: 5 });
              imageHash = up.image_hash;
            }
            if (options.videoUrl) {
              const up = await uploadAdVideoByUrl(client, act, options.videoUrl, options.name, { verbose: Boolean(options.verbose), maxRetries: 5 });
              videoId = up.video_id;
            }
          } catch (e) {
            console.error(chalk.red(`X Upload failed: ${e.message}`));
            process.exit(1);
          }
        }

        const ctaType = options.callToAction ? String(options.callToAction).toUpperCase() : '';
        const ctaLink = options.ctaLink || options.link;

        if (videoId) {
          const videoData = { video_id: videoId };
          if (bodyText) videoData.message = bodyText;
          if (headline) videoData.title = headline;
          if (ctaType) {
            videoData.call_to_action = { type: ctaType, value: { link: ctaLink } };
          }
          objectStorySpec = {
            page_id: options.pageId,
            video_data: videoData
          };
        } else {
          const linkData = { link: options.link };
          if (bodyText) linkData.message = bodyText;
          if (headline) linkData.name = headline;
          if (imageHash) linkData.image_hash = imageHash;
          if (ctaType) {
            linkData.call_to_action = {
              type: ctaType,
              value: { link: ctaLink }
            };
          }
          objectStorySpec = {
            page_id: options.pageId,
            link_data: linkData
          };
        }
        if (options.callToAction) {
          // already handled above
        }
        if (options.instagramActorId) objectStorySpec.instagram_actor_id = options.instagramActorId;
      }

      const payload = {
        name: options.name,
        object_story_spec: objectStorySpec
      };

      if (options.verbose || options.dryRun) {
        console.log(chalk.gray('\nCreate payload:'));
        console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
        console.log('');
      }
      if (options.dryRun) return;

      const ok = await confirmHighRisk('Create this creative? (Does not spend by itself, but will be used in ads)', Boolean(options.yes));
      if (!ok) {
        console.log(chalk.yellow('Cancelled.\n'));
        return;
      }

      const spinner = ora('Creating creative...').start();
      try {
        const result = await createCreative(client, act, payload, { verbose: Boolean(options.verbose), maxRetries: 5 });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.green('OK Creative created'));
        if (result?.id) console.log(chalk.cyan('  ID:'), result.id);
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_management'] });
      }
    });

  marketing
    .command('create-ad <adsetId>')
    .description('Create an ad (high risk: can affect spend once activated)')
    .requiredOption('--name <name>', 'Ad name')
    .requiredOption('--creative-id <id>', 'Creative id')
    .option('--status <status>', 'Status (ACTIVE or PAUSED)', 'PAUSED')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print payload without calling the API')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (adsetId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const client = new MetaAPIClient(token, 'facebook');

      let act = '';
      try {
        act = await resolveActForAdSet(client, adsetId, { verbose: Boolean(options.verbose), maxRetries: 5 });
      } catch (e) {
        console.error(chalk.red(`X Failed to resolve ad account for ad set ${adsetId}: ${e.message}`));
        process.exit(1);
      }

      const payload = {
        name: options.name,
        adset_id: adsetId,
        creative: { creative_id: options.creativeId },
        status: String(options.status || 'PAUSED').toUpperCase()
      };

      if (options.verbose || options.dryRun) {
        console.log(chalk.gray('\nCreate payload:'));
        console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
        console.log('');
      }
      if (options.dryRun) return;

      const ok = await confirmHighRisk('This creates a real ad. It can spend money when ACTIVE. Proceed?', Boolean(options.yes));
      if (!ok) {
        console.log(chalk.yellow('Cancelled.\n'));
        return;
      }

      const spinner = ora('Creating ad...').start();
      try {
        const result = await createAd(client, act, payload, { verbose: Boolean(options.verbose), maxRetries: 5 });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.green('OK Ad created'));
        if (result?.id) console.log(chalk.cyan('  ID:'), result.id);
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_management'] });
      }
    });

  marketing
    .command('set-status <type> <id>')
    .description('Update status for a campaign/adset/ad (high risk)')
    .requiredOption('--status <status>', 'Status (ACTIVE or PAUSED)')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print payload without calling the API')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (type, id, options) => {
      await doSetStatus({ type, id, status: options.status, options });
    });

  marketing
    .command('pause <type> <id>')
    .description('Convenience: set status to PAUSED (high risk)')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print payload without calling the API')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (type, id, options) => {
      await doSetStatus({ type, id, status: 'PAUSED', options });
    });

  marketing
    .command('resume <type> <id>')
    .description('Convenience: set status to ACTIVE (high risk)')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print payload without calling the API')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (type, id, options) => {
      await doSetStatus({ type, id, status: 'ACTIVE', options });
    });

  marketing
    .command('set-budget <type> <id>')
    .description('Update daily/lifetime budget (campaign or adset) (high risk)')
    .option('--daily-budget <amount>', 'Daily budget in minor units (e.g. 10000)')
    .option('--lifetime-budget <amount>', 'Lifetime budget in minor units')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print payload without calling the API')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (type, id, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const objType = normalizeType(type);
      if (objType !== 'campaign' && objType !== 'adset') {
        console.error(chalk.red('X Invalid type. Use: campaign or adset'));
        process.exit(1);
      }

      const payload = {};
      if (options.dailyBudget) payload.daily_budget = String(options.dailyBudget);
      if (options.lifetimeBudget) payload.lifetime_budget = String(options.lifetimeBudget);

      if (!Object.keys(payload).length) {
        console.error(chalk.red('X Provide --daily-budget and/or --lifetime-budget'));
        process.exit(1);
      }

      if (options.verbose || options.dryRun) {
        console.log(chalk.gray('\nUpdate payload:'));
        console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
        console.log('');
      }
      if (options.dryRun) return;

      const ok = await confirmHighRisk(
        `This updates budget for a ${typeLabel(objType)}. Budgets affect spend. Proceed?`,
        Boolean(options.yes)
      );
      if (!ok) {
        console.log(chalk.yellow('Cancelled.\n'));
        return;
      }

      const client = new MetaAPIClient(token, 'facebook');
      const spinner = ora(`Updating ${typeLabel(objType)} budget...`).start();
      try {
        const result = await client.post(`/${id}`, {}, payload, { verbose: Boolean(options.verbose), maxRetries: 5 });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(sanitizeForLog(result), null, 2));
          return;
        }
        console.log(chalk.green('OK Budget updated'));
        console.log(chalk.cyan('  ID:'), id);
        if (payload.daily_budget) console.log(chalk.cyan('  daily_budget:'), payload.daily_budget);
        if (payload.lifetime_budget) console.log(chalk.cyan('  lifetime_budget:'), payload.lifetime_budget);
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_management'] });
      }
    });

  marketing
    .command('ads [adAccountId]')
    .description('List ads for an ad account (/act_<id>/ads)')
    .option('--fields <fields>', 'Fields (comma-separated)', 'id,name,status,adset_id,campaign_id,creative')
    .option('--status <status>', 'Filter by effective_status (ACTIVE, PAUSED, ARCHIVED, etc.)')
    .option('--limit <n>', 'Page size (default 100)', '100')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');
      const params = {
        fields: options.fields,
        limit: parseInt(options.limit, 10) || 100
      };
      if (options.status) params.effective_status = JSON.stringify([String(options.status).toUpperCase()]);

      const spinner = ora('Fetching ads...').start();
      try {
        const rows = await paginate(client, `/${act}/ads`, params, { verbose: Boolean(options.verbose), maxRetries: 5 });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(sanitizeForLog(rows), null, 2));
          return;
        }
        if (options.table) {
          const mapped = rows.map((a) => ({
            name: a.name || '',
            id: a.id,
            status: a.status,
            campaign_id: a.campaign_id,
            adset_id: a.adset_id
          }));
          printTableOrJson({ rows: mapped, columns: ['name', 'id', 'status', 'campaign_id', 'adset_id'], json: false });
          return;
        }
        console.log(JSON.stringify(rows, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('audiences [adAccountId]')
    .description('List custom audiences for an ad account (/act_<id>/customaudiences)')
    .option('--fields <fields>', 'Fields (comma-separated)', 'id,name,subtype,approximate_count,status,description')
    .option('--limit <n>', 'Page size (default 100)', '100')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');

      const spinner = ora('Fetching audiences...').start();
      try {
        const rows = await paginate(client, `/${act}/customaudiences`, {
          fields: options.fields,
          limit: parseInt(options.limit, 10) || 100
        }, { verbose: Boolean(options.verbose), maxRetries: 5 });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(sanitizeForLog(rows), null, 2));
          return;
        }
        if (options.table) {
          const mapped = rows.map((a) => ({
            name: a.name || '',
            id: a.id,
            subtype: a.subtype || '',
            approximate_count: a.approximate_count || '',
            status: a.status || ''
          }));
          printTableOrJson({ rows: mapped, columns: ['name', 'id', 'subtype', 'approximate_count', 'status'], json: false });
          return;
        }
        console.log(JSON.stringify(rows, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('status [adAccountId]')
    .description('Quick overview: spend today, active campaign count, rate-limit header snapshot')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');
      const spinner = ora('Fetching marketing status...').start();
      try {
        const acct = await client.get(`/${act}`, {
          fields: 'id,name,account_id,account_status,disable_reason,currency,timezone_name,amount_spent,spend_cap,balance'
        }, { verbose: Boolean(options.verbose), maxRetries: 5 });

        // Spend today (sync, small)
        const spendToday = await client.get(`/${act}/insights`, {
          date_preset: 'today',
          level: 'account',
          fields: 'spend,impressions,clicks',
          limit: 1
        }, { verbose: Boolean(options.verbose), maxRetries: 5 });

        // Active campaigns count (best effort)
        const active = await paginate(client, `/${act}/campaigns`, {
          fields: 'id',
          effective_status: JSON.stringify(['ACTIVE']),
          limit: 100
        }, { verbose: Boolean(options.verbose), maxRetries: 5 });

        const rl = await getAdsRateLimitSnapshot(act, token);
        spinner.stop();

        const payload = {
          adAccount: act,
          account: sanitizeForLog(acct),
          spend_today: spendToday?.data?.[0] || null,
          active_campaigns_count: active.length,
          rate_limit_headers: rl
        };

        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        console.log(chalk.bold('\nMarketing Status:'));
        console.log(chalk.cyan('  Ad Account:'), act);
        if (acct?.name) console.log(chalk.cyan('  Name:'), acct.name);
        if (acct?.currency) console.log(chalk.cyan('  Currency:'), acct.currency);
        if (acct?.timezone_name) console.log(chalk.cyan('  Timezone:'), acct.timezone_name);
        const row = spendToday?.data?.[0] || {};
        if (row.spend !== undefined) console.log(chalk.cyan('  Spend today:'), chalk.green(String(row.spend)));
        if (row.impressions !== undefined) console.log(chalk.cyan('  Impressions today:'), String(row.impressions));
        if (row.clicks !== undefined) console.log(chalk.cyan('  Clicks today:'), String(row.clicks));
        console.log(chalk.cyan('  Active campaigns:'), String(active.length));
        console.log('');

        console.log(chalk.bold('Rate Limit Headers (snapshot):'));
        Object.entries(rl).forEach(([k, v]) => {
          if (!v) return;
          console.log(chalk.gray(`  ${k}: `) + String(v).slice(0, 200));
        });
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_read'] });
      }
    });

  marketing
    .command('create-campaign [adAccountId]')
    .description('Create a campaign (high risk: can affect spend)')
    .requiredOption('--name <name>', 'Campaign name')
    .requiredOption('--objective <objective>', 'Objective (e.g. SALES, OUTCOME_SALES, LEAD_GENERATION)')
    .option('--status <status>', 'Status (ACTIVE or PAUSED)', 'PAUSED')
    .option('--daily-budget <amount>', 'Daily budget in minor units (e.g. 10000)', '')
    .option('--advantage-plus <bool>', 'Advantage+ (default true). Only enforces warnings; payload stays conservative.', 'true')
    .option('--special-ad-categories <cats>', 'Comma-separated categories (default empty)', '')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Print payload without calling the API')
    .option('--verbose', 'Verbose request logging (no secrets)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (adAccountId, options) => {
      warnIfOldApiVersion();
      const token = ensureMarketingToken();
      const act = requireAct(adAccountId);
      const client = new MetaAPIClient(token, 'facebook');

      const advantagePlus = String(options.advantagePlus).toLowerCase() !== 'false';
      if (!advantagePlus) {
        console.log(chalk.yellow('! Warning: Advantage+ is the default direction in v24+; legacy creation paths are being deprecated.'));
      }

      const payload = {
        name: options.name,
        objective: options.objective,
        status: String(options.status || 'PAUSED').toUpperCase(),
        // Meta commonly requires this even if empty.
        special_ad_categories: parseCsv(options.specialAdCategories)
      };
      if (options.dailyBudget) payload.daily_budget = String(options.dailyBudget);

      if (options.verbose || options.dryRun) {
        console.log(chalk.gray('\nCreate payload:'));
        console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
        console.log('');
      }
      if (options.dryRun) return;

      const ok = await confirmHighRisk('This creates a real campaign and may affect ad spend. Proceed?', Boolean(options.yes));
      if (!ok) {
        console.log(chalk.yellow('Cancelled.\n'));
        return;
      }

      const spinner = ora('Creating campaign...').start();
      try {
        const result = await client.post(`/${act}/campaigns`, payload, {}, { verbose: Boolean(options.verbose), maxRetries: 5 });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.green('OK Campaign created'));
        if (result?.id) console.log(chalk.cyan('  ID:'), result.id);
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['ads_management'] });
      }
    });
}

module.exports = registerMarketingCommands;

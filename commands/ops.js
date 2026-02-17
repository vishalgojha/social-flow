const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const storage = require('../lib/ops/storage');
const rbac = require('../lib/ops/rbac');
const workflows = require('../lib/ops/workflows');

function workspaceFrom(options) {
  return storage.sanitizeWorkspace(options?.workspace || config.getActiveProfile() || 'default');
}

function parseBool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function parseNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const GUARD_MODES = ['observe', 'approval', 'auto_safe'];

function normalizeGuardMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  if (GUARD_MODES.includes(value)) return value;
  return '';
}

function csvIds(v) {
  return String(v || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function printRows(title, rows) {
  console.log(chalk.bold(`\n${title}`));
  if (!rows.length) {
    console.log(chalk.gray('(none)\n'));
    return;
  }
  rows.forEach((r) => console.log(`- ${r}`));
  console.log('');
}

function toIsoOrFallback(value, fallbackIso) {
  const raw = String(value || '').trim();
  if (!raw) return fallbackIso;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return fallbackIso;
  return new Date(ts).toISOString();
}

function buildHandoffDoc({
  template,
  workspace,
  studioUrl,
  gatewayApiKey,
  operatorId,
  runAtIso,
  generatedAt
}) {
  const ws = workspace || 'default';
  const operator = operatorId || '<operator_id>';
  const keyText = gatewayApiKey || '<set_gateway_api_key>';
  const templateName = String(template || 'agency').trim().toLowerCase();

  const common = [
    `# Social CLI Agency Handoff - ${ws}`,
    '',
    `Generated: ${generatedAt}`,
    '',
    '## What This Workspace Does',
    '- Run daily agency checks (tokens, approvals, follow-ups).',
    '- Track who approved/rejected risky actions.',
    '- Operate via CLI or Social Studio web UI.',
    '',
    '## Quick Access',
    `- Workspace: \`${ws}\``,
    `- Studio URL: \`${studioUrl}\``,
    `- Gateway API key: \`${keyText}\``,
    '',
    '## First-Time Setup (Team Member)',
    '1. Install and verify:',
    '   - `npm install -g @vishalgojha/social-cli`',
    '   - `social --help`',
    '2. Set workspace and operator:',
    `   - \`social accounts switch ${ws}\``,
    `   - \`social ops user set ${operator} --name "<your_name>"\``,
    '3. Verify role and access:',
    `   - \`social ops roles show --workspace ${ws}\``,
    `   - \`social ops user show --workspace ${ws}\``,
    '',
    '## Daily Operations Runbook',
    `- \`social ops morning-run --workspace ${ws} --spend 0\``,
    `- \`social ops alerts list --workspace ${ws} --open\``,
    `- \`social ops approvals list --workspace ${ws} --open\``,
    `- \`social ops activity list --workspace ${ws} --limit 30\``,
    '',
    '## Role Setup (Owner/Admin only)',
    `- Viewer:   \`social ops roles set <user> viewer --workspace ${ws}\``,
    `- Analyst:  \`social ops roles set <user> analyst --workspace ${ws}\``,
    `- Operator: \`social ops roles set <user> operator --workspace ${ws}\``,
    `- Owner:    \`social ops roles set <user> owner --workspace ${ws}\``,
    '',
    '## Studio Mode (Recommended for non-technical users)',
    `1. Start: \`social gateway --open\``,
    `2. Open Settings -> Gateway API Key and set: \`${keyText}\``,
    `3. Open Settings -> Team Management and set operator ID/name`,
    '4. Use Ops Center for approvals and activity export (JSON/CSV)',
    '',
    '## Suggested Schedule',
    `- Daily morning run at: \`${runAtIso}\``,
    `- Command: \`social ops schedule add --workspace ${ws} --name "Daily Ops" --run-at ${runAtIso} --repeat daily\``,
    '',
    '## Troubleshooting',
    '- If role errors appear: verify active operator + role in `social ops user show`.',
    '- If token errors appear: run `social doctor` and re-auth as needed.',
    '- If Studio cannot connect: check `social gateway` is running and API key is correct.',
    '',
    '## Audit & Compliance',
    `- CLI: \`social ops activity list --workspace ${ws} --limit 200\``,
    `- Studio: Ops -> Team Activity -> Export JSON/CSV`
  ];

  if (templateName === 'simple') {
    return [
      ...common.slice(0, 7),
      '',
      '## Fast Start',
      `1. \`social accounts switch ${ws}\``,
      `2. \`social ops user set ${operator} --name "<your_name>"\``,
      `3. \`social ops morning-run --workspace ${ws} --spend 0\``,
      `4. \`social ops approvals list --workspace ${ws} --open\``,
      '',
      '## Studio',
      `- URL: \`${studioUrl}\``,
      `- API key: \`${keyText}\``,
      '',
      '## Need Help',
      '- Run `social doctor` for setup diagnostics.',
      '- Run `social --help` for command list.',
      ''
    ].join('\n');
  }

  if (templateName === 'enterprise') {
    return [
      ...common,
      '',
      '## Approval Matrix (Recommended)',
      '- Viewer: read-only, no approvals.',
      '- Analyst: read + write notes, no approvals.',
      '- Operator: can approve/execute daily ops actions.',
      '- Owner: full admin controls including role changes.',
      '',
      '## Incident Escalation',
      `1. Detect issue: \`social ops alerts list --workspace ${ws} --open\``,
      `2. Pause risky actions: \`social ops guard mode approval --workspace ${ws}\``,
      `3. Assign owner/operator and log activity`,
      `4. Track closure in outcomes and action log`,
      '',
      '## Audit Cadence',
      '- Daily: approvals + alerts review.',
      '- Weekly: export team activity and outcomes.',
      '- Monthly: role and policy review (least privilege).',
      '',
      '## Compliance Export Commands',
      `- \`social ops activity list --workspace ${ws} --limit 500 --json\``,
      `- Studio export: Team Activity -> Export CSV/JSON`,
      ''
    ].join('\n');
  }

  return [
    ...common,
    ''
  ].join('\n');
}

function registerOpsCommands(program) {
  const ops = program.command('ops').description('Agency operations control plane (workflows, alerts, approvals, schedules, roles)');

  ops
    .command('onboard')
    .description('Bootstrap ops data for the current workspace and create a daily morning schedule')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--run-at <iso>', 'First run time (ISO)', new Date().toISOString())
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'admin' });
      storage.ensureWorkspace(ws);
      const existing = storage.listSchedules(ws).find((s) => s.workflow === 'morning_ops');
      const schedule = existing || storage.addSchedule(ws, {
        name: 'Daily Morning Ops',
        workflow: 'morning_ops',
        runAt: options.runAt,
        repeat: 'daily',
        enabled: true,
        payload: {}
      });

      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, schedule }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Ops workspace ready: ${ws}`));
      console.log(chalk.gray(`Morning schedule: ${schedule.id} (${schedule.runAt}, repeat=${schedule.repeat})\n`));
    });

  ops
    .command('morning-run')
    .description('Run high-value morning checks (token health, spend guardrails, follow-up queue)')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--all-workspaces', 'Run across all profiles', false)
    .option('--spend <amount>', 'Current spend snapshot for threshold check', '0')
    .option('--force', 'Force run even if already executed today', false)
    .option('--json', 'Output JSON')
    .action((options) => {
      const spend = parseNumber(options.spend, 0);
      const workspaces = options.allWorkspaces
        ? config.listProfiles().map((p) => storage.sanitizeWorkspace(p))
        : [workspaceFrom(options)];
      const results = workspaces.map((ws) => workflows.runMorningOps({
        workspace: ws,
        config,
        spend,
        force: Boolean(options.force)
      }));

      if (options.json) {
        console.log(JSON.stringify({ workspaces, results }, null, 2));
        return;
      }

      results.forEach((r) => {
        if (r.skipped) {
          console.log(chalk.yellow(`\n${r.workspace}: ${r.reason}`));
          return;
        }
        console.log(chalk.green(`\n${r.workspace}: morning run complete`));
        console.log(chalk.gray(`  alerts: ${r.stats.alertsCreated} | approvals: ${r.stats.approvalsCreated} | leads due: ${r.stats.leadsDue}`));
      });
      console.log('');
    });

  const leads = ops.command('leads').description('Lead state machine for follow-up automation');

  leads
    .command('list')
    .description('List leads')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      let rows = storage.listLeads(ws);
      if (options.status) rows = rows.filter((x) => x.status === options.status);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, leads: rows }, null, 2));
        return;
      }
      printRows(`Leads (${ws})`, rows.map((x) => `${x.id} | ${x.status} | ${x.name} | ${x.phone}`));
    });

  leads
    .command('add')
    .description('Add a lead')
    .requiredOption('--name <name>', 'Lead name')
    .requiredOption('--phone <phone>', 'Phone in E.164')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--status <status>', 'Status', 'new')
    .option('--tags <csv>', 'Comma-separated tags', '')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'write' });
      const tags = String(options.tags || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const lead = storage.addLead(ws, {
        name: options.name,
        phone: options.phone,
        status: options.status,
        tags
      });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, lead }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Lead added: ${lead.id}\n`));
    });

  leads
    .command('update <id>')
    .description('Update lead status/notes')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--status <status>', 'New status')
    .option('--note <text>', 'Note')
    .option('--last-contact <iso>', 'Last contact ISO timestamp')
    .option('--json', 'Output JSON')
    .action((id, options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'write' });
      const patch = {};
      if (options.status) patch.status = options.status;
      if (options.note) patch.note = options.note;
      if (options.lastContact) patch.lastContactAt = options.lastContact;
      const lead = storage.updateLead(ws, id, patch);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, lead }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Lead updated: ${lead.id}\n`));
    });

  const alerts = ops.command('alerts').description('Alert inbox (token/spend/workflow issues)');

  alerts
    .command('list')
    .description('List alerts')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--open', 'Only open alerts', false)
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      let rows = storage.listAlerts(ws);
      if (options.open) rows = rows.filter((x) => x.status === 'open');
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, alerts: rows }, null, 2));
        return;
      }
      printRows(`Alerts (${ws})`, rows.map((x) => `${x.id} | ${x.status} | ${x.severity} | ${x.message}`));
    });

  alerts
    .command('ack <id>')
    .description('Acknowledge an alert')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((id, options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'write' });
      const alert = storage.ackAlert(ws, id);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, alert }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Alert acknowledged: ${alert.id}\n`));
    });

  const approvals = ops.command('approvals').description('Approval queue for high-risk actions');

  approvals
    .command('list')
    .description('List approvals')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--open', 'Only pending', false)
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      let rows = storage.listApprovals(ws);
      if (options.open) rows = rows.filter((x) => x.status === 'pending');
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, approvals: rows }, null, 2));
        return;
      }
      printRows(`Approvals (${ws})`, rows.map((x) => `${x.id} | ${x.status} | ${x.risk} | by=${x.requestedBy || 'system'} | ${x.title}`));
    });

  approvals
    .command('approve <id>')
    .description('Approve a pending request')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--note <text>', 'Decision note', '')
    .option('--json', 'Output JSON')
    .action((id, options) => {
      const ws = workspaceFrom(options);
      const out = workflows.resolveApproval({
        workspace: ws,
        approvalId: id,
        decision: 'approve',
        note: options.note
      });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, approval: out }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Approval accepted: ${out.id}\n`));
    });

  approvals
    .command('reject <id>')
    .description('Reject a pending request')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--note <text>', 'Decision note', '')
    .option('--json', 'Output JSON')
    .action((id, options) => {
      const ws = workspaceFrom(options);
      const out = workflows.resolveApproval({
        workspace: ws,
        approvalId: id,
        decision: 'reject',
        note: options.note
      });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, approval: out }, null, 2));
        return;
      }
      console.log(chalk.yellow(`\nRejected: ${out.id}\n`));
    });

  const outcomes = ops.command('outcomes').description('Outcome log (money saved/made and operational impact)');

  outcomes
    .command('list')
    .description('List recent outcomes')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--limit <n>', 'How many rows', '20')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      const limit = parseNumber(options.limit, 20);
      const rows = storage.listOutcomes(ws).slice(-limit).reverse();
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, outcomes: rows }, null, 2));
        return;
      }
      printRows(`Outcomes (${ws})`, rows.map((x) => `${x.id} | ${x.kind} | ${x.summary}`));
    });

  const policy = ops.command('policy').description('Automation and approval policy');

  policy
    .command('show')
    .description('Show policy for a workspace')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      const p = storage.getPolicy(ws);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, policy: p }, null, 2));
        return;
      }
      console.log(chalk.bold(`\nPolicy (${ws})`));
      Object.entries(p).forEach(([k, v]) => console.log(`- ${k}: ${v}`));
      console.log('');
    });

  policy
    .command('set')
    .description('Set policy values')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--spend-threshold <n>', 'Spend threshold')
    .option('--auto-approve-low-risk <bool>', 'true|false')
    .option('--require-bulk-whatsapp-approval <bool>', 'true|false')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'admin' });
      const patch = {};
      if (options.spendThreshold !== undefined) patch.spendThreshold = parseNumber(options.spendThreshold, 200);
      if (options.autoApproveLowRisk !== undefined) patch.autoApproveLowRisk = parseBool(options.autoApproveLowRisk, false);
      if (options.requireBulkWhatsappApproval !== undefined) {
        patch.requireApprovalForBulkWhatsApp = parseBool(options.requireBulkWhatsappApproval, true);
      }
      const p = storage.setPolicy(ws, patch);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, policy: p }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Policy updated for ${ws}\n`));
    });

  const guard = ops.command('guard').description('Autonomous spend guard policy, mode, and telemetry');
  const guardPolicy = guard.command('policy').description('Guard policy (thresholds, limits, mode)');

  guardPolicy
    .command('get')
    .description('Get guard policy for a workspace')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      const policyValue = storage.getGuardPolicy(ws);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, guardPolicy: policyValue }, null, 2));
        return;
      }
      console.log(chalk.bold(`\nGuard Policy (${ws})`));
      console.log(`- enabled: ${policyValue.enabled}`);
      console.log(`- mode: ${policyValue.mode}`);
      console.log(`- thresholds.spendSpikePct: ${policyValue.thresholds.spendSpikePct}`);
      console.log(`- thresholds.cpaSpikePct: ${policyValue.thresholds.cpaSpikePct}`);
      console.log(`- thresholds.roasDropPct: ${policyValue.thresholds.roasDropPct}`);
      console.log(`- limits.maxBudgetAdjustmentPct: ${policyValue.limits.maxBudgetAdjustmentPct}`);
      console.log(`- limits.maxCampaignsPerRun: ${policyValue.limits.maxCampaignsPerRun}`);
      console.log(`- limits.maxDailyAutoActions: ${policyValue.limits.maxDailyAutoActions}`);
      console.log(`- limits.requireApprovalForPause: ${policyValue.limits.requireApprovalForPause}`);
      console.log(`- cooldownMinutes: ${policyValue.cooldownMinutes}`);
      console.log('');
    });

  guardPolicy
    .command('set')
    .description('Set guard policy values')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--enabled <bool>', 'true|false')
    .option('--mode <mode>', `Mode (${GUARD_MODES.join('|')})`)
    .option('--spend-spike-pct <n>', 'Spend spike threshold percent')
    .option('--cpa-spike-pct <n>', 'CPA spike threshold percent')
    .option('--roas-drop-pct <n>', 'ROAS drop threshold percent')
    .option('--max-budget-adjustment-pct <n>', 'Maximum budget adjustment percent')
    .option('--max-campaigns-per-run <n>', 'Maximum campaigns touched per run')
    .option('--max-daily-auto-actions <n>', 'Maximum automatic actions per day')
    .option('--require-approval-for-pause <bool>', 'true|false')
    .option('--cooldown-minutes <n>', 'Minimum cooldown between actions')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'guard_config' });
      const patch = {};
      if (options.enabled !== undefined) patch.enabled = parseBool(options.enabled, true);
      if (options.mode !== undefined) {
        const mode = normalizeGuardMode(options.mode);
        if (!mode) {
          console.error(chalk.red(`\nX Invalid mode. Use one of: ${GUARD_MODES.join(', ')}\n`));
          process.exit(1);
        }
        patch.mode = mode;
      }
      if (options.spendSpikePct !== undefined || options.cpaSpikePct !== undefined || options.roasDropPct !== undefined) {
        patch.thresholds = {};
        if (options.spendSpikePct !== undefined) patch.thresholds.spendSpikePct = parseNumber(options.spendSpikePct, 35);
        if (options.cpaSpikePct !== undefined) patch.thresholds.cpaSpikePct = parseNumber(options.cpaSpikePct, 30);
        if (options.roasDropPct !== undefined) patch.thresholds.roasDropPct = parseNumber(options.roasDropPct, 20);
      }
      if (
        options.maxBudgetAdjustmentPct !== undefined ||
        options.maxCampaignsPerRun !== undefined ||
        options.maxDailyAutoActions !== undefined ||
        options.requireApprovalForPause !== undefined
      ) {
        patch.limits = {};
        if (options.maxBudgetAdjustmentPct !== undefined) {
          patch.limits.maxBudgetAdjustmentPct = parseNumber(options.maxBudgetAdjustmentPct, 20);
        }
        if (options.maxCampaignsPerRun !== undefined) {
          patch.limits.maxCampaignsPerRun = parseNumber(options.maxCampaignsPerRun, 5);
        }
        if (options.maxDailyAutoActions !== undefined) {
          patch.limits.maxDailyAutoActions = parseNumber(options.maxDailyAutoActions, 10);
        }
        if (options.requireApprovalForPause !== undefined) {
          patch.limits.requireApprovalForPause = parseBool(options.requireApprovalForPause, true);
        }
      }
      if (options.cooldownMinutes !== undefined) patch.cooldownMinutes = parseNumber(options.cooldownMinutes, 60);

      const policyValue = storage.setGuardPolicy(ws, patch);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, guardPolicy: policyValue }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Guard policy updated for ${ws}\n`));
    });

  guard
    .command('mode [mode]')
    .description(`Show or set guard mode (${GUARD_MODES.join('|')})`)
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--set <mode>', `Mode (${GUARD_MODES.join('|')})`)
    .option('--json', 'Output JSON')
    .action((modeArg, options) => {
      const ws = workspaceFrom(options);
      const requested = options.set !== undefined ? options.set : modeArg;
      if (requested === undefined) {
        rbac.assertCan({ workspace: ws, action: 'read' });
        const policyValue = storage.getGuardPolicy(ws);
        if (options.json) {
          console.log(JSON.stringify({ workspace: ws, mode: policyValue.mode }, null, 2));
          return;
        }
        console.log(chalk.cyan(`\nGuard mode (${ws}): ${policyValue.mode}\n`));
        return;
      }

      rbac.assertCan({ workspace: ws, action: 'guard_config' });
      const mode = normalizeGuardMode(requested);
      if (!mode) {
        console.error(chalk.red(`\nX Invalid mode. Use one of: ${GUARD_MODES.join(', ')}\n`));
        process.exit(1);
      }
      const policyValue = storage.setGuardPolicy(ws, { mode });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, mode: policyValue.mode }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Guard mode set: ${ws} => ${policyValue.mode}\n`));
    });

  const roles = ops.command('roles').description('Role-based access controls for workspaces');

  roles
    .command('show')
    .description('Show role for a user/workspace')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--user <user>', 'User name', rbac.currentUser())
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = options.workspace ? workspaceFrom(options) : '';
      const role = storage.getRole({ workspace: ws, user: options.user });
      if (options.json) {
        console.log(JSON.stringify({ user: options.user, workspace: ws || null, role }, null, 2));
        return;
      }
      console.log(chalk.cyan(`\n${options.user} => ${role}${ws ? ` (${ws})` : ' (global)'}\n`));
    });

  roles
    .command('set <user> <role>')
    .description('Set role (viewer|analyst|operator|owner)')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((user, role, options) => {
      const currentWs = options.workspace ? workspaceFrom(options) : config.getActiveProfile();
      rbac.assertCan({ workspace: currentWs, action: 'admin' });
      const normalized = rbac.normalizeRole(role);
      if (!rbac.roleChoices().includes(normalized)) {
        console.error(chalk.red(`\nX Invalid role. Use one of: ${rbac.roleChoices().join(', ')}\n`));
        process.exit(1);
      }
      const entry = storage.setRole({
        workspace: options.workspace ? workspaceFrom(options) : '',
        user,
        role: normalized
      });
      if (options.json) {
        console.log(JSON.stringify({ user, role: normalized, entry }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Role set: ${user} => ${normalized}${options.workspace ? ` (${workspaceFrom(options)})` : ' (global)'}\n`));
    });

  const user = ops.command('user').description('Active operator identity used for RBAC + audit logs');

  user
    .command('show')
    .description('Show current active operator')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      const operator = typeof config.getOperator === 'function'
        ? config.getOperator()
        : { id: '', name: '' };
      const id = operator.id || rbac.currentUser();
      const role = storage.getRole({ workspace: ws, user: id });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, operator: { id, name: operator.name || '' }, role }, null, 2));
        return;
      }
      console.log(chalk.cyan(`\nActive operator: ${id}${operator.name ? ` (${operator.name})` : ''}`));
      console.log(chalk.gray(`Workspace role (${ws}): ${role}\n`));
    });

  user
    .command('set <id>')
    .description('Set active operator id for future commands/logs')
    .option('--name <name>', 'Display name')
    .option('--json', 'Output JSON')
    .action((id, options) => {
      const next = config.setOperator({ id, name: options.name || '' });
      if (options.json) {
        console.log(JSON.stringify({ operator: next }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Active operator set: ${next.id}${next.name ? ` (${next.name})` : ''}\n`));
    });

  user
    .command('clear')
    .description('Clear active operator (fallback to SOCIAL_USER/OS user)')
    .option('--json', 'Output JSON')
    .action((options) => {
      config.clearOperator();
      if (options.json) {
        console.log(JSON.stringify({ operator: { id: '', name: '' } }, null, 2));
        return;
      }
      console.log(chalk.green('\nOK Active operator cleared.\n'));
    });

  const activity = ops.command('activity').description('Audit view: who worked on what');

  activity
    .command('list')
    .description('List recent action log items')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--actor <id>', 'Filter by actor id')
    .option('--limit <n>', 'How many rows', '30')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      const limit = Math.max(1, parseNumber(options.limit, 30));
      let rows = storage.listActionLog(ws);
      if (options.actor) {
        const actor = String(options.actor || '').trim();
        rows = rows.filter((x) => String(x.actor || '') === actor);
      }
      rows = rows.slice(-limit).reverse();
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, activity: rows }, null, 2));
        return;
      }
      printRows(
        `Activity (${ws})`,
        rows.map((x) => `${x.createdAt} | ${x.actor} | ${x.action} | ${x.status} | ${x.summary}`)
      );
    });

  ops
    .command('handoff')
    .description('Generate a one-file team onboarding and runbook document for a workspace')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--out <file>', 'Output markdown file path')
    .option('--template <name>', 'Template: simple|agency|enterprise', 'agency')
    .option('--studio-url <url>', 'Studio URL', 'http://127.0.0.1:1310')
    .option('--gateway-api-key <key>', 'Gateway API key placeholder/value')
    .option('--operator-id <id>', 'Default operator id placeholder')
    .option('--run-at <iso>', 'Suggested daily run time (ISO)')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      const suggestedRunAt = toIsoOrFallback(options.runAt, new Date().toISOString());
      const template = String(options.template || 'agency').trim().toLowerCase();
      const allowedTemplates = new Set(['simple', 'agency', 'enterprise']);
      if (!allowedTemplates.has(template)) {
        console.error(chalk.red('\nX Invalid template. Use: simple, agency, enterprise\n'));
        process.exit(1);
      }
      const outputPath = path.resolve(
        process.cwd(),
        String(options.out || `handoff-${ws}.md`)
      );
      const doc = buildHandoffDoc({
        template,
        workspace: ws,
        studioUrl: String(options.studioUrl || 'http://127.0.0.1:1310').trim(),
        gatewayApiKey: String(options.gatewayApiKey || '').trim(),
        operatorId: String(options.operatorId || '').trim(),
        runAtIso: suggestedRunAt,
        generatedAt: new Date().toISOString()
      });
      fs.writeFileSync(outputPath, doc, 'utf8');
      if (options.json) {
        console.log(JSON.stringify({
          ok: true,
          workspace: ws,
          template,
          output: outputPath,
          bytes: Buffer.byteLength(doc, 'utf8')
        }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Handoff document generated: ${outputPath}\n`));
    });

  const schedule = ops.command('schedule').description('Job scheduler for automated runs');

  schedule
    .command('list')
    .description('List schedules')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      const rows = storage.listSchedules(ws);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, schedules: rows }, null, 2));
        return;
      }
      printRows(`Schedules (${ws})`, rows.map((x) => `${x.id} | ${x.enabled ? 'on' : 'off'} | ${x.workflow} | ${x.runAt} | repeat=${x.repeat}`));
    });

  schedule
    .command('add')
    .description('Add a schedule')
    .requiredOption('--name <name>', 'Name')
    .requiredOption('--run-at <iso>', 'Run time (ISO)')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--workflow <workflow>', 'Workflow id', 'morning_ops')
    .option('--repeat <mode>', 'none|hourly|daily', 'daily')
    .option('--spend <n>', 'Spend payload for morning ops', '0')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'write' });
      const item = storage.addSchedule(ws, {
        name: options.name,
        workflow: options.workflow,
        runAt: options.runAt,
        repeat: options.repeat,
        payload: { spend: parseNumber(options.spend, 0) }
      });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, schedule: item }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Schedule added: ${item.id}\n`));
    });

  schedule
    .command('remove <id>')
    .description('Remove a schedule')
    .option('--workspace <name>', 'Workspace/profile name')
    .action((id, options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'write' });
      storage.removeSchedule(ws, id);
      console.log(chalk.green(`\nOK Schedule removed: ${id}\n`));
    });

  schedule
    .command('run-due')
    .description('Execute due schedules now')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      const results = workflows.runDueSchedules({ workspace: ws, config });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, results }, null, 2));
        return;
      }
      printRows(`Run-due results (${ws})`, results.map((r) => `${r.id} | ${r.status} | next=${r.nextRunAt || 'none'}`));
    });

  const sources = ops.command('sources').description('Knowledge sources and connector sync status');

  sources
    .command('list')
    .description('List configured sources')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      const rows = storage.listSources(ws);
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, sources: rows }, null, 2));
        return;
      }
      printRows(
        `Sources (${ws})`,
        rows.map((x) => `${x.id} | ${x.enabled ? 'on' : 'off'} | ${x.connector} | ${x.syncMode} | ${x.status} | items=${x.itemCount}`)
      );
    });

  sources
    .command('upsert')
    .description('Create or update a source definition')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--id <id>', 'Existing source id to update')
    .requiredOption('--name <name>', 'Source display name')
    .requiredOption('--connector <name>', 'facebook_ads|instagram_insights|whatsapp_events|marketing_campaigns|slack_channels|csv_upload|webhook|custom')
    .option('--sync-mode <mode>', 'manual|scheduled', 'manual')
    .option('--enabled <bool>', 'true|false', 'true')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'write' });
      const source = storage.upsertSource(ws, {
        id: options.id,
        name: options.name,
        connector: options.connector,
        syncMode: options.syncMode,
        enabled: parseBool(options.enabled, true)
      });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, source }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Source saved: ${source.id} (${source.name})\n`));
    });

  sources
    .command('sync')
    .description('Run sync for one or more sources')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--id <id>', 'Single source id')
    .option('--ids <csv>', 'Comma-separated source ids')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      const ids = options.id ? [String(options.id).trim()] : csvIds(options.ids);
      const results = workflows.syncSources({
        workspace: ws,
        sourceIds: ids.length ? ids : null,
        config
      });
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, results }, null, 2));
        return;
      }
      printRows(`Source sync (${ws})`, results.map((r) => `${r.id} | ${r.status}`));
    });

  const integrations = ops.command('integrations').description('Workspace integration settings (webhooks)');

  integrations
    .command('show')
    .description('Show configured integrations')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'read' });
      const val = storage.getIntegrations(ws);
      const safe = {
        ...val,
        slackWebhook: val.slackWebhook ? '***configured***' : '',
        outboundWebhook: val.outboundWebhook ? '***configured***' : ''
      };
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, integrations: safe }, null, 2));
        return;
      }
      console.log(chalk.bold(`\nIntegrations (${ws})`));
      console.log(`- slackWebhook: ${safe.slackWebhook || '(not set)'}`);
      console.log(`- outboundWebhook: ${safe.outboundWebhook || '(not set)'}`);
      console.log('');
    });

  integrations
    .command('set')
    .description('Set integration endpoints')
    .option('--workspace <name>', 'Workspace/profile name')
    .option('--slack-webhook <url>', 'Slack incoming webhook URL')
    .option('--outbound-webhook <url>', 'Generic outbound webhook URL')
    .option('--json', 'Output JSON')
    .action((options) => {
      const ws = workspaceFrom(options);
      rbac.assertCan({ workspace: ws, action: 'admin' });
      const patch = {};
      if (options.slackWebhook !== undefined) patch.slackWebhook = String(options.slackWebhook || '').trim();
      if (options.outboundWebhook !== undefined) patch.outboundWebhook = String(options.outboundWebhook || '').trim();
      const val = storage.setIntegrations(ws, patch);
      const safe = {
        ...val,
        slackWebhook: val.slackWebhook ? '***configured***' : '',
        outboundWebhook: val.outboundWebhook ? '***configured***' : ''
      };
      if (options.json) {
        console.log(JSON.stringify({ workspace: ws, integrations: safe }, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Integrations updated for ${ws}\n`));
    });
}

module.exports = registerOpsCommands;

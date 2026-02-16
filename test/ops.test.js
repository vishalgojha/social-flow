const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configSingleton = require('../lib/config');
const storage = require('../lib/ops/storage');
const workflows = require('../lib/ops/workflows');

function withTempHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-ops-test-'));
  const prevSocial = process.env.SOCIAL_CLI_HOME;
  const prevMeta = process.env.META_CLI_HOME;
  process.env.SOCIAL_CLI_HOME = dir;
  process.env.META_CLI_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (prevSocial === undefined) delete process.env.SOCIAL_CLI_HOME;
    else process.env.SOCIAL_CLI_HOME = prevSocial;
    if (prevMeta === undefined) delete process.env.META_CLI_HOME;
    else process.env.META_CLI_HOME = prevMeta;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = [
  {
    name: 'ops storage creates and updates lead state',
    fn: () => withTempHome(() => {
      const ws = storage.ensureWorkspace('clientA');
      const lead = storage.addLead(ws, {
        name: 'Alice',
        phone: '+15551234567',
        status: 'new',
        tags: ['priority']
      });
      assert.equal(lead.name, 'Alice');
      const updated = storage.updateLead(ws, lead.id, { status: 'no_reply_3d' });
      assert.equal(updated.status, 'no_reply_3d');
      const all = storage.listLeads(ws);
      assert.equal(all.length, 1);
      assert.equal(all[0].id, lead.id);
    })
  },
  {
    name: 'ops morning run creates missing token alerts',
    fn: () => withTempHome(() => {
      const { ConfigManager } = configSingleton;
      const cfg = new ConfigManager();
      cfg.createProfile('clientA');

      const out = workflows.runMorningOps({
        workspace: 'clientA',
        config: cfg,
        spend: 0,
        force: true
      });

      assert.equal(out.skipped, false);
      assert.equal(out.stats.alertsCreated >= 1, true);
      const alerts = storage.listAlerts('clientA');
      assert.equal(alerts.some((a) => a.type === 'token_missing'), true);
    })
  },
  {
    name: 'ops morning run creates spend approval above threshold',
    fn: () => withTempHome(() => {
      const { ConfigManager } = configSingleton;
      const cfg = new ConfigManager();
      cfg.createProfile('clientA');
      storage.setPolicy('clientA', { spendThreshold: 100 });

      const out = workflows.runMorningOps({
        workspace: 'clientA',
        config: cfg,
        spend: 250,
        force: true
      });

      assert.equal(out.stats.approvalsCreated >= 1, true);
      const approvals = storage.listApprovals('clientA');
      assert.equal(approvals.some((a) => a.action === 'marketing.pause_overspend'), true);
    })
  },
  {
    name: 'ops scheduler runs due jobs and advances repeat',
    fn: () => withTempHome(() => {
      const { ConfigManager } = configSingleton;
      const cfg = new ConfigManager();
      cfg.createProfile('clientA');

      const dueTime = new Date(Date.now() - 60 * 1000).toISOString();
      const job = storage.addSchedule('clientA', {
        name: 'Morning',
        workflow: 'morning_ops',
        runAt: dueTime,
        repeat: 'daily',
        payload: { spend: 0 }
      });

      const results = workflows.runDueSchedules({
        workspace: 'clientA',
        config: cfg
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].id, job.id);
      assert.equal(results[0].status, 'ok');
      assert.equal(Boolean(results[0].nextRunAt), true);

      const latest = storage.listSchedules('clientA').find((x) => x.id === job.id);
      assert.equal(Boolean(latest.lastRunAt), true);
      assert.equal(latest.enabled, true);
    })
  },
  {
    name: 'ops integrations can be set and retrieved per workspace',
    fn: () => withTempHome(() => {
      const ws = storage.ensureWorkspace('clientA');
      const next = storage.setIntegrations(ws, {
        slackWebhook: 'https://hooks.slack.com/services/T000/B000/XXX'
      });
      assert.equal(Boolean(next.slackWebhook), true);
      const read = storage.getIntegrations(ws);
      assert.equal(read.slackWebhook.includes('https://hooks.slack.com/'), true);
    })
  },
  {
    name: 'ops guard policy supports nested updates and mode control',
    fn: () => withTempHome(() => {
      const ws = storage.ensureWorkspace('clientA');
      const current = storage.getGuardPolicy(ws);
      assert.equal(current.mode, 'approval');
      assert.equal(current.thresholds.cpaSpikePct, 30);

      const next = storage.setGuardPolicy(ws, {
        mode: 'auto_safe',
        thresholds: { spendSpikePct: 55 },
        limits: { maxCampaignsPerRun: 3 }
      });

      assert.equal(next.mode, 'auto_safe');
      assert.equal(next.thresholds.spendSpikePct, 55);
      assert.equal(next.thresholds.cpaSpikePct, 30);
      assert.equal(next.limits.maxCampaignsPerRun, 3);
      assert.equal(next.limits.maxDailyAutoActions, 10);
    })
  },
  {
    name: 'ops guard data model persists incidents, actions, and rollback snapshots',
    fn: () => withTempHome(() => {
      const ws = storage.ensureWorkspace('clientA');

      const incident = storage.addIncident(ws, {
        type: 'spend_spike',
        severity: 'high',
        title: 'Spend spiked in 1h',
        detail: 'Hourly spend crossed threshold.'
      });
      assert.equal(incident.status, 'open');

      const resolved = storage.updateIncident(ws, incident.id, { status: 'resolved' });
      assert.equal(resolved.status, 'resolved');

      const action = storage.appendActionLog(ws, {
        incidentId: incident.id,
        action: 'marketing.pause_overspend',
        status: 'executed',
        risk: 'high',
        actor: 'test-user',
        summary: 'Paused top overspending campaigns.'
      });
      assert.equal(action.incidentId, incident.id);

      const snapshot = storage.addRollbackSnapshot(ws, {
        actionId: action.id,
        targetType: 'campaign',
        targetId: 'cmp_123',
        before: { status: 'ACTIVE' },
        after: { status: 'PAUSED' }
      });
      assert.equal(snapshot.targetType, 'campaign');

      assert.equal(storage.listIncidents(ws).length, 1);
      assert.equal(storage.listActionLog(ws).length, 1);
      assert.equal(storage.listRollbackSnapshots(ws).length, 1);
    })
  },
  {
    name: 'ops sources can be upserted and synced',
    fn: () => withTempHome(() => {
      const { ConfigManager } = configSingleton;
      const cfg = new ConfigManager();
      cfg.createProfile('clientA');

      const ws = storage.ensureWorkspace('clientA');
      const source = storage.upsertSource(ws, {
        name: 'CSV Leads',
        connector: 'csv_upload',
        syncMode: 'manual',
        enabled: true
      });
      assert.equal(source.connector, 'csv_upload');

      const results = workflows.syncSources({
        workspace: ws,
        config: cfg
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].status, 'ok');

      const after = storage.getSource(ws, source.id);
      assert.equal(after.status, 'ready');
      assert.equal(after.itemCount > 0, true);
    })
  }
];

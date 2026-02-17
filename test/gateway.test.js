const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGatewayServer } = require('../lib/gateway/server');
const opsStorage = require('../lib/ops/storage');

function requestJson({ port, method, pathName, body, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function requestRaw({ port, method, pathName, body, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = [
  {
    name: 'gateway health endpoint returns ok',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const res = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/health'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway config endpoint returns sanitized snapshot',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const res = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        assert.equal(res.status, 200);
        assert.equal(Boolean(res.data.config), true);
        assert.equal(typeof res.data.config.tokens.facebook.configured, 'boolean');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway auth middleware enforces x-gateway-key when required',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        apiKey: 'test-secret',
        requireApiKey: true
      });
      try {
        await server.start();

        const denied = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        assert.equal(denied.status, 401);
        assert.equal(denied.data.ok, false);

        const allowed = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config',
          headers: { 'X-Gateway-Key': 'test-secret' }
        });
        assert.equal(allowed.status, 200);
        assert.equal(Boolean(allowed.data.config), true);

        const health = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/health'
        });
        assert.equal(health.status, 200);
        assert.equal(health.data.ok, true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway blocks disallowed CORS origins',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        corsOrigins: 'http://allowed.local'
      });
      try {
        await server.start();

        const blocked = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config',
          headers: { Origin: 'http://evil.local' }
        });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.data.ok, false);

        const preflight = await requestJson({
          port: server.port,
          method: 'OPTIONS',
          pathName: '/api/config',
          headers: {
            Origin: 'http://allowed.local',
            'Access-Control-Request-Method': 'GET'
          }
        });
        assert.equal(preflight.status, 204);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway rate limiter rejects excessive requests',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        rateLimitMax: 2,
        rateLimitWindowMs: 60 * 1000
      });
      try {
        await server.start();

        const one = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        const two = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        const three = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });

        assert.equal(one.status, 200);
        assert.equal(two.status, 200);
        assert.equal(three.status, 429);
        assert.equal(three.data.ok, false);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway chat endpoints create session and process message',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldOpenAI = process.env.OPENAI_API_KEY;
      const oldMeta = process.env.META_AI_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.META_AI_KEY;

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const startRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/start',
          body: {}
        });
        assert.equal(startRes.status, 200);
        assert.equal(Boolean(startRes.data.sessionId), true);

        const msgRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: {
            sessionId: startRes.data.sessionId,
            message: 'hello'
          }
        });

        assert.equal(msgRes.status, 200);
        assert.equal(msgRes.data.ok, true);
        assert.equal(typeof msgRes.data.response.message, 'string');
        assert.equal(msgRes.data.response.actions.length, 0);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        if (oldOpenAI) process.env.OPENAI_API_KEY = oldOpenAI;
        if (oldMeta) process.env.META_AI_KEY = oldMeta;
      }
    }
  },
  {
    name: 'gateway chat deterministic command executes immediately without pending confirmation',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldOpenAI = process.env.OPENAI_API_KEY;
      const oldMeta = process.env.META_AI_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.META_AI_KEY;

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const startRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/start',
          body: {}
        });
        assert.equal(startRes.status, 200);
        assert.equal(Boolean(startRes.data.sessionId), true);

        const msgRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: {
            sessionId: startRes.data.sessionId,
            message: 'social auth status'
          }
        });

        assert.equal(msgRes.status, 200);
        assert.equal(msgRes.data.ok, true);
        assert.equal(Array.isArray(msgRes.data.executed), true);
        assert.equal(msgRes.data.executed.length, 1);
        assert.equal(Array.isArray(msgRes.data.pendingActions), true);
        assert.equal(msgRes.data.pendingActions.length, 0);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        if (oldOpenAI) process.env.OPENAI_API_KEY = oldOpenAI;
        if (oldMeta) process.env.META_AI_KEY = oldMeta;
      }
    }
  },
  {
    name: 'gateway ops endpoints support summary, guard policy, runs, lists, and resolution',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const oldSocialHome = process.env.SOCIAL_CLI_HOME;
      const oldSocialUser = process.env.SOCIAL_USER;
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.META_CLI_HOME = tempHome;
      process.env.SOCIAL_CLI_HOME = tempHome;
      process.env.SOCIAL_USER = 'local-user';

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const summary1 = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/summary?workspace=default'
        });
        assert.equal(summary1.status, 200);
        assert.equal(summary1.data.ok, true);
        assert.equal(typeof summary1.data.summary.alertsOpen, 'number');
        assert.equal(typeof summary1.data.summary.guardPolicy.mode, 'string');

        const guardGet = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/guard/policy?workspace=default'
        });
        assert.equal(guardGet.status, 200);
        assert.equal(guardGet.data.ok, true);
        assert.equal(guardGet.data.guardPolicy.mode, 'approval');

        const guardMode = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/guard/mode',
          body: { workspace: 'default', mode: 'auto_safe' }
        });
        assert.equal(guardMode.status, 200);
        assert.equal(guardMode.data.ok, true);
        assert.equal(guardMode.data.mode, 'auto_safe');

        const guardSet = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/guard/policy',
          body: {
            workspace: 'default',
            thresholds: { spendSpikePct: 44 },
            limits: { maxCampaignsPerRun: 3 }
          }
        });
        assert.equal(guardSet.status, 200);
        assert.equal(guardSet.data.ok, true);
        assert.equal(guardSet.data.guardPolicy.thresholds.spendSpikePct, 44);
        assert.equal(guardSet.data.guardPolicy.limits.maxCampaignsPerRun, 3);

        const sourceUpsert = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/sources/upsert',
          body: {
            workspace: 'default',
            name: 'Campaign Source',
            connector: 'csv_upload',
            syncMode: 'manual',
            enabled: true
          }
        });
        assert.equal(sourceUpsert.status, 200);
        assert.equal(sourceUpsert.data.ok, true);
        assert.equal(sourceUpsert.data.source.connector, 'csv_upload');

        const sources = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/sources?workspace=default'
        });
        assert.equal(sources.status, 200);
        assert.equal(sources.data.ok, true);
        assert.equal(Array.isArray(sources.data.sources), true);
        assert.equal(sources.data.sources.length > 0, true);

        const sourceSync = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/sources/sync',
          body: { workspace: 'default' }
        });
        assert.equal(sourceSync.status, 200);
        assert.equal(sourceSync.data.ok, true);
        assert.equal(Array.isArray(sourceSync.data.result), true);
        assert.equal(sourceSync.data.result.length > 0, true);
        assert.equal(sourceSync.data.result[0].source.status, 'ready');

        const slackSourceUpsert = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/sources/upsert',
          body: {
            workspace: 'default',
            name: 'Slack Routing',
            connector: 'slack_channels',
            syncMode: 'manual',
            enabled: true
          }
        });
        assert.equal(slackSourceUpsert.status, 200);
        assert.equal(slackSourceUpsert.data.ok, true);
        assert.equal(slackSourceUpsert.data.source.connector, 'slack_channels');

        const slackSourceSync = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/sources/sync',
          body: { workspace: 'default', id: slackSourceUpsert.data.source.id }
        });
        assert.equal(slackSourceSync.status, 200);
        assert.equal(slackSourceSync.data.ok, true);
        assert.equal(Array.isArray(slackSourceSync.data.result), true);
        assert.equal(slackSourceSync.data.result.length, 1);
        assert.equal(slackSourceSync.data.result[0].source.status, 'error');
        assert.equal(String(slackSourceSync.data.result[0].source.lastError || '').includes('slackWebhook'), true);

        const run = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/morning-run',
          body: { workspace: 'default', spend: 1000, force: true }
        });
        assert.equal(run.status, 200);
        assert.equal(run.data.ok, true);
        assert.equal(Boolean(run.data.snapshot), true);

        const alerts = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/alerts?workspace=default&open=1'
        });
        assert.equal(alerts.status, 200);
        assert.equal(alerts.data.ok, true);
        assert.equal(Array.isArray(alerts.data.alerts), true);
        assert.equal(alerts.data.alerts.length > 0, true);

        const approvals = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/approvals?workspace=default&open=1'
        });
        assert.equal(approvals.status, 200);
        assert.equal(approvals.data.ok, true);
        assert.equal(Array.isArray(approvals.data.approvals), true);
        assert.equal(approvals.data.approvals.length > 0, true);

        const exportJson = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/activity/export?workspace=default&format=json&limit=10'
        });
        assert.equal(exportJson.status, 200);
        assert.equal(exportJson.data.ok, true);
        assert.equal(Array.isArray(exportJson.data.activity), true);

        const exportCsv = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/activity/export?workspace=default&format=csv&limit=10'
        });
        assert.equal(exportCsv.status, 200);
        assert.equal(String(exportCsv.headers['content-type'] || '').includes('text/csv'), true);
        assert.equal(exportCsv.raw.includes('createdAt,workspace,actor,action,status,summary,meta'), true);

        const handoffOutDir = path.join(tempHome, 'handoff-pack-default');
        const handoffPack = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/handoff/pack',
          body: { workspace: 'default', template: 'enterprise', outDir: handoffOutDir }
        });
        assert.equal(handoffPack.status, 200);
        assert.equal(handoffPack.data.ok, true);
        assert.equal(handoffPack.data.template, 'enterprise');
        assert.equal(fs.existsSync(handoffPack.data.files.handoff), true);
        assert.equal(fs.existsSync(handoffPack.data.files.runbook), true);
        assert.equal(fs.existsSync(handoffPack.data.files.accessMatrix), true);
        assert.equal(fs.existsSync(handoffPack.data.files.incidentPlaybook), true);

        const fileDownload = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: `/api/ops/handoff/file?path=${encodeURIComponent(handoffPack.data.files.handoff)}`
        });
        assert.equal(fileDownload.status, 200);
        assert.equal(String(fileDownload.headers['content-disposition'] || '').includes('handoff.md'), true);
        assert.equal(String(fileDownload.raw || '').includes('# Social CLI Agency Handoff - default'), true);

        const setViewerRole = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/role',
          body: { workspace: 'default', user: 'local-user', role: 'viewer' }
        });
        assert.equal(setViewerRole.status, 200);
        assert.equal(setViewerRole.data.ok, true);

        const rolesList = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/roles?workspace=default'
        });
        assert.equal(rolesList.status, 200);
        assert.equal(rolesList.data.ok, true);
        assert.equal(Array.isArray(rolesList.data.roles), true);
        assert.equal(rolesList.data.roles.some((x) => x.user === 'local-user' && x.role === 'viewer'), true);

        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'owner' });
        const inviteCreate = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/invites',
          body: { workspace: 'default', role: 'operator', expiresInHours: 72, baseUrl: 'http://127.0.0.1:1310' }
        });
        assert.equal(inviteCreate.status, 200);
        assert.equal(inviteCreate.data.ok, true);
        assert.equal(typeof inviteCreate.data.invite.token, 'string');
        assert.equal(String(inviteCreate.data.invite.acceptUrl || '').includes('?invite='), true);

        const inviteList = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/invites?workspace=default'
        });
        assert.equal(inviteList.status, 200);
        assert.equal(inviteList.data.ok, true);
        assert.equal(Array.isArray(inviteList.data.invites), true);
        assert.equal(inviteList.data.invites.length > 0, true);
        assert.equal(String(inviteList.data.invites[0].token || ''), '');

        const inviteResend = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/invites/resend',
          body: { workspace: 'default', id: inviteCreate.data.invite.id, baseUrl: 'http://127.0.0.1:1310' }
        });
        assert.equal(inviteResend.status, 200);
        assert.equal(inviteResend.data.ok, true);
        assert.equal(typeof inviteResend.data.invite.token, 'string');
        assert.equal(String(inviteResend.data.invite.acceptUrl || '').includes('?invite='), true);

        const inviteAcceptOld = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/invites/accept',
          body: { token: inviteCreate.data.invite.token, user: 'invite-user-old' }
        });
        assert.equal(inviteAcceptOld.status, 400);
        assert.equal(inviteAcceptOld.data.ok, false);

        const inviteAccept = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/invites/accept',
          body: { token: inviteResend.data.invite.token, user: 'invite-user' }
        });
        assert.equal(inviteAccept.status, 200);
        assert.equal(inviteAccept.data.ok, true);
        assert.equal(inviteAccept.data.invite.status, 'accepted');
        assert.equal(opsStorage.getRole({ workspace: 'default', user: 'invite-user' }), 'operator');
        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'viewer' });

        const deniedResolve = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/approvals/resolve',
          body: { workspace: 'default', id: approvals.data.approvals[0].id, decision: 'approve' }
        });
        assert.equal(deniedResolve.status, 400);
        assert.equal(deniedResolve.data.ok, false);
        assert.equal(String(deniedResolve.data.error || '').includes('Permission denied'), true);

        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'operator' });

        const ack = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/alerts/ack',
          body: { workspace: 'default', id: alerts.data.alerts[0].id }
        });
        assert.equal(ack.status, 200);
        assert.equal(ack.data.ok, true);
        assert.equal(ack.data.alert.status, 'acked');

        const resolve = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/approvals/resolve',
          body: { workspace: 'default', id: approvals.data.approvals[0].id, decision: 'approve' }
        });
        assert.equal(resolve.status, 200);
        assert.equal(resolve.data.ok, true);
        assert.equal(resolve.data.approval.status, 'approved');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        process.env.SOCIAL_CLI_HOME = oldSocialHome;
        if (oldSocialUser === undefined) delete process.env.SOCIAL_USER;
        else process.env.SOCIAL_USER = oldSocialUser;
      }
    }
  }
];

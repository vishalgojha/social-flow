const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGatewayServer } = require('../lib/gateway/server');

function requestJson({ port, method, pathName, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json'
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
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.META_CLI_HOME = tempHome;
      process.env.SOCIAL_CLI_HOME = tempHome;

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
      }
    }
  }
];

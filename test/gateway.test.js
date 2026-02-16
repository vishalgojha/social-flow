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
  }
];

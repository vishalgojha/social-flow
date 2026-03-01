const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { createGatewayServer } = require('../lib/gateway/server');
const config = require('../lib/config');
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

const AI_KEY_ENV_VARS = [
  'OPENAI_API_KEY',
  'META_AI_KEY',
  'SOCIAL_AI_KEY',
  'SOCIAL_CHAT_API_KEY',
  'META_CHAT_API_KEY',
  'SOCIAL_AGENT_API_KEY',
  'META_AGENT_API_KEY'
];

function snapshotAiKeyEnv() {
  return Object.fromEntries(AI_KEY_ENV_VARS.map((k) => [k, process.env[k]]));
}

function clearAiKeyEnv() {
  AI_KEY_ENV_VARS.forEach((k) => { delete process.env[k]; });
}

function restoreAiKeyEnv(prev) {
  AI_KEY_ENV_VARS.forEach((k) => {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  });
}

function snapshotAgentConfig() {
  const cfg = typeof config.getAgentConfig === 'function' ? config.getAgentConfig() : {};
  return {
    provider: String(cfg.provider || 'openai'),
    model: String(cfg.model || ''),
    apiKey: String(cfg.apiKey || '')
  };
}

function restoreAgentConfig(prev) {
  if (typeof config.setAgentProvider === 'function') {
    config.setAgentProvider(String(prev.provider || 'openai'));
  }
  if (typeof config.setAgentModel === 'function') {
    config.setAgentModel(String(prev.model || ''));
  }
  if (typeof config.setAgentApiKey === 'function') {
    config.setAgentApiKey(String(prev.apiKey || ''));
  }
}

function clearAgentApiConfig() {
  if (typeof config.setAgentProvider === 'function') {
    config.setAgentProvider('openai');
  }
  if (typeof config.setAgentApiKey === 'function') {
    config.setAgentApiKey('');
  }
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WS connect timeout: ${url}`));
    }, 2000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    name: 'gateway root endpoint serves bundled studio ui',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const root = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/'
        });
        assert.equal(root.status, 200);
        assert.equal(String(root.headers['content-type'] || '').includes('text/html'), true);
        assert.equal(String(root.raw || '').toLowerCase().includes('social studio'), true);

        const staticCss = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/styles.css'
        });
        assert.equal(staticCss.status, 200);
        assert.equal(String(staticCss.headers['content-type'] || '').includes('text/css'), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway sdk routes expose action catalog and approval-safe plan/execute flow',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const actions = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/sdk/actions'
        });
        assert.equal(actions.status, 200);
        assert.equal(actions.data.ok, true);
        assert.equal(Array.isArray(actions.data.data.actions), true);

        const plan = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/sdk/actions/plan',
          body: {
            action: 'create_post',
            params: { message: 'hello world', pageId: '123' }
          }
        });
        assert.equal(plan.status, 200);
        assert.equal(plan.data.ok, true);
        assert.equal(plan.data.meta.action, 'create_post');
        assert.equal(plan.data.meta.requiresApproval, true);
        assert.equal(Boolean(plan.data.meta.approvalToken), true);

        const executeWithoutApproval = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/sdk/actions/execute',
          body: {
            action: 'create_post',
            params: { message: 'hello world', pageId: '123' }
          }
        });
        assert.equal(executeWithoutApproval.status, 428);
        assert.equal(executeWithoutApproval.data.ok, false);
        assert.equal(executeWithoutApproval.data.error.code, 'APPROVAL_REQUIRED');

        const executeLowRisk = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/sdk/actions/execute',
          body: { action: 'status', params: {} }
        });
        assert.equal(executeLowRisk.status, 200);
        assert.equal(executeLowRisk.data.ok, true);
        assert.equal(executeLowRisk.data.meta.action, 'status');
        assert.equal(executeLowRisk.data.meta.requiresApproval, false);
        assert.equal(executeLowRisk.data.data.service, 'social-api-gateway');
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
        assert.equal(typeof res.data.config.agent.apiKeyConfigured, 'boolean');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway config update endpoint saves tokens and agent credentials',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const saveRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/config/update',
          body: {
            tokens: {
              facebook: 'fb_test_token_123456',
              instagram: 'ig_test_token_123456'
            },
            app: {
              appId: '123456789',
              appSecret: 'secret_test_value'
            },
            defaultApi: 'instagram',
            agent: {
              provider: 'openai',
              model: 'gpt-4.1-mini',
              apiKey: 'sk-test-1234'
            }
          }
        });
        assert.equal(saveRes.status, 200);
        assert.equal(saveRes.data.ok, true);
        assert.equal(Array.isArray(saveRes.data.updated), true);
        assert.equal(saveRes.data.updated.includes('tokens.facebook'), true);
        assert.equal(saveRes.data.updated.includes('tokens.instagram'), true);
        assert.equal(saveRes.data.updated.includes('app.appId'), true);
        assert.equal(saveRes.data.updated.includes('app.appSecret'), true);
        assert.equal(saveRes.data.updated.includes('defaultApi'), true);
        assert.equal(saveRes.data.updated.includes('agent.provider'), true);
        assert.equal(saveRes.data.updated.includes('agent.model'), true);
        assert.equal(saveRes.data.updated.includes('agent.apiKey'), true);

        const configRes = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        assert.equal(configRes.status, 200);
        assert.equal(configRes.data.config.tokens.facebook.configured, true);
        assert.equal(configRes.data.config.tokens.instagram.configured, true);
        assert.equal(configRes.data.config.tokens.whatsapp.configured, false);
        assert.equal(configRes.data.config.app.appId, '123456789');
        assert.equal(configRes.data.config.app.appSecretConfigured, true);
        assert.equal(configRes.data.config.defaultApi, 'instagram');
        assert.equal(configRes.data.config.agent.provider, 'openai');
        assert.equal(configRes.data.config.agent.model, 'gpt-4.1-mini');
        assert.equal(configRes.data.config.agent.apiKeyConfigured, true);
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
    name: 'gateway team operator route bootstraps local owner then enforces admin role',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const oldSocialHome = process.env.SOCIAL_CLI_HOME;
      const oldSocialUser = process.env.SOCIAL_USER;
      const oldOperator = typeof config.getOperator === 'function'
        ? config.getOperator()
        : { id: '', name: '' };
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.META_CLI_HOME = tempHome;
      process.env.SOCIAL_CLI_HOME = tempHome;
      process.env.SOCIAL_USER = 'local-user';

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const bootstrap = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator',
          body: { workspace: 'default', id: 'owner_1', name: 'Owner One' }
        });
        assert.equal(bootstrap.status, 200);
        assert.equal(bootstrap.data.ok, true);
        assert.equal(bootstrap.data.bootstrapped, true);
        assert.equal(opsStorage.getRole({ workspace: 'default', user: 'owner_1' }), 'owner');

        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'viewer' });
        const setViewerOperator = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator',
          body: { workspace: 'default', id: 'local-user', name: 'Local Viewer' }
        });
        assert.equal(setViewerOperator.status, 200);
        assert.equal(setViewerOperator.data.ok, true);

        const clearOperator = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator/clear',
          body: { workspace: 'default' }
        });
        assert.equal(clearOperator.status, 400);
        assert.equal(clearOperator.data.ok, false);
        assert.equal(String(clearOperator.data.error || '').includes('Permission denied'), true);

        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'owner' });
        const clearByOwner = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator/clear',
          body: { workspace: 'default' }
        });
        assert.equal(clearByOwner.status, 200);
        assert.equal(clearByOwner.data.ok, true);

        const setByOwner = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator',
          body: { workspace: 'default', id: 'owner_2', name: 'Owner Two' }
        });
        assert.equal(setByOwner.status, 200);
        assert.equal(setByOwner.data.ok, true);
        assert.equal(setByOwner.data.bootstrapped, false);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        process.env.SOCIAL_CLI_HOME = oldSocialHome;
        if (oldSocialUser === undefined) delete process.env.SOCIAL_USER;
        else process.env.SOCIAL_USER = oldSocialUser;
        if (typeof config.setOperator === 'function') {
          config.setOperator({
            id: String(oldOperator.id || ''),
            name: String(oldOperator.name || '')
          });
        }
      }
    }
  },
  {
    name: 'gateway websocket upgrade enforces api key and session isolation',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        apiKey: 'ws-secret',
        requireApiKey: true
      });
      try {
        await server.start();

        const denied = await new Promise((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?sessionId=s-denied`);
          let opened = false;
          ws.once('open', () => {
            opened = true;
            ws.close();
          });
          ws.once('close', () => resolve(!opened));
          ws.once('error', () => {});
          setTimeout(() => resolve(!opened), 1200);
        });
        assert.equal(denied, true);

        const ws = await connectWs(`ws://127.0.0.1:${server.port}/ws?sessionId=s-1&gatewayKey=ws-secret`);
        ws.close();

        const ws1 = await connectWs(`ws://127.0.0.1:${server.port}/ws?sessionId=s-1&gatewayKey=ws-secret`);
        const ws2 = await connectWs(`ws://127.0.0.1:${server.port}/ws?sessionId=s-2&gatewayKey=ws-secret`);
        const messages1 = [];
        const messages2 = [];
        ws1.on('message', (buf) => {
          try {
            messages1.push(JSON.parse(String(buf)));
          } catch {
            // ignore malformed test payloads
          }
        });
        ws2.on('message', (buf) => {
          try {
            messages2.push(JSON.parse(String(buf)));
          } catch {
            // ignore malformed test payloads
          }
        });
        await wait(120);
        messages1.length = 0;
        messages2.length = 0;

        const chatRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          headers: { 'X-Gateway-Key': 'ws-secret' },
          body: { sessionId: 's-1', message: 'hello' }
        });
        assert.equal(chatRes.status, 200);
        assert.equal(chatRes.data.ok, true);
        await wait(300);

        assert.equal(messages1.some((x) => x.sessionId === 's-1' && x.type === 'output'), true);
        assert.equal(messages2.some((x) => x.sessionId === 's-1'), false);

        ws1.close();
        ws2.close();
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
      const oldKeys = snapshotAiKeyEnv();
      const oldAgent = snapshotAgentConfig();
      clearAiKeyEnv();
      clearAgentApiConfig();

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
        assert.equal(String(msgRes.data.response.message || '').toLowerCase().includes('valid api key'), true);
        assert.equal(Array.isArray(msgRes.data.timeline), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        restoreAgentConfig(oldAgent);
        restoreAiKeyEnv(oldKeys);
      }
    }
  },
  {
    name: 'gateway chat deterministic command executes immediately without pending confirmation',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldKeys = snapshotAiKeyEnv();
      process.env.OPENAI_API_KEY = 'test-gateway-key';
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
        assert.equal(Array.isArray(msgRes.data.timeline), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        restoreAiKeyEnv(oldKeys);
      }
    }
  },
  {
    name: 'gateway session replay endpoint returns timeline',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldKeys = snapshotAiKeyEnv();
      const oldAgent = snapshotAgentConfig();
      clearAiKeyEnv();
      clearAgentApiConfig();

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const startRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/start',
          body: {}
        });
        const sid = startRes.data.sessionId;
        await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: { sessionId: sid, message: 'hello' }
        });
        const replay = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: `/api/sessions/${sid}/replay?limit=30`
        });
        assert.equal(replay.status, 200);
        assert.equal(replay.data.ok, true);
        assert.equal(replay.data.sessionId, sid);
        assert.equal(Array.isArray(replay.data.timeline), true);
        assert.equal(replay.data.timeline.length > 0, true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        restoreAgentConfig(oldAgent);
        restoreAiKeyEnv(oldKeys);
      }
    }
  },
  {
    name: 'gateway chat requires API key before ambiguous intent fallback',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldKeys = snapshotAiKeyEnv();
      const oldAgent = snapshotAgentConfig();
      clearAiKeyEnv();
      clearAgentApiConfig();

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

        const first = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: {
            sessionId: startRes.data.sessionId,
            message: 'totally unknown request text'
          }
        });
        assert.equal(first.status, 200);
        assert.equal(first.data.ok, true);
        assert.equal(Array.isArray(first.data.response?.actions), true);
        assert.equal(first.data.response.actions.length, 0);
        assert.equal(String(first.data.response?.message || '').toLowerCase().includes('valid api key'), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        restoreAgentConfig(oldAgent);
        restoreAiKeyEnv(oldKeys);
      }
    }
  },
  {
    name: 'gateway ops endpoints support summary, guard policy, runs, lists, and resolution',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const oldSocialHome = process.env.SOCIAL_CLI_HOME;
      const oldSocialUser = process.env.SOCIAL_USER;
      const oldOperator = typeof config.getOperator === 'function'
        ? config.getOperator()
        : { id: '', name: '' };
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.META_CLI_HOME = tempHome;
      process.env.SOCIAL_CLI_HOME = tempHome;
      process.env.SOCIAL_USER = 'local-user';

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        if (typeof config.setOperator === 'function') {
          config.setOperator({ id: 'local-user', name: 'Local User' });
        }
        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'owner' });

        const summary1 = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/summary?workspace=default'
        });
        assert.equal(summary1.status, 200);
        assert.equal(summary1.data.ok, true);
        assert.equal(typeof summary1.data.summary.alertsOpen, 'number');
        assert.equal(typeof summary1.data.summary.guardPolicy.mode, 'string');

        const readiness1 = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/readiness?workspace=default'
        });
        assert.equal(readiness1.status, 200);
        assert.equal(readiness1.data.ok, true);
        assert.equal(Array.isArray(readiness1.data.report.checks), true);

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

        const onboardWorkspace = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/onboard/workspace',
          body: { workspace: 'default' }
        });
        assert.equal(onboardWorkspace.status, 200);
        assert.equal(onboardWorkspace.data.ok, true);
        assert.equal(Boolean(onboardWorkspace.data.schedule), true);

        const onboardingComplete = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/onboarding/complete',
          body: { workspace: 'default', completed: true }
        });
        assert.equal(onboardingComplete.status, 200);
        assert.equal(onboardingComplete.data.ok, true);
        assert.equal(Boolean(onboardingComplete.data.state.onboardingCompletedAt), true);

        const weeklyReport = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/report/weekly',
          body: { workspace: 'default', days: 7, outDir: path.join(tempHome, 'reports') }
        });
        assert.equal(weeklyReport.status, 200);
        assert.equal(weeklyReport.data.ok, true);
        assert.equal(fs.existsSync(weeklyReport.data.reportPath), true);

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
        assert.equal(String(fileDownload.raw || '').includes('# Social Flow Agency Handoff - default'), true);

        const outsidePath = path.join(os.tmpdir(), 'gateway-outside-file.txt');
        fs.writeFileSync(outsidePath, 'outside', 'utf8');
        const deniedOutside = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: `/api/ops/handoff/file?workspace=default&path=${encodeURIComponent(outsidePath)}`
        });
        assert.equal(deniedOutside.status, 400);
        assert.equal(deniedOutside.data.ok, false);
        assert.equal(String(deniedOutside.data.error || '').includes('Path not allowed'), true);

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

        const inviteStats = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/invites/stats?workspace=default&days=30'
        });
        assert.equal(inviteStats.status, 200);
        assert.equal(inviteStats.data.ok, true);
        assert.equal(typeof inviteStats.data.stats.active, 'number');
        assert.equal(typeof inviteStats.data.stats.avgAcceptMs, 'number');

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
        if (typeof config.setOperator === 'function') {
          config.setOperator({
            id: String(oldOperator.id || ''),
            name: String(oldOperator.name || '')
          });
        }
      }
    }
  }
];

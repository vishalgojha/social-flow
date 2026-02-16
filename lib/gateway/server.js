const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const packageJson = require('../../package.json');
const config = require('../config');
const { ConversationContext } = require('../chat/context');
const { AutonomousAgent } = require('../chat/agent');
const { PersistentMemory } = require('../chat/memory');

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function maskToken(token) {
  const s = String(token || '');
  if (!s) return '';
  if (s.length <= 10) return '***';
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function configSnapshot() {
  const app = typeof config.getAppCredentials === 'function'
    ? config.getAppCredentials()
    : { appId: '', appSecret: '' };

  return {
    activeProfile: typeof config.getActiveProfile === 'function' ? config.getActiveProfile() : 'default',
    profiles: typeof config.listProfiles === 'function' ? config.listProfiles() : [],
    apiVersion: typeof config.getApiVersion === 'function' ? config.getApiVersion() : '',
    defaultApi: typeof config.getDefaultApi === 'function' ? config.getDefaultApi() : 'facebook',
    tokens: {
      facebook: {
        configured: Boolean(config.getToken('facebook')),
        preview: maskToken(config.getToken('facebook'))
      },
      instagram: {
        configured: Boolean(config.getToken('instagram')),
        preview: maskToken(config.getToken('instagram'))
      },
      whatsapp: {
        configured: Boolean(config.getToken('whatsapp')),
        preview: maskToken(config.getToken('whatsapp'))
      }
    },
    app: {
      appId: app.appId || '',
      appSecretConfigured: Boolean(app.appSecret)
    },
    defaults: {
      facebookPageId: typeof config.getDefaultFacebookPageId === 'function' ? config.getDefaultFacebookPageId() : '',
      igUserId: typeof config.getDefaultIgUserId === 'function' ? config.getDefaultIgUserId() : '',
      whatsappPhoneNumberId: typeof config.getDefaultWhatsAppPhoneNumberId === 'function' ? config.getDefaultWhatsAppPhoneNumberId() : '',
      marketingAdAccountId: typeof config.getDefaultMarketingAdAccountId === 'function' ? config.getDefaultMarketingAdAccountId() : ''
    }
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
      const size = chunks.reduce((n, b) => n + b.length, 0);
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large.'));
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
  });
}

class ChatRuntime {
  constructor(sessionId, options = {}) {
    this.options = options;
    this.memory = new PersistentMemory(sessionId);
    this.context = new ConversationContext();
    this.agent = new AutonomousAgent({
      context: this.context,
      config,
      options: { debug: Boolean(options.debug) }
    });
    this.resumed = false;
  }

  async load() {
    if (!this.memory.exists()) return;
    const saved = this.memory.load();
    if (!saved?.context) return;
    this.context = new ConversationContext(saved.context);
    this.agent = new AutonomousAgent({
      context: this.context,
      config,
      options: { debug: Boolean(this.options.debug) }
    });
    this.resumed = true;
  }

  async save() {
    this.memory.save({ context: this.context.toJSON() });
  }

  async executeActions(actions) {
    const executed = [];
    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.agent.execute(action);
        this.context.addResult(action, result.raw);
        executed.push({
          tool: action.tool,
          success: true,
          summary: result.summary,
          suggestions: result.suggestions || []
        });
      } catch (error) {
        this.context.addError(action, error);
        const fail = this.agent.failureAdvice(action, error);
        executed.push({
          tool: action.tool,
          success: false,
          error: fail.message || String(error?.message || error || ''),
          suggestions: fail.suggestions || []
        });
      }
    }
    return executed;
  }

  async processMessage(message) {
    const response = await this.agent.process(message);
    let executed = [];
    if (response.actions?.length && !response.needsInput) {
      executed = await this.executeActions(response.actions);
    }
    await this.save();
    return {
      sessionId: this.memory.id,
      resumed: this.resumed,
      response,
      executed,
      pendingActions: this.context.pendingActions || [],
      summary: this.context.getSummary(),
      history: this.context.getHistory(40)
    };
  }
}

class GatewayServer {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    const requestedPort = options.port !== undefined ? Number(options.port) : 1310;
    this.port = Number.isFinite(requestedPort) ? requestedPort : 1310;
    this.debug = Boolean(options.debug);
    this.server = null;
    this.runtimes = new Map();
    this.webRoot = path.resolve(__dirname, '..', '..', 'web', 'studio');
  }

  runtime(sessionId) {
    const key = String(sessionId || '').trim();
    if (!key) return null;
    return this.runtimes.get(key) || null;
  }

  async getOrCreateRuntime(sessionId) {
    const existing = this.runtime(sessionId);
    if (existing) return existing;
    const runtime = new ChatRuntime(sessionId, { debug: this.debug });
    await runtime.load();
    this.runtimes.set(runtime.memory.id, runtime);
    return runtime;
  }

  async handleApi(req, res, parsedUrl) {
    const route = parsedUrl.pathname || '/';

    if (req.method === 'GET' && route === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'social-api-gateway',
        version: packageJson.version,
        now: new Date().toISOString()
      });
      return;
    }

    if (req.method === 'GET' && route === '/api/sessions') {
      sendJson(res, 200, {
        sessions: PersistentMemory.list(50)
      });
      return;
    }

    if (req.method === 'GET' && route === '/api/config') {
      sendJson(res, 200, {
        config: configSnapshot(),
        now: new Date().toISOString()
      });
      return;
    }

    if (req.method === 'POST' && route === '/api/chat/start') {
      try {
        const body = await readBody(req);
        const runtime = await this.getOrCreateRuntime(body.sessionId);
        await runtime.save();
        sendJson(res, 200, {
          sessionId: runtime.memory.id,
          resumed: runtime.resumed,
          summary: runtime.context.getSummary(),
          history: runtime.context.getHistory(30)
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/chat/message') {
      try {
        const body = await readBody(req);
        const msg = String(body.message || '').trim();
        if (!msg) {
          sendJson(res, 400, { ok: false, error: 'Missing message.' });
          return;
        }
        const runtime = await this.getOrCreateRuntime(body.sessionId);
        const result = await runtime.processMessage(msg);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Route not found.' });
  }

  async handleStatic(req, res, parsedUrl) {
    const requested = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
    const safe = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.resolve(this.webRoot, `.${safe}`);
    if (!fullPath.startsWith(this.webRoot)) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      sendText(res, 404, 'Not found');
      return;
    }

    const buffer = fs.readFileSync(fullPath);
    res.writeHead(200, { 'Content-Type': mimeFor(fullPath), 'Cache-Control': 'no-store' });
    res.end(buffer);
  }

  async requestHandler(req, res) {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    if (parsedUrl.pathname.startsWith('/api/')) {
      await this.handleApi(req, res, parsedUrl);
      return;
    }
    await this.handleStatic(req, res, parsedUrl);
  }

  async start() {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      this.requestHandler(req, res).catch((error) => {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => resolve());
    });
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.port;
    this.port = port;
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(() => resolve()));
    this.server = null;
  }

  url() {
    return `http://${this.host}:${this.port}`;
  }
}

function createGatewayServer(options = {}) {
  return new GatewayServer(options);
}

module.exports = {
  createGatewayServer,
  GatewayServer
};

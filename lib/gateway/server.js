const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const packageJson = require('../../package.json');
const config = require('../config');
const { ConversationContext } = require('../chat/context');
const { AutonomousAgent } = require('../chat/agent');
const { PersistentMemory } = require('../chat/memory');
const opsStorage = require('../ops/storage');
const opsWorkflows = require('../ops/workflows');
const opsRbac = require('../ops/rbac');

const GUARD_MODES = new Set(['observe', 'approval', 'auto_safe']);
const SOURCE_CONNECTORS = new Set(
  Array.isArray(opsStorage.SOURCE_CONNECTORS)
    ? opsStorage.SOURCE_CONNECTORS
    : [...(opsStorage.SOURCE_CONNECTORS || [])]
);
const API_PUBLIC_ROUTES = new Set(['/api/health']);
const DEFAULT_CORS_HEADERS = 'Content-Type, X-Gateway-Key, X-Session-Id, Authorization';
const DEFAULT_CORS_METHODS = 'GET,POST,OPTIONS';

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

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function csvList(v) {
  return String(v || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeIp(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length);
  return raw;
}

function isLoopbackIp(v) {
  const ip = normalizeIp(v);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function isLoopbackHost(v) {
  const host = String(v || '').trim().toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function normalizeGuardMode(v) {
  const mode = String(v || '').trim().toLowerCase();
  if (GUARD_MODES.has(mode)) return mode;
  return '';
}

function normalizeConnector(v) {
  const connector = String(v || '').trim().toLowerCase();
  if (!connector) return '';
  if (SOURCE_CONNECTORS.size && SOURCE_CONNECTORS.has(connector)) return connector;
  return 'custom';
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function guardPolicyPatchFromBody(body) {
  if (!isPlainObject(body)) return {};
  const patch = {};
  if (body.enabled !== undefined) patch.enabled = toBool(body.enabled, true);
  if (body.mode !== undefined) {
    const mode = normalizeGuardMode(body.mode);
    if (!mode) throw new Error('Invalid guard mode. Use observe, approval, or auto_safe.');
    patch.mode = mode;
  }
  if (body.cooldownMinutes !== undefined) patch.cooldownMinutes = toNumber(body.cooldownMinutes, 60);

  if (isPlainObject(body.thresholds)) {
    patch.thresholds = {};
    if (body.thresholds.spendSpikePct !== undefined) patch.thresholds.spendSpikePct = toNumber(body.thresholds.spendSpikePct, 35);
    if (body.thresholds.cpaSpikePct !== undefined) patch.thresholds.cpaSpikePct = toNumber(body.thresholds.cpaSpikePct, 30);
    if (body.thresholds.roasDropPct !== undefined) patch.thresholds.roasDropPct = toNumber(body.thresholds.roasDropPct, 20);
  }

  if (isPlainObject(body.limits)) {
    patch.limits = {};
    if (body.limits.maxBudgetAdjustmentPct !== undefined) patch.limits.maxBudgetAdjustmentPct = toNumber(body.limits.maxBudgetAdjustmentPct, 20);
    if (body.limits.maxCampaignsPerRun !== undefined) patch.limits.maxCampaignsPerRun = toNumber(body.limits.maxCampaignsPerRun, 5);
    if (body.limits.maxDailyAutoActions !== undefined) patch.limits.maxDailyAutoActions = toNumber(body.limits.maxDailyAutoActions, 10);
    if (body.limits.requireApprovalForPause !== undefined) patch.limits.requireApprovalForPause = toBool(body.limits.requireApprovalForPause, true);
  }

  return patch;
}

function sourcePatchFromBody(body) {
  if (!isPlainObject(body)) return {};
  const patch = {};
  if (body.id !== undefined) patch.id = String(body.id || '').trim();
  if (body.name !== undefined) patch.name = String(body.name || '').trim();
  if (body.connector !== undefined) patch.connector = normalizeConnector(body.connector);
  if (body.syncMode !== undefined) patch.syncMode = String(body.syncMode || '').trim().toLowerCase();
  if (body.enabled !== undefined) patch.enabled = toBool(body.enabled, true);
  if (isPlainObject(body.config)) patch.config = body.config;
  return patch;
}

function opsSummary(workspace) {
  const ws = opsStorage.ensureWorkspace(workspace || config.getActiveProfile() || 'default');
  const alerts = opsStorage.listAlerts(ws);
  const approvals = opsStorage.listApprovals(ws);
  const leads = opsStorage.listLeads(ws);
  const schedules = opsStorage.listSchedules(ws);
  const sources = opsStorage.listSources(ws);
  const outcomes = opsStorage.listOutcomes(ws);
  const state = opsStorage.getState(ws);
  const policy = opsStorage.getPolicy(ws);
  const guardPolicy = opsStorage.getGuardPolicy(ws);
  const role = opsRbac.roleFor({ workspace: ws });

  const openAlerts = alerts.filter((a) => a.status === 'open');
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const leadsDue = leads.filter((l) => l.status === 'no_reply_3d' || l.status === 'followup_due');
  const dueSchedules = opsStorage.listDueSchedules(ws);
  const enabledSources = sources.filter((x) => x.enabled !== false);
  const readySources = enabledSources.filter((x) => x.status === 'ready');

  return {
    workspace: ws,
    summary: {
      role,
      alertsOpen: openAlerts.length,
      approvalsPending: pendingApprovals.length,
      leadsDue: leadsDue.length,
      schedulesDue: dueSchedules.length,
      sourcesConfigured: enabledSources.length,
      sourcesReady: readySources.length,
      lastMorningRunDate: state.lastMorningRunDate || '',
      policy,
      guardPolicy
    },
    alerts: openAlerts.slice(0, 20),
    approvals: pendingApprovals.slice(0, 20),
    schedules: schedules.slice(0, 20),
    sources: sources.slice(0, 40),
    outcomes: outcomes.slice(-20).reverse(),
    leadsDue: leadsDue.slice(0, 20)
  };
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
    this.apiKey = String(
      options.apiKey !== undefined
        ? options.apiKey
        : (process.env.SOCIAL_GATEWAY_API_KEY || process.env.META_GATEWAY_API_KEY || '')
    ).trim();
    this.requireApiKey = toBool(
      options.requireApiKey !== undefined
        ? options.requireApiKey
        : process.env.SOCIAL_GATEWAY_REQUIRE_API_KEY,
      false
    );
    const rawCors = options.corsOrigins !== undefined
      ? options.corsOrigins
      : (process.env.SOCIAL_GATEWAY_CORS_ORIGINS || process.env.META_GATEWAY_CORS_ORIGINS || '');
    const corsList = Array.isArray(rawCors) ? rawCors : csvList(rawCors);
    this.corsOrigins = new Set(corsList.map((x) => String(x || '').trim()).filter(Boolean));
    this.rateLimitWindowMs = Math.max(1000, toNumber(
      options.rateLimitWindowMs !== undefined
        ? options.rateLimitWindowMs
        : process.env.SOCIAL_GATEWAY_RATE_WINDOW_MS,
      60 * 1000
    ));
    this.rateLimitMax = Math.max(1, toNumber(
      options.rateLimitMax !== undefined
        ? options.rateLimitMax
        : process.env.SOCIAL_GATEWAY_RATE_MAX,
      180
    ));
    this.rateBuckets = new Map();
    this.server = null;
    this.runtimes = new Map();
    this.webRoot = path.resolve(__dirname, '..', '..', 'web', 'studio');
  }

  routeIsPublicApi(route) {
    return API_PUBLIC_ROUTES.has(route);
  }

  isApiRoute(route) {
    return String(route || '').startsWith('/api/');
  }

  clientIp(req) {
    return normalizeIp(req?.socket?.remoteAddress || '');
  }

  isLocalClient(req) {
    return isLoopbackIp(this.clientIp(req));
  }

  isLocalBind() {
    return isLoopbackHost(this.host);
  }

  defaultCorsOrigins() {
    return new Set([
      `http://127.0.0.1:${this.port}`,
      `http://localhost:${this.port}`
    ]);
  }

  isAllowedOrigin(origin) {
    const candidate = String(origin || '').trim();
    if (!candidate) return true;
    const allowed = this.corsOrigins.size > 0
      ? this.corsOrigins
      : (this.isLocalBind() ? this.defaultCorsOrigins() : new Set());
    return allowed.has(candidate);
  }

  applyCors(req, res, parsedUrl) {
    const route = parsedUrl.pathname || '/';
    if (!this.isApiRoute(route)) return true;

    const origin = String(req.headers.origin || '').trim();
    if (origin) {
      if (!this.isAllowedOrigin(origin)) {
        sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
        return false;
      }
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', DEFAULT_CORS_HEADERS);
      res.setHeader('Access-Control-Allow-Methods', DEFAULT_CORS_METHODS);
      res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return false;
    }
    return true;
  }

  providedGatewayKey(req) {
    const keyHeader = String(req.headers['x-gateway-key'] || '').trim();
    if (keyHeader) return keyHeader;
    const auth = String(req.headers.authorization || '').trim();
    if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
    return '';
  }

  authorizeApi(req, res, route) {
    if (!this.isApiRoute(route) || this.routeIsPublicApi(route)) return true;

    const isLocalRequest = this.isLocalClient(req);
    const provided = this.providedGatewayKey(req);

    if (!this.apiKey) {
      if (!this.requireApiKey && this.isLocalBind() && isLocalRequest) return true;
      if (!isLocalRequest || !this.isLocalBind()) {
        sendJson(res, 503, {
          ok: false,
          error: 'Gateway API key is required for non-local access. Set SOCIAL_GATEWAY_API_KEY.'
        });
        return false;
      }
      sendJson(res, 503, {
        ok: false,
        error: 'Gateway API key required. Set SOCIAL_GATEWAY_API_KEY.'
      });
      return false;
    }

    if (provided && provided !== this.apiKey) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized. Invalid x-gateway-key.' });
      return false;
    }

    if (this.requireApiKey || !isLocalRequest || !this.isLocalBind()) {
      if (provided !== this.apiKey) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized. Provide x-gateway-key.' });
        return false;
      }
    }

    return true;
  }

  shouldRateLimit(req, route) {
    if (!this.isApiRoute(route)) return false;
    if (this.routeIsPublicApi(route)) return false;
    if (req.method === 'OPTIONS') return false;
    return true;
  }

  rateLimitKey(req, parsedUrl) {
    const route = parsedUrl.pathname || '/';
    const sessionHint = String(
      req.headers['x-session-id'] ||
      parsedUrl.searchParams.get('sessionId') ||
      ''
    ).trim();
    return `${this.clientIp(req) || 'unknown'}|${sessionHint || '-'}|${route}`;
  }

  cleanupRateBuckets(now) {
    if (this.rateBuckets.size < 5000) return;
    for (const [k, b] of this.rateBuckets.entries()) {
      if (!b || b.resetAt <= now) this.rateBuckets.delete(k);
    }
  }

  enforceRateLimit(req, res, parsedUrl) {
    const route = parsedUrl.pathname || '/';
    if (!this.shouldRateLimit(req, route)) return true;

    const now = Date.now();
    this.cleanupRateBuckets(now);
    const key = this.rateLimitKey(req, parsedUrl);
    const existing = this.rateBuckets.get(key);
    const bucket = (!existing || existing.resetAt <= now)
      ? { count: 0, resetAt: now + this.rateLimitWindowMs }
      : existing;

    if (bucket.count >= this.rateLimitMax) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(this.rateLimitMax));
      res.setHeader('X-RateLimit-Remaining', '0');
      sendJson(res, 429, { ok: false, error: 'Rate limit exceeded. Slow down and retry shortly.' });
      return false;
    }

    bucket.count += 1;
    this.rateBuckets.set(key, bucket);
    res.setHeader('X-RateLimit-Limit', String(this.rateLimitMax));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, this.rateLimitMax - bucket.count)));
    return true;
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

    if (req.method === 'GET' && route === '/api/ops/summary') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || '';
        sendJson(res, 200, {
          ok: true,
          ...opsSummary(workspace)
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/alerts') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const onlyOpen = toBool(parsedUrl.searchParams.get('open'), false);
        let alerts = opsStorage.listAlerts(workspace);
        if (onlyOpen) alerts = alerts.filter((x) => x.status === 'open');
        sendJson(res, 200, { ok: true, workspace, alerts });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/approvals') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const onlyOpen = toBool(parsedUrl.searchParams.get('open'), false);
        let approvals = opsStorage.listApprovals(workspace);
        if (onlyOpen) approvals = approvals.filter((x) => x.status === 'pending');
        sendJson(res, 200, { ok: true, workspace, approvals });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/guard/policy') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const guardPolicy = opsStorage.getGuardPolicy(workspace);
        sendJson(res, 200, { ok: true, workspace, guardPolicy });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/guard/policy') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const patch = guardPolicyPatchFromBody(body);
        const guardPolicy = opsStorage.setGuardPolicy(workspace, patch);
        sendJson(res, 200, {
          ok: true,
          workspace,
          guardPolicy,
          snapshot: opsSummary(workspace)
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/guard/mode') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const mode = normalizeGuardMode(body.mode);
        if (!mode) {
          sendJson(res, 400, { ok: false, error: 'Invalid guard mode. Use observe, approval, or auto_safe.' });
          return;
        }
        const guardPolicy = opsStorage.setGuardPolicy(workspace, { mode });
        sendJson(res, 200, {
          ok: true,
          workspace,
          mode: guardPolicy.mode,
          guardPolicy,
          snapshot: opsSummary(workspace)
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/morning-run') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const spend = toNumber(body.spend, 0);
        const force = toBool(body.force, false);
        const result = opsWorkflows.runMorningOps({
          workspace,
          config,
          spend,
          force
        });
        sendJson(res, 200, { ok: true, result, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/schedule/run-due') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const result = opsWorkflows.runDueSchedules({ workspace, config });
        sendJson(res, 200, { ok: true, result, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/alerts/ack') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const id = String(body.id || '').trim();
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'Missing alert id.' });
          return;
        }
        const alert = opsStorage.ackAlert(workspace, id);
        sendJson(res, 200, { ok: true, alert, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/approvals/resolve') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const id = String(body.id || '').trim();
        const decision = String(body.decision || '').trim().toLowerCase();
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'Missing approval id.' });
          return;
        }
        if (decision !== 'approve' && decision !== 'reject') {
          sendJson(res, 400, { ok: false, error: 'Decision must be "approve" or "reject".' });
          return;
        }
        const approval = opsWorkflows.resolveApproval({
          workspace,
          approvalId: id,
          decision,
          note: body.note || ''
        });
        sendJson(res, 200, { ok: true, approval, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/sources') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const sources = opsStorage.listSources(workspace);
        sendJson(res, 200, { ok: true, workspace, sources });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/sources/upsert') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const patch = sourcePatchFromBody(body);
        if (!patch.name) {
          sendJson(res, 400, { ok: false, error: 'Source name is required.' });
          return;
        }
        if (!patch.connector) {
          sendJson(res, 400, { ok: false, error: 'Connector is required.' });
          return;
        }
        const source = opsStorage.upsertSource(workspace, patch);
        sendJson(res, 200, { ok: true, workspace, source, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/sources/sync') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        let sourceIds = [];
        if (Array.isArray(body.sourceIds)) {
          sourceIds = body.sourceIds.map((x) => String(x || '').trim()).filter(Boolean);
        } else if (body.id !== undefined) {
          const one = String(body.id || '').trim();
          if (one) sourceIds = [one];
        }
        const result = opsWorkflows.syncSources({
          workspace,
          sourceIds: sourceIds.length ? sourceIds : null,
          config
        });
        sendJson(res, 200, { ok: true, workspace, result, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
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
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (parsedUrl.pathname.startsWith('/api/')) {
      const route = parsedUrl.pathname || '/';
      if (!this.applyCors(req, res, parsedUrl)) return;
      if (!this.authorizeApi(req, res, route)) return;
      if (!this.enforceRateLimit(req, res, parsedUrl)) return;
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

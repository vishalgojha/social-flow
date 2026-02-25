const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const configSingleton = require('../config');

const DEFAULT_POLICY = {
  spendThreshold: 200,
  autoApproveLowRisk: false,
  followupAfterDays: 3,
  requireApprovalForCampaignPause: true,
  requireApprovalForBulkWhatsApp: true
};
const DEFAULT_GUARD_POLICY = {
  enabled: true,
  mode: 'approval',
  thresholds: {
    spendSpikePct: 35,
    cpaSpikePct: 30,
    roasDropPct: 20
  },
  limits: {
    maxBudgetAdjustmentPct: 20,
    maxCampaignsPerRun: 5,
    maxDailyAutoActions: 10,
    requireApprovalForPause: true
  },
  cooldownMinutes: 60
};

const DEFAULT_STATE = {
  lastMorningRunDate: '',
  runHistory: [],
  onboardingCompletedAt: ''
};
const DEFAULT_INTEGRATIONS = {
  slackWebhook: '',
  outboundWebhook: ''
};
const SOURCE_CONNECTORS = new Set([
  'facebook_ads',
  'instagram_insights',
  'whatsapp_events',
  'marketing_campaigns',
  'slack_channels',
  'csv_upload',
  'webhook',
  'custom'
]);
const SOURCE_SYNC_MODES = new Set(['manual', 'scheduled']);
const SOURCE_STATUSES = new Set(['idle', 'syncing', 'ready', 'error', 'disabled']);
const ROLE_SET = new Set(['viewer', 'operator', 'admin', 'owner']);
const WORKSPACE_TEMPLATES = {
  agency_default: {
    id: 'agency_default',
    notes: 'Baseline agency workspace with approvals enabled.',
    policy: {
      spendThreshold: 200,
      autoApproveLowRisk: false,
      followupAfterDays: 3,
      requireApprovalForCampaignPause: true,
      requireApprovalForBulkWhatsApp: true
    },
    guardPolicy: {
      mode: 'approval',
      limits: { maxDailyAutoActions: 10 }
    }
  },
  growth: {
    id: 'growth',
    notes: 'Faster growth template with tighter anomaly thresholds.',
    policy: {
      spendThreshold: 300,
      autoApproveLowRisk: false,
      followupAfterDays: 2
    },
    guardPolicy: {
      mode: 'approval',
      thresholds: { spendSpikePct: 25, cpaSpikePct: 20, roasDropPct: 15 },
      limits: { maxDailyAutoActions: 8 }
    }
  },
  enterprise: {
    id: 'enterprise',
    notes: 'Enterprise template prioritizing strict guardrails.',
    policy: {
      spendThreshold: 150,
      autoApproveLowRisk: false,
      followupAfterDays: 2,
      requireApprovalForCampaignPause: true,
      requireApprovalForBulkWhatsApp: true
    },
    guardPolicy: {
      mode: 'approval',
      thresholds: { spendSpikePct: 20, cpaSpikePct: 15, roasDropPct: 10 },
      limits: { maxBudgetAdjustmentPct: 10, maxCampaignsPerRun: 3, maxDailyAutoActions: 5, requireApprovalForPause: true },
      cooldownMinutes: 120
    }
  }
};
const ROLE_PRESETS = {
  core: ['owner', 'admin', 'operator', 'viewer'],
  lean: ['owner', 'operator', 'viewer']
};
let cachedOpsRoot = '';
let cachedOpsHome = '';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function homeRoot() {
  if (process.env.SOCIAL_CLI_HOME) return path.resolve(process.env.SOCIAL_CLI_HOME);
  if (process.env.META_CLI_HOME) return path.resolve(process.env.META_CLI_HOME);
  return os.homedir();
}

function sanitizeWorkspace(name) {
  if (typeof configSingleton?.sanitizeProfileName === 'function') {
    return configSingleton.sanitizeProfileName(name);
  }
  const raw = String(name || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'default';
}

function opsRoot() {
  const home = homeRoot();
  if (cachedOpsRoot && cachedOpsHome === home) return cachedOpsRoot;
  const candidates = [
    path.join(home, '.social-cli', 'ops'),
    path.join(home, '.meta-cli', 'ops'),
    path.join(process.cwd(), '.social-cli-ops')
  ];

  // Pick first writable location.
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    try {
      ensureDir(candidate);
      cachedOpsRoot = candidate;
      cachedOpsHome = home;
      return cachedOpsRoot;
    } catch {
      // try next
    }
  }

  throw new Error('Unable to initialize ops storage directory.');
}

function resetCacheForTests() {
  cachedOpsRoot = '';
  cachedOpsHome = '';
}

function workspaceDir(workspace) {
  return path.join(opsRoot(), sanitizeWorkspace(workspace));
}

function rolesPath() {
  return path.join(opsRoot(), 'roles.json');
}

function invitesPath() {
  return path.join(opsRoot(), 'invites.json');
}

function filePath(workspace, key) {
  return path.join(workspaceDir(workspace), `${key}.json`);
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function mergeObject(base, patch) {
  const source = isPlainObject(base) ? base : {};
  const next = { ...source };
  if (!isPlainObject(patch)) return next;
  Object.keys(patch).forEach((k) => {
    if (isPlainObject(source[k]) && isPlainObject(patch[k])) {
      next[k] = mergeObject(source[k], patch[k]);
      return;
    }
    next[k] = patch[k];
  });
  return next;
}

function normalizeSourceConnector(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (SOURCE_CONNECTORS.has(raw)) return raw;
  return 'custom';
}

function normalizeSourceSyncMode(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (SOURCE_SYNC_MODES.has(raw)) return raw;
  return 'manual';
}

function normalizeSourceStatus(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (SOURCE_STATUSES.has(raw)) return raw;
  return 'idle';
}

function normalizeCount(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function buildSourceRecord(input, existing = null) {
  const now = new Date().toISOString();
  const current = isPlainObject(existing) ? existing : {};
  const connector = normalizeSourceConnector(
    input?.connector !== undefined ? input.connector : current.connector
  );
  const id = current.id || genId('source');
  const name = String(
    input?.name !== undefined ? input.name : current.name || ''
  ).trim() || `${connector} source`;
  const enabled = input?.enabled !== undefined ? input.enabled !== false : current.enabled !== false;
  const syncMode = normalizeSourceSyncMode(
    input?.syncMode !== undefined ? input.syncMode : current.syncMode
  );
  const status = normalizeSourceStatus(
    input?.status !== undefined ? input.status : current.status
  );
  const lastSyncAt = input?.lastSyncAt !== undefined
    ? (input.lastSyncAt ? String(input.lastSyncAt) : null)
    : (current.lastSyncAt || null);
  const lastSyncStatus = String(
    input?.lastSyncStatus !== undefined ? input.lastSyncStatus : current.lastSyncStatus || ''
  ).trim();
  const lastError = String(
    input?.lastError !== undefined ? input.lastError : current.lastError || ''
  ).trim();
  const itemCount = normalizeCount(
    input?.itemCount !== undefined ? input.itemCount : current.itemCount,
    0
  );
  const config = isPlainObject(input?.config)
    ? input.config
    : (isPlainObject(current.config) ? current.config : {});

  return {
    id,
    name,
    connector,
    enabled,
    syncMode,
    status,
    itemCount,
    lastSyncAt,
    lastSyncStatus,
    lastError,
    config,
    createdAt: current.createdAt || now,
    updatedAt: now
  };
}

function ensureWorkspace(workspace) {
  const ws = sanitizeWorkspace(workspace);
  const dir = workspaceDir(ws);
  ensureDir(dir);

  const defaults = {
    leads: [],
    alerts: [],
    approvals: [],
    outcomes: [],
    schedules: [],
    sources: [],
    policy: DEFAULT_POLICY,
    guardPolicy: DEFAULT_GUARD_POLICY,
    state: DEFAULT_STATE,
    integrations: DEFAULT_INTEGRATIONS,
    incidents: [],
    actionLog: [],
    rollbackSnapshots: []
  };

  Object.keys(defaults).forEach((k) => {
    const f = filePath(ws, k);
    if (!fs.existsSync(f)) writeJsonAtomic(f, defaults[k]);
  });

  return ws;
}

function listLeads(workspace) {
  ensureWorkspace(workspace);
  return readJson(filePath(workspace, 'leads'), []);
}

function addLead(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const leads = listLeads(ws);
  const now = new Date().toISOString();
  const lead = {
    id: genId('lead'),
    name: String(input?.name || '').trim(),
    phone: String(input?.phone || '').trim(),
    status: String(input?.status || 'new').trim(),
    tags: Array.isArray(input?.tags) ? input.tags : [],
    note: String(input?.note || ''),
    lastContactAt: input?.lastContactAt || null,
    createdAt: now,
    updatedAt: now
  };
  leads.push(lead);
  writeJsonAtomic(filePath(ws, 'leads'), leads);
  return lead;
}

function updateLead(workspace, leadId, patch) {
  const ws = ensureWorkspace(workspace);
  const leads = listLeads(ws);
  const idx = leads.findIndex((x) => x.id === leadId);
  if (idx < 0) throw new Error(`Lead not found: ${leadId}`);
  const now = new Date().toISOString();
  const next = {
    ...leads[idx],
    ...patch,
    updatedAt: now
  };
  leads[idx] = next;
  writeJsonAtomic(filePath(ws, 'leads'), leads);
  return next;
}

function listAlerts(workspace) {
  ensureWorkspace(workspace);
  return readJson(filePath(workspace, 'alerts'), []);
}

function addAlert(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const alerts = listAlerts(ws);
  const dedupeKey = String(input?.dedupeKey || '').trim();
  if (dedupeKey) {
    const existing = alerts.find((a) => a.status === 'open' && a.dedupeKey === dedupeKey);
    if (existing) return existing;
  }
  const alert = {
    id: genId('alert'),
    type: String(input?.type || 'generic'),
    severity: String(input?.severity || 'low'),
    message: String(input?.message || ''),
    meta: input?.meta && typeof input.meta === 'object' ? input.meta : {},
    status: 'open',
    dedupeKey: dedupeKey || null,
    createdAt: new Date().toISOString(),
    ackAt: null
  };
  alerts.push(alert);
  writeJsonAtomic(filePath(ws, 'alerts'), alerts);
  return alert;
}

function ackAlert(workspace, alertId) {
  const ws = ensureWorkspace(workspace);
  const alerts = listAlerts(ws);
  const idx = alerts.findIndex((a) => a.id === alertId);
  if (idx < 0) throw new Error(`Alert not found: ${alertId}`);
  alerts[idx] = {
    ...alerts[idx],
    status: 'acked',
    ackAt: new Date().toISOString()
  };
  writeJsonAtomic(filePath(ws, 'alerts'), alerts);
  return alerts[idx];
}

function listApprovals(workspace) {
  ensureWorkspace(workspace);
  return readJson(filePath(workspace, 'approvals'), []);
}

function addApproval(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const approvals = listApprovals(ws);
  const approval = {
    id: genId('approval'),
    title: String(input?.title || 'Approval required'),
    reason: String(input?.reason || ''),
    risk: String(input?.risk || 'medium'),
    action: String(input?.action || 'manual'),
    payload: input?.payload && typeof input.payload === 'object' ? input.payload : {},
    requestedBy: String(input?.requestedBy || 'system'),
    status: 'pending',
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    decisionNote: ''
  };
  approvals.push(approval);
  writeJsonAtomic(filePath(ws, 'approvals'), approvals);
  return approval;
}

function resolveApproval(workspace, approvalId, decision) {
  const ws = ensureWorkspace(workspace);
  const approvals = listApprovals(ws);
  const idx = approvals.findIndex((a) => a.id === approvalId);
  if (idx < 0) throw new Error(`Approval not found: ${approvalId}`);
  const current = approvals[idx];
  if (current.status !== 'pending') return current;
  approvals[idx] = {
    ...current,
    status: decision.status,
    decidedAt: new Date().toISOString(),
    decidedBy: decision.user || 'system',
    decisionNote: String(decision.note || '')
  };
  writeJsonAtomic(filePath(ws, 'approvals'), approvals);
  return approvals[idx];
}

function listOutcomes(workspace) {
  ensureWorkspace(workspace);
  return readJson(filePath(workspace, 'outcomes'), []);
}

function appendOutcome(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const outcomes = listOutcomes(ws);
  const out = {
    id: genId('outcome'),
    kind: String(input?.kind || 'run'),
    summary: String(input?.summary || ''),
    metrics: input?.metrics && typeof input.metrics === 'object' ? input.metrics : {},
    metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    createdAt: new Date().toISOString()
  };
  outcomes.push(out);
  writeJsonAtomic(filePath(ws, 'outcomes'), outcomes);
  return out;
}

function listSchedules(workspace) {
  ensureWorkspace(workspace);
  return readJson(filePath(workspace, 'schedules'), []);
}

function addSchedule(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const schedules = listSchedules(ws);
  const item = {
    id: genId('schedule'),
    name: String(input?.name || 'schedule'),
    workflow: String(input?.workflow || 'morning_ops'),
    runAt: String(input?.runAt || new Date().toISOString()),
    repeat: String(input?.repeat || 'none'),
    enabled: input?.enabled !== false,
    payload: input?.payload && typeof input.payload === 'object' ? input.payload : {},
    lastRunAt: null,
    lastRunStatus: '',
    createdAt: new Date().toISOString()
  };
  schedules.push(item);
  writeJsonAtomic(filePath(ws, 'schedules'), schedules);
  return item;
}

function updateSchedule(workspace, scheduleId, patch) {
  const ws = ensureWorkspace(workspace);
  const schedules = listSchedules(ws);
  const idx = schedules.findIndex((x) => x.id === scheduleId);
  if (idx < 0) throw new Error(`Schedule not found: ${scheduleId}`);
  schedules[idx] = { ...schedules[idx], ...patch };
  writeJsonAtomic(filePath(ws, 'schedules'), schedules);
  return schedules[idx];
}

function removeSchedule(workspace, scheduleId) {
  const ws = ensureWorkspace(workspace);
  const schedules = listSchedules(ws);
  const next = schedules.filter((x) => x.id !== scheduleId);
  if (next.length === schedules.length) throw new Error(`Schedule not found: ${scheduleId}`);
  writeJsonAtomic(filePath(ws, 'schedules'), next);
}

function listDueSchedules(workspace, now = new Date()) {
  return listSchedules(workspace)
    .filter((x) => x.enabled)
    .filter((x) => {
      const ts = Date.parse(x.runAt);
      if (Number.isNaN(ts)) return false;
      return ts <= now.getTime();
    });
}

function getPolicy(workspace) {
  ensureWorkspace(workspace);
  const policy = readJson(filePath(workspace, 'policy'), DEFAULT_POLICY);
  return { ...DEFAULT_POLICY, ...(policy || {}) };
}

function listSources(workspace) {
  ensureWorkspace(workspace);
  const rows = readJson(filePath(workspace, 'sources'), []);
  return Array.isArray(rows) ? rows : [];
}

function getSource(workspace, sourceId) {
  const id = String(sourceId || '').trim();
  if (!id) return null;
  const rows = listSources(workspace);
  return rows.find((x) => x.id === id) || null;
}

function addSource(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const rows = listSources(ws);
  const item = buildSourceRecord(input);
  rows.push(item);
  writeJsonAtomic(filePath(ws, 'sources'), rows);
  return item;
}

function updateSource(workspace, sourceId, patch) {
  const ws = ensureWorkspace(workspace);
  const rows = listSources(ws);
  const idx = rows.findIndex((x) => x.id === sourceId);
  if (idx < 0) throw new Error(`Source not found: ${sourceId}`);
  const next = buildSourceRecord(patch, rows[idx]);
  rows[idx] = next;
  writeJsonAtomic(filePath(ws, 'sources'), rows);
  return next;
}

function upsertSource(workspace, input) {
  const id = String(input?.id || '').trim();
  if (!id) return addSource(workspace, input);
  const current = getSource(workspace, id);
  if (!current) {
    return addSource(workspace, { ...(input || {}), id });
  }
  return updateSource(workspace, id, input);
}

function setPolicy(workspace, patch) {
  const ws = ensureWorkspace(workspace);
  const current = getPolicy(ws);
  const next = { ...current, ...(patch || {}) };
  writeJsonAtomic(filePath(ws, 'policy'), next);
  return next;
}

function getGuardPolicy(workspace) {
  ensureWorkspace(workspace);
  const policy = readJson(filePath(workspace, 'guardPolicy'), DEFAULT_GUARD_POLICY);
  return mergeObject(DEFAULT_GUARD_POLICY, policy || {});
}

function setGuardPolicy(workspace, patch) {
  const ws = ensureWorkspace(workspace);
  const current = getGuardPolicy(ws);
  const next = mergeObject(current, patch || {});
  writeJsonAtomic(filePath(ws, 'guardPolicy'), next);
  return next;
}

function getState(workspace) {
  ensureWorkspace(workspace);
  const state = readJson(filePath(workspace, 'state'), DEFAULT_STATE);
  return { ...DEFAULT_STATE, ...(state || {}) };
}

function setState(workspace, patch) {
  const ws = ensureWorkspace(workspace);
  const current = getState(ws);
  const next = { ...current, ...(patch || {}) };
  writeJsonAtomic(filePath(ws, 'state'), next);
  return next;
}

function getIntegrations(workspace) {
  ensureWorkspace(workspace);
  const val = readJson(filePath(workspace, 'integrations'), DEFAULT_INTEGRATIONS);
  return { ...DEFAULT_INTEGRATIONS, ...(val || {}) };
}

function setIntegrations(workspace, patch) {
  const ws = ensureWorkspace(workspace);
  const current = getIntegrations(ws);
  const next = { ...current, ...(patch || {}) };
  writeJsonAtomic(filePath(ws, 'integrations'), next);
  return next;
}

function listIncidents(workspace) {
  ensureWorkspace(workspace);
  return readJson(filePath(workspace, 'incidents'), []);
}

function addIncident(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const incidents = listIncidents(ws);
  const now = new Date().toISOString();
  const incident = {
    id: genId('incident'),
    type: String(input?.type || 'generic'),
    severity: String(input?.severity || 'medium'),
    status: String(input?.status || 'open'),
    title: String(input?.title || 'Guard incident'),
    detail: String(input?.detail || ''),
    metrics: isPlainObject(input?.metrics) ? input.metrics : {},
    evidence: isPlainObject(input?.evidence) ? input.evidence : {},
    createdAt: now,
    updatedAt: now
  };
  incidents.push(incident);
  writeJsonAtomic(filePath(ws, 'incidents'), incidents);
  return incident;
}

function updateIncident(workspace, incidentId, patch) {
  const ws = ensureWorkspace(workspace);
  const incidents = listIncidents(ws);
  const idx = incidents.findIndex((x) => x.id === incidentId);
  if (idx < 0) throw new Error(`Incident not found: ${incidentId}`);
  incidents[idx] = {
    ...incidents[idx],
    ...(patch || {}),
    updatedAt: new Date().toISOString()
  };
  writeJsonAtomic(filePath(ws, 'incidents'), incidents);
  return incidents[idx];
}

function listActionLog(workspace) {
  ensureWorkspace(workspace);
  return readJson(filePath(workspace, 'actionLog'), []);
}

function appendActionLog(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const rows = listActionLog(ws);
  const item = {
    id: genId('action'),
    incidentId: String(input?.incidentId || ''),
    action: String(input?.action || 'manual'),
    status: String(input?.status || 'queued'),
    risk: String(input?.risk || 'medium'),
    actor: String(input?.actor || 'system'),
    who: String(input?.actor || 'system'),
    when: new Date().toISOString(),
    why: String(input?.why || input?.reason || input?.note || input?.summary || ''),
    summary: String(input?.summary || ''),
    payload: isPlainObject(input?.payload) ? input.payload : {},
    result: isPlainObject(input?.result) ? input.result : {},
    createdAt: new Date().toISOString()
  };
  rows.push(item);
  writeJsonAtomic(filePath(ws, 'actionLog'), rows);
  return item;
}

function listRollbackSnapshots(workspace) {
  ensureWorkspace(workspace);
  return readJson(filePath(workspace, 'rollbackSnapshots'), []);
}

function addRollbackSnapshot(workspace, input) {
  const ws = ensureWorkspace(workspace);
  const rows = listRollbackSnapshots(ws);
  const item = {
    id: genId('rollback'),
    actionId: String(input?.actionId || ''),
    workspace: ws,
    targetType: String(input?.targetType || 'unknown'),
    targetId: String(input?.targetId || ''),
    before: isPlainObject(input?.before) ? input.before : {},
    after: isPlainObject(input?.after) ? input.after : {},
    createdAt: new Date().toISOString()
  };
  rows.push(item);
  writeJsonAtomic(filePath(ws, 'rollbackSnapshots'), rows);
  return item;
}

function getRoles() {
  ensureDir(opsRoot());
  const roles = readJson(rolesPath(), { users: {} });
  return roles && typeof roles === 'object' ? roles : { users: {} };
}

function getInvites() {
  ensureDir(opsRoot());
  const invites = readJson(invitesPath(), []);
  return Array.isArray(invites) ? invites : [];
}

function sweepExpiredInvites() {
  const rows = getInvites();
  const now = Date.now();
  let changed = false;
  const next = rows.map((x) => {
    if (x.status === 'active' && x.expiresAt && Date.parse(x.expiresAt) <= now) {
      changed = true;
      return {
        ...x,
        status: 'expired'
      };
    }
    return x;
  });
  if (changed) writeJsonAtomic(invitesPath(), next);
  return next;
}

function listInvites({ workspace, includeExpired = true } = {}) {
  const ws = workspace ? sanitizeWorkspace(workspace) : '';
  const now = Date.now();
  let rows = sweepExpiredInvites();
  if (ws) rows = rows.filter((x) => String(x.workspace || '') === ws);
  if (!includeExpired) rows = rows.filter((x) => !x.expiresAt || Date.parse(x.expiresAt) > now);
  return rows;
}

function createInvite({ workspace, role, actor, expiresInHours = 72 }) {
  const ws = sanitizeWorkspace(workspace);
  const rawRole = String(role || '').trim().toLowerCase();
  const r = rawRole === 'analyst' ? 'admin' : rawRole;
  if (!ROLE_SET.has(r)) {
    throw new Error('Invalid role for invite.');
  }
  const hours = Number.isFinite(Number(expiresInHours)) ? Number(expiresInHours) : 72;
  const ttl = Math.max(1, Math.min(24 * 30, Math.floor(hours)));
  const now = Date.now();
  const token = crypto.randomBytes(18).toString('base64url');
  const invite = {
    id: genId('invite'),
    token,
    workspace: ws,
    role: r,
    createdBy: String(actor || 'system'),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl * 3600 * 1000).toISOString(),
    status: 'active',
    acceptedBy: '',
    acceptedAt: '',
    revokedBy: '',
    revokedAt: '',
    acceptUrl: ''
  };
  const rows = getInvites();
  rows.push(invite);
  writeJsonAtomic(invitesPath(), rows);
  return invite;
}

function rotateInvite({ id, actor, baseUrl, expiresInHours }) {
  const inviteId = String(id || '').trim();
  if (!inviteId) throw new Error('Invite id is required.');
  const rows = getInvites();
  const idx = rows.findIndex((x) => x.id === inviteId);
  if (idx < 0) throw new Error('Invite not found.');
  const old = rows[idx];
  rows[idx] = {
    ...old,
    status: 'revoked',
    revokedBy: String(actor || 'system'),
    revokedAt: new Date().toISOString()
  };
  writeJsonAtomic(invitesPath(), rows);
  const next = createInvite({
    workspace: old.workspace,
    role: old.role,
    actor: String(actor || 'system'),
    expiresInHours
  });
  const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (cleanBase) {
    return setInviteAcceptUrl({
      id: next.id,
      acceptUrl: `${cleanBase}/?invite=${encodeURIComponent(next.token)}`
    });
  }
  return next;
}

function revokeInvite({ id, token, actor }) {
  const rows = getInvites();
  const idx = rows.findIndex((x) => (id && x.id === id) || (token && x.token === token));
  if (idx < 0) throw new Error('Invite not found.');
  const cur = rows[idx];
  rows[idx] = {
    ...cur,
    status: 'revoked',
    revokedBy: String(actor || 'system'),
    revokedAt: new Date().toISOString()
  };
  writeJsonAtomic(invitesPath(), rows);
  return rows[idx];
}

function acceptInvite({ token, user }) {
  const t = String(token || '').trim();
  const u = String(user || '').trim();
  if (!t) throw new Error('Invite token is required.');
  if (!u) throw new Error('User is required.');
  const rows = getInvites();
  const idx = rows.findIndex((x) => x.token === t);
  if (idx < 0) throw new Error('Invite not found.');
  const cur = rows[idx];
  if (cur.status !== 'active') throw new Error(`Invite is ${cur.status}.`);
  const exp = Date.parse(cur.expiresAt || '');
  if (Number.isFinite(exp) && exp <= Date.now()) {
    rows[idx] = { ...cur, status: 'expired' };
    writeJsonAtomic(invitesPath(), rows);
    throw new Error('Invite expired.');
  }
  setRole({ workspace: cur.workspace, user: u, role: cur.role });
  rows[idx] = {
    ...cur,
    status: 'accepted',
    acceptedBy: u,
    acceptedAt: new Date().toISOString()
  };
  writeJsonAtomic(invitesPath(), rows);
  appendActionLog(cur.workspace, {
    action: 'invite.accept',
    status: 'success',
    risk: 'low',
    actor: u,
    summary: `Accepted invite ${cur.id} as ${u} (${cur.role})`,
    payload: { inviteId: cur.id, role: cur.role }
  });
  return rows[idx];
}

function setInviteAcceptUrl({ id, acceptUrl }) {
  const inviteId = String(id || '').trim();
  if (!inviteId) throw new Error('Invite id is required.');
  const rows = getInvites();
  const idx = rows.findIndex((x) => x.id === inviteId);
  if (idx < 0) throw new Error('Invite not found.');
  rows[idx] = {
    ...rows[idx],
    acceptUrl: String(acceptUrl || '').trim()
  };
  writeJsonAtomic(invitesPath(), rows);
  return rows[idx];
}

function maskInviteToken(token) {
  const s = String(token || '');
  if (!s) return '';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function sanitizeInvite(invite, includeSensitive = false) {
  const row = { ...(invite || {}) };
  if (!includeSensitive) {
    row.token = '';
    row.acceptUrl = '';
  } else {
    row.tokenMasked = maskInviteToken(row.token);
  }
  row.tokenMasked = row.tokenMasked || maskInviteToken(row.token);
  return row;
}

function inviteStats({ workspace, days = 30 } = {}) {
  const ws = workspace ? sanitizeWorkspace(workspace) : '';
  const dayCount = Math.max(1, Math.min(365, Number(days) || 30));
  const windowMs = dayCount * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  let rows = sweepExpiredInvites();
  if (ws) rows = rows.filter((x) => String(x.workspace || '') === ws);

  const active = rows.filter((x) => x.status === 'active').length;
  const accepted = rows.filter((x) => x.status === 'accepted').length;
  const expiredRecent = rows.filter((x) => x.status === 'expired' && Date.parse(x.expiresAt || '') >= cutoff).length;
  const acceptedDurations = rows
    .filter((x) => x.status === 'accepted' && x.createdAt && x.acceptedAt)
    .map((x) => {
      const start = Date.parse(x.createdAt);
      const end = Date.parse(x.acceptedAt);
      return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) : null;
    })
    .filter((x) => x !== null);
  const avgAcceptMs = acceptedDurations.length
    ? Math.round(acceptedDurations.reduce((sum, x) => sum + x, 0) / acceptedDurations.length)
    : 0;

  return {
    workspace: ws || null,
    days: dayCount,
    active,
    accepted,
    expiredRecent,
    avgAcceptMs
  };
}

function setRole({ workspace, user, role }) {
  const ws = workspace ? sanitizeWorkspace(workspace) : '';
  const u = String(user || '').trim();
  if (!u) throw new Error('User is required.');
  const rawRole = String(role || '').trim().toLowerCase();
  const r = rawRole === 'analyst' ? 'admin' : rawRole;
  if (!r) throw new Error('Role is required.');
  if (!ROLE_SET.has(r)) throw new Error(`Invalid role: ${r}`);
  const roles = getRoles();
  roles.users[u] = roles.users[u] || { globalRole: 'viewer', workspaces: {} };
  if (ws) {
    roles.users[u].workspaces[ws] = r;
  } else {
    roles.users[u].globalRole = r;
  }
  writeJsonAtomic(rolesPath(), roles);
  return roles.users[u];
}

function listWorkspaceTemplates() {
  return Object.values(WORKSPACE_TEMPLATES).map((x) => ({ id: x.id, notes: x.notes }));
}

function applyWorkspaceTemplate({ workspace, template, actor, runAt }) {
  const ws = ensureWorkspace(workspace);
  const key = String(template || 'agency_default').trim().toLowerCase();
  const selected = WORKSPACE_TEMPLATES[key];
  if (!selected) throw new Error(`Unknown workspace template: ${key}`);

  const policy = setPolicy(ws, selected.policy || {});
  const guardPolicy = setGuardPolicy(ws, selected.guardPolicy || {});
  const existing = listSchedules(ws).find((x) => x.workflow === 'morning_ops');
  const schedule = existing || addSchedule(ws, {
    name: 'Daily Morning Ops',
    workflow: 'morning_ops',
    runAt: String(runAt || new Date().toISOString()),
    repeat: 'daily',
    enabled: true,
    payload: {}
  });
  appendActionLog(ws, {
    action: 'workspace.template.apply',
    status: 'success',
    risk: 'low',
    actor: String(actor || 'system'),
    why: `Applied template ${selected.id}`,
    summary: `Template ${selected.id} applied to workspace ${ws}.`,
    payload: { template: selected.id }
  });
  return {
    workspace: ws,
    template: selected.id,
    policy,
    guardPolicy,
    schedule
  };
}

function applyRolePreset({ workspace, preset, actor, users = {} }) {
  const ws = ensureWorkspace(workspace);
  const presetName = String(preset || 'core').trim().toLowerCase();
  const roles = ROLE_PRESETS[presetName];
  if (!roles) throw new Error(`Unknown role preset: ${presetName}`);
  const assigned = [];
  roles.forEach((role) => {
    const raw = users[role];
    String(raw || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((userId) => {
        setRole({ workspace: ws, user: userId, role });
        assigned.push({ user: userId, role });
      });
  });
  appendActionLog(ws, {
    action: 'workspace.role_preset.apply',
    status: 'success',
    risk: 'low',
    actor: String(actor || 'system'),
    why: `Applied role preset ${presetName}`,
    summary: `Role preset ${presetName} assigned ${assigned.length} role mappings.`,
    payload: { preset: presetName, assigned }
  });
  return { workspace: ws, preset: presetName, assigned };
}

function getRole({ workspace, user }) {
  const normalizeRole = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'analyst') return 'admin';
    if (ROLE_SET.has(raw)) return raw;
    return 'viewer';
  };
  const ws = workspace ? sanitizeWorkspace(workspace) : '';
  const u = String(user || '').trim();
  const roles = getRoles();
  const entry = roles.users[u];
  if (!entry) return 'viewer';
  if (ws && entry.workspaces && entry.workspaces[ws]) return normalizeRole(entry.workspaces[ws]);
  return normalizeRole(entry.globalRole || 'viewer');
}

module.exports = {
  DEFAULT_POLICY,
  DEFAULT_GUARD_POLICY,
  SOURCE_CONNECTORS,
  SOURCE_SYNC_MODES,
  SOURCE_STATUSES,
  resetCacheForTests,
  sanitizeWorkspace,
  opsRoot,
  ensureWorkspace,
  listLeads,
  addLead,
  updateLead,
  listAlerts,
  addAlert,
  ackAlert,
  listApprovals,
  addApproval,
  resolveApproval,
  listOutcomes,
  appendOutcome,
  listSchedules,
  addSchedule,
  updateSchedule,
  removeSchedule,
  listDueSchedules,
  getPolicy,
  setPolicy,
  listSources,
  getSource,
  addSource,
  updateSource,
  upsertSource,
  getGuardPolicy,
  setGuardPolicy,
  getState,
  setState,
  getIntegrations,
  setIntegrations,
  listIncidents,
  addIncident,
  updateIncident,
  listActionLog,
  appendActionLog,
  listRollbackSnapshots,
  addRollbackSnapshot,
  getRoles,
  setRole,
  getRole,
  listWorkspaceTemplates,
  applyWorkspaceTemplate,
  applyRolePreset,
  getInvites,
  listInvites,
  createInvite,
  rotateInvite,
  revokeInvite,
  acceptInvite,
  setInviteAcceptUrl,
  sanitizeInvite,
  inviteStats
};

const state = {
  sessionId: '',
  sending: false,
  activeView: 'chat',
  workspace: 'default',
  opsSnapshot: null,
  sources: [],
  guardPolicy: null,
  latestPayload: {
    history: [],
    pendingActions: [],
    executed: [],
    summary: {}
  },
  settings: {
    enterToSend: true,
    autoScroll: true,
    compactMode: false,
    themeMode: 'dark'
  }
};

const els = {
  messageList: document.getElementById('messageList'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  sessionIdText: document.getElementById('sessionIdText'),
  sessionsList: document.getElementById('sessionsList'),
  newSessionBtn: document.getElementById('newSessionBtn'),
  notifBtn: document.getElementById('notifBtn'),
  bellDot: document.querySelector('.bell-dot'),
  healthStatus: document.getElementById('healthStatus'),
  buildLabel: document.getElementById('buildLabel'),
  topApiBadge: document.getElementById('topApiBadge'),
  topPendingBadge: document.getElementById('topPendingBadge'),
  topWorkspaceText: document.getElementById('topWorkspaceText'),
  topLatencyText: document.getElementById('topLatencyText'),
  topClockText: document.getElementById('topClockText'),
  kpiMessages: document.getElementById('kpiMessages'),
  kpiPending: document.getElementById('kpiPending'),
  kpiExecuted: document.getElementById('kpiExecuted'),
  kpiSessions: document.getElementById('kpiSessions'),
  messageTemplate: document.getElementById('messageTemplate'),
  sideNavItems: Array.from(document.querySelectorAll('.side-nav-item')),
  viewPanels: Array.from(document.querySelectorAll('.view-panel')),
  viewTag: document.getElementById('viewTag'),
  viewTitle: document.getElementById('viewTitle'),
  dataHistory: document.getElementById('dataHistory'),
  dataPending: document.getElementById('dataPending'),
  dataExecuted: document.getElementById('dataExecuted'),
  opsWorkspaceText: document.getElementById('opsWorkspaceText'),
  opsRefreshBtn: document.getElementById('opsRefreshBtn'),
  opsMorningBtn: document.getElementById('opsMorningBtn'),
  opsRunDueBtn: document.getElementById('opsRunDueBtn'),
  opsApproveLowBtn: document.getElementById('opsApproveLowBtn'),
  opsAckTokenBtn: document.getElementById('opsAckTokenBtn'),
  opsAlertsOpen: document.getElementById('opsAlertsOpen'),
  opsApprovalsPending: document.getElementById('opsApprovalsPending'),
  opsLeadsDue: document.getElementById('opsLeadsDue'),
  opsSchedulesDue: document.getElementById('opsSchedulesDue'),
  opsAlertsTable: document.getElementById('opsAlertsTable'),
  opsApprovalsTable: document.getElementById('opsApprovalsTable'),
  opsLeadsTable: document.getElementById('opsLeadsTable'),
  opsOutcomesTable: document.getElementById('opsOutcomesTable'),
  opsGuardRefreshBtn: document.getElementById('opsGuardRefreshBtn'),
  opsGuardModeSelect: document.getElementById('opsGuardModeSelect'),
  opsGuardModeSaveBtn: document.getElementById('opsGuardModeSaveBtn'),
  opsGuardSpendSpikeInput: document.getElementById('opsGuardSpendSpikeInput'),
  opsGuardCpaSpikeInput: document.getElementById('opsGuardCpaSpikeInput'),
  opsGuardRoasDropInput: document.getElementById('opsGuardRoasDropInput'),
  opsGuardMaxBudgetAdjInput: document.getElementById('opsGuardMaxBudgetAdjInput'),
  opsGuardMaxCampaignsInput: document.getElementById('opsGuardMaxCampaignsInput'),
  opsGuardMaxDailyAutoInput: document.getElementById('opsGuardMaxDailyAutoInput'),
  opsGuardCooldownInput: document.getElementById('opsGuardCooldownInput'),
  opsGuardEnabledInput: document.getElementById('opsGuardEnabledInput'),
  opsGuardRequirePauseApprovalInput: document.getElementById('opsGuardRequirePauseApprovalInput'),
  opsGuardPolicySaveBtn: document.getElementById('opsGuardPolicySaveBtn'),
  opsGuardStatusText: document.getElementById('opsGuardStatusText'),
  opsSourcesRefreshBtn: document.getElementById('opsSourcesRefreshBtn'),
  opsSourceNameInput: document.getElementById('opsSourceNameInput'),
  opsSourceConnectorSelect: document.getElementById('opsSourceConnectorSelect'),
  opsSourceSyncModeSelect: document.getElementById('opsSourceSyncModeSelect'),
  opsSourceEnabledInput: document.getElementById('opsSourceEnabledInput'),
  opsSourceSaveBtn: document.getElementById('opsSourceSaveBtn'),
  opsSourceSyncBtn: document.getElementById('opsSourceSyncBtn'),
  opsSourcesTable: document.getElementById('opsSourcesTable'),
  opsSourcesStatusText: document.getElementById('opsSourcesStatusText'),
  configDump: document.getElementById('configDump'),
  refreshConfigBtn: document.getElementById('refreshConfigBtn'),
  settingEnterSend: document.getElementById('settingEnterSend'),
  settingAutoScroll: document.getElementById('settingAutoScroll'),
  settingCompactMode: document.getElementById('settingCompactMode'),
  settingThemeMode: document.getElementById('settingThemeMode'),
  themeToggleBtn: document.getElementById('themeToggleBtn')
};

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function short(v, n = 96) {
  const s = String(v ?? '');
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

function fmtTime(v) {
  if (!v) return '';
  const ts = Date.parse(v);
  if (!Number.isFinite(ts)) return String(v);
  return new Date(ts).toLocaleString();
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resolvedTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('social_gateway_ui_settings') || localStorage.getItem('meta_gateway_ui_settings');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.settings = {
      ...state.settings,
      ...parsed
    };
  } catch {
    // ignore
  }
}

function persistSettings() {
  try {
    localStorage.setItem('social_gateway_ui_settings', JSON.stringify(state.settings));
  } catch {
    // ignore
  }
}

function applySettings() {
  if (els.settingEnterSend) els.settingEnterSend.checked = Boolean(state.settings.enterToSend);
  if (els.settingAutoScroll) els.settingAutoScroll.checked = Boolean(state.settings.autoScroll);
  if (els.settingCompactMode) els.settingCompactMode.checked = Boolean(state.settings.compactMode);
  if (els.settingThemeMode) els.settingThemeMode.value = String(state.settings.themeMode || 'dark');
  document.body.classList.toggle('compact-mode', Boolean(state.settings.compactMode));

  const activeTheme = resolvedTheme(state.settings.themeMode || 'dark');
  document.documentElement.setAttribute('data-theme', activeTheme);
  if (els.themeToggleBtn) {
    els.themeToggleBtn.textContent = `Theme: ${activeTheme === 'dark' ? 'Dark' : 'Light'}`;
  }
}

function setTopClock() {
  if (els.topClockText) {
    els.topClockText.textContent = new Date().toLocaleTimeString();
  }
}

function setTopLatency(ms) {
  if (!els.topLatencyText) return;
  els.topLatencyText.textContent = `${ms}ms`;
  els.topLatencyText.classList.toggle('latency-warn', ms >= 700);
}

async function api(path, options = {}) {
  const startedAt = Date.now();
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  setTopLatency(Date.now() - startedAt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

function appendMessage(role, text, meta = '') {
  const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(role);
  node.querySelector('.bubble-role').textContent = role === 'user'
    ? 'You'
    : role === 'system'
      ? 'System'
      : 'Agent';
  node.querySelector('.bubble-text').textContent = text;
  node.querySelector('.bubble-meta').textContent = meta || nowTime();
  els.messageList.appendChild(node);
  if (state.settings.autoScroll) {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }
}

function setSession(sessionId) {
  state.sessionId = sessionId;
  els.sessionIdText.textContent = sessionId || '-';
}

function setSending(isSending) {
  state.sending = isSending;
  els.sendBtn.disabled = isSending;
  els.messageInput.disabled = isSending;
  els.sendBtn.textContent = isSending ? 'Sending...' : 'Send';
}

function pendingActionsText(actions) {
  if (!Array.isArray(actions) || !actions.length) return '';
  const rows = actions.map((a, i) => `${i + 1}. ${a.tool}`).join('\n');
  return `Pending actions:\n${rows}\n\nReply "yes" to run, or "no" to cancel.`;
}

function updateKpis(payload = {}) {
  const historyCount = Array.isArray(payload.history) ? payload.history.length : 0;
  const pendingCount = Array.isArray(payload.pendingActions) ? payload.pendingActions.length : 0;
  const executedCount = Number(payload.summary?.executedActions || 0);

  if (els.kpiMessages) els.kpiMessages.textContent = String(historyCount);
  if (els.kpiPending) els.kpiPending.textContent = String(pendingCount);
  if (els.kpiExecuted) els.kpiExecuted.textContent = String(executedCount);
  if (els.topPendingBadge) els.topPendingBadge.textContent = `${pendingCount} PENDING`;
  if (els.bellDot) {
    els.bellDot.classList.toggle('hidden', pendingCount <= 0);
  }
}

function renderTable(target, columns, rows) {
  if (!target) return;
  if (!Array.isArray(rows) || !rows.length) {
    target.innerHTML = '<p class="empty-note">No data yet.</p>';
    return;
  }
  const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((row) => {
    const cols = columns.map((c) => `<td>${escapeHtml(short(row[c.key] ?? ''))}</td>`).join('');
    return `<tr>${cols}</tr>`;
  }).join('');
  target.innerHTML = `<table class="mini-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderDataConsole(payload) {
  const p = payload || state.latestPayload || {};
  const historyRows = (p.history || []).slice(-40).reverse().map((h) => ({
    time: h.timestamp ? new Date(h.timestamp).toLocaleTimeString() : '',
    role: h.role || '',
    content: h.content || ''
  }));
  const pendingRows = (p.pendingActions || []).map((a, i) => ({
    n: i + 1,
    tool: a.tool || '',
    description: a.description || ''
  }));
  const executedRows = (p.executed || []).map((x, i) => ({
    n: i + 1,
    tool: x.tool || '',
    status: x.success ? 'success' : 'error',
    summary: x.summary || x.error || ''
  }));

  renderTable(els.dataHistory, [
    { key: 'time', label: 'Time' },
    { key: 'role', label: 'Role' },
    { key: 'content', label: 'Content' }
  ], historyRows);

  renderTable(els.dataPending, [
    { key: 'n', label: '#' },
    { key: 'tool', label: 'Tool' },
    { key: 'description', label: 'Description' }
  ], pendingRows);

  renderTable(els.dataExecuted, [
    { key: 'n', label: '#' },
    { key: 'tool', label: 'Tool' },
    { key: 'status', label: 'Status' },
    { key: 'summary', label: 'Summary' }
  ], executedRows);
}

async function refreshConfig() {
  if (!els.configDump) return;
  els.configDump.textContent = 'Loading...';
  try {
    const res = await api('/api/config');
    els.configDump.textContent = JSON.stringify(res, null, 2);
    state.workspace = String(res.config?.activeProfile || 'default');
    if (els.opsWorkspaceText) {
      els.opsWorkspaceText.textContent = state.workspace;
    }
    if (els.topWorkspaceText) {
      els.topWorkspaceText.textContent = state.workspace;
    }
  } catch (error) {
    els.configDump.textContent = `Failed to load config: ${error.message}`;
  }
}

function opsActionButtons(kind, row) {
  if (kind === 'alert' && row.status === 'open') {
    return `<button class="ghost-btn small js-ops-ack" data-id="${escapeHtml(row.id)}">Ack</button>`;
  }
  if (kind === 'approval' && row.status === 'pending') {
    return [
      `<button class="ghost-btn small js-ops-approve" data-id="${escapeHtml(row.id)}">Approve</button>`,
      `<button class="ghost-btn small js-ops-reject" data-id="${escapeHtml(row.id)}">Reject</button>`
    ].join(' ');
  }
  return `<span class="mono">${escapeHtml(row.status || '')}</span>`;
}

function renderOpsAlerts(alerts) {
  if (!els.opsAlertsTable) return;
  if (!Array.isArray(alerts) || !alerts.length) {
    els.opsAlertsTable.innerHTML = '<p class="empty-note">No open alerts.</p>';
    return;
  }
  const rows = alerts.map((a) => `
    <tr>
      <td>${escapeHtml(a.severity || '')}</td>
      <td>${escapeHtml(short(a.message || '', 140))}</td>
      <td>${escapeHtml(fmtTime(a.createdAt))}</td>
      <td>${opsActionButtons('alert', a)}</td>
    </tr>
  `).join('');
  els.opsAlertsTable.innerHTML = `
    <table class="mini-table">
      <thead><tr><th>Severity</th><th>Message</th><th>Created</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderOpsApprovals(approvals) {
  if (!els.opsApprovalsTable) return;
  if (!Array.isArray(approvals) || !approvals.length) {
    els.opsApprovalsTable.innerHTML = '<p class="empty-note">No pending approvals.</p>';
    return;
  }
  const rows = approvals.map((a) => `
    <tr>
      <td>${escapeHtml(a.risk || '')}</td>
      <td>${escapeHtml(short(a.title || '', 120))}</td>
      <td>${escapeHtml(short(a.reason || '', 140))}</td>
      <td>${opsActionButtons('approval', a)}</td>
    </tr>
  `).join('');
  els.opsApprovalsTable.innerHTML = `
    <table class="mini-table">
      <thead><tr><th>Risk</th><th>Title</th><th>Reason</th><th>Decision</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function setSourcesStatus(text) {
  if (els.opsSourcesStatusText) {
    els.opsSourcesStatusText.textContent = text;
  }
}

function sourceRowAction(source) {
  if (!source || source.enabled === false) return '<span class="mono">disabled</span>';
  return `<button class="ghost-btn small js-source-sync" data-id="${escapeHtml(source.id)}">Sync</button>`;
}

function renderSources(sources) {
  const rows = Array.isArray(sources) ? sources : [];
  state.sources = rows;

  if (!els.opsSourcesTable) return;
  if (!rows.length) {
    els.opsSourcesTable.innerHTML = '<p class="empty-note">No sources configured yet.</p>';
    setSourcesStatus('No sources loaded.');
    return;
  }

  const body = rows.map((s) => `
    <tr>
      <td>${escapeHtml(s.name || '')}</td>
      <td>${escapeHtml(s.connector || '')}</td>
      <td>${escapeHtml(s.status || '')}</td>
      <td>${escapeHtml(String(s.itemCount ?? 0))}</td>
      <td>${escapeHtml(fmtTime(s.lastSyncAt))}</td>
      <td>${sourceRowAction(s)}</td>
    </tr>
  `).join('');

  els.opsSourcesTable.innerHTML = `
    <table class="mini-table">
      <thead><tr><th>Name</th><th>Connector</th><th>Status</th><th>Items</th><th>Last Sync</th><th>Action</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
  setSourcesStatus(`Loaded ${rows.length} sources.`);
}

function renderOpsSnapshot(snapshot) {
  state.opsSnapshot = snapshot || state.opsSnapshot;
  const s = state.opsSnapshot?.summary || {};
  if (els.opsWorkspaceText) els.opsWorkspaceText.textContent = state.opsSnapshot?.workspace || state.workspace || 'default';
  if (els.opsAlertsOpen) els.opsAlertsOpen.textContent = String(s.alertsOpen || 0);
  if (els.opsApprovalsPending) els.opsApprovalsPending.textContent = String(s.approvalsPending || 0);
  if (els.opsLeadsDue) els.opsLeadsDue.textContent = String(s.leadsDue || 0);
  if (els.opsSchedulesDue) els.opsSchedulesDue.textContent = String(s.schedulesDue || 0);
  if (s.guardPolicy) renderGuardPolicy(s.guardPolicy);
  if (Array.isArray(state.opsSnapshot?.sources)) {
    renderSources(state.opsSnapshot.sources);
  }
  if (Number.isFinite(Number(s.sourcesConfigured)) || Number.isFinite(Number(s.sourcesReady))) {
    setSourcesStatus(`Sources ready ${s.sourcesReady || 0}/${s.sourcesConfigured || 0}`);
  }

  renderOpsAlerts(state.opsSnapshot?.alerts || []);
  renderOpsApprovals(state.opsSnapshot?.approvals || []);

  const leadsRows = (state.opsSnapshot?.leadsDue || []).map((x) => ({
    status: x.status || '',
    name: x.name || '',
    phone: x.phone || '',
    updated: fmtTime(x.updatedAt)
  }));
  renderTable(els.opsLeadsTable, [
    { key: 'status', label: 'Status' },
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'updated', label: 'Updated' }
  ], leadsRows);

  const outcomeRows = (state.opsSnapshot?.outcomes || []).map((x) => ({
    kind: x.kind || '',
    summary: x.summary || '',
    createdAt: fmtTime(x.createdAt)
  }));
  renderTable(els.opsOutcomesTable, [
    { key: 'kind', label: 'Kind' },
    { key: 'summary', label: 'Summary' },
    { key: 'createdAt', label: 'When' }
  ], outcomeRows);
}

function setGuardStatus(text) {
  if (els.opsGuardStatusText) {
    els.opsGuardStatusText.textContent = text;
  }
}

function renderGuardPolicy(policy) {
  if (!policy) return;
  state.guardPolicy = policy;
  if (els.opsGuardModeSelect) els.opsGuardModeSelect.value = String(policy.mode || 'approval');
  if (els.opsGuardSpendSpikeInput) els.opsGuardSpendSpikeInput.value = String(policy.thresholds?.spendSpikePct ?? 35);
  if (els.opsGuardCpaSpikeInput) els.opsGuardCpaSpikeInput.value = String(policy.thresholds?.cpaSpikePct ?? 30);
  if (els.opsGuardRoasDropInput) els.opsGuardRoasDropInput.value = String(policy.thresholds?.roasDropPct ?? 20);
  if (els.opsGuardMaxBudgetAdjInput) els.opsGuardMaxBudgetAdjInput.value = String(policy.limits?.maxBudgetAdjustmentPct ?? 20);
  if (els.opsGuardMaxCampaignsInput) els.opsGuardMaxCampaignsInput.value = String(policy.limits?.maxCampaignsPerRun ?? 5);
  if (els.opsGuardMaxDailyAutoInput) els.opsGuardMaxDailyAutoInput.value = String(policy.limits?.maxDailyAutoActions ?? 10);
  if (els.opsGuardCooldownInput) els.opsGuardCooldownInput.value = String(policy.cooldownMinutes ?? 60);
  if (els.opsGuardEnabledInput) els.opsGuardEnabledInput.checked = Boolean(policy.enabled);
  if (els.opsGuardRequirePauseApprovalInput) {
    els.opsGuardRequirePauseApprovalInput.checked = Boolean(policy.limits?.requireApprovalForPause);
  }
  setGuardStatus(`Mode ${policy.mode} | Updated ${nowTime()}`);
}

async function loadGuardPolicy() {
  const ws = encodeURIComponent(state.workspace || 'default');
  const res = await api(`/api/ops/guard/policy?workspace=${ws}`);
  renderGuardPolicy(res.guardPolicy || null);
}

async function saveGuardMode() {
  const mode = String(els.opsGuardModeSelect?.value || '').trim();
  if (!mode) throw new Error('Select a guard mode first.');
  const res = await api('/api/ops/guard/mode', {
    method: 'POST',
    body: { workspace: state.workspace, mode }
  });
  renderGuardPolicy(res.guardPolicy || null);
  if (res.snapshot) renderOpsSnapshot(res.snapshot);
  setGuardStatus(`Guard mode saved: ${mode}`);
  appendMessage('system', `Guard mode set to ${mode} for ${state.workspace}.`);
}

async function saveGuardPolicy() {
  const body = {
    workspace: state.workspace,
    enabled: Boolean(els.opsGuardEnabledInput?.checked),
    cooldownMinutes: num(els.opsGuardCooldownInput?.value, 60),
    thresholds: {
      spendSpikePct: num(els.opsGuardSpendSpikeInput?.value, 35),
      cpaSpikePct: num(els.opsGuardCpaSpikeInput?.value, 30),
      roasDropPct: num(els.opsGuardRoasDropInput?.value, 20)
    },
    limits: {
      maxBudgetAdjustmentPct: num(els.opsGuardMaxBudgetAdjInput?.value, 20),
      maxCampaignsPerRun: num(els.opsGuardMaxCampaignsInput?.value, 5),
      maxDailyAutoActions: num(els.opsGuardMaxDailyAutoInput?.value, 10),
      requireApprovalForPause: Boolean(els.opsGuardRequirePauseApprovalInput?.checked)
    }
  };

  const res = await api('/api/ops/guard/policy', {
    method: 'POST',
    body
  });
  renderGuardPolicy(res.guardPolicy || null);
  if (res.snapshot) renderOpsSnapshot(res.snapshot);
  setGuardStatus(`Guard policy saved at ${nowTime()}`);
  appendMessage('system', `Guard policy updated for ${state.workspace}.`);
}

async function refreshSources() {
  const ws = encodeURIComponent(state.workspace || 'default');
  const res = await api(`/api/ops/sources?workspace=${ws}`);
  renderSources(res.sources || []);
}

async function saveSource() {
  const name = String(els.opsSourceNameInput?.value || '').trim();
  const connector = String(els.opsSourceConnectorSelect?.value || '').trim();
  const syncMode = String(els.opsSourceSyncModeSelect?.value || 'manual').trim();
  const enabled = Boolean(els.opsSourceEnabledInput?.checked);
  if (!name) throw new Error('Source name is required.');
  if (!connector) throw new Error('Connector is required.');

  const res = await api('/api/ops/sources/upsert', {
    method: 'POST',
    body: {
      workspace: state.workspace,
      name,
      connector,
      syncMode,
      enabled
    }
  });

  if (res.snapshot) renderOpsSnapshot(res.snapshot);
  await refreshSources();
  appendMessage('system', `Source saved: ${name} (${connector}).`);
}

async function syncSources(ids = null) {
  const body = { workspace: state.workspace };
  if (Array.isArray(ids) && ids.length) body.sourceIds = ids;
  const res = await api('/api/ops/sources/sync', {
    method: 'POST',
    body
  });
  if (res.snapshot) renderOpsSnapshot(res.snapshot);
  await refreshSources();
  const count = Array.isArray(res.result) ? res.result.length : 0;
  appendMessage('system', `Source sync completed for ${count} source(s).`);
}

async function refreshOps() {
  try {
    const ws = encodeURIComponent(state.workspace || 'default');
    const res = await api(`/api/ops/summary?workspace=${ws}`);
    renderOpsSnapshot(res);
    if (!Array.isArray(res.sources)) {
      await refreshSources();
    }
  } catch (error) {
    if (els.opsAlertsTable) {
      els.opsAlertsTable.innerHTML = `<p class="empty-note">Failed to load ops data: ${escapeHtml(error.message)}</p>`;
    }
    setSourcesStatus(`Failed to load sources: ${error.message}`);
  }
}

async function runMorningOps() {
  const res = await api('/api/ops/morning-run', {
    method: 'POST',
    body: { workspace: state.workspace }
  });
  renderOpsSnapshot(res.snapshot);
  const msg = res.result?.skipped
    ? `Morning ops skipped: ${res.result.reason || 'already ran today'}`
    : `Morning ops completed for ${res.result?.workspace || state.workspace}`;
  appendMessage('system', msg);
}

async function runDueSchedules() {
  const res = await api('/api/ops/schedule/run-due', {
    method: 'POST',
    body: { workspace: state.workspace }
  });
  renderOpsSnapshot(res.snapshot);
  const count = Array.isArray(res.result) ? res.result.length : 0;
  appendMessage('system', `Ran ${count} due schedules for ${state.workspace}.`);
}

async function ackAlertById(id) {
  const res = await api('/api/ops/alerts/ack', {
    method: 'POST',
    body: { workspace: state.workspace, id }
  });
  renderOpsSnapshot(res.snapshot);
}

async function resolveApprovalById(id, decision) {
  const res = await api('/api/ops/approvals/resolve', {
    method: 'POST',
    body: { workspace: state.workspace, id, decision }
  });
  renderOpsSnapshot(res.snapshot);
}

async function ackTokenAlerts() {
  const rows = (state.opsSnapshot?.alerts || []).filter((a) => a.type === 'token_missing' && a.status === 'open');
  if (!rows.length) {
    appendMessage('system', 'No open token alerts.');
    return;
  }
  for (let i = 0; i < rows.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await ackAlertById(rows[i].id);
  }
  appendMessage('system', `Acknowledged ${rows.length} token alerts.`);
}

async function approveLowRisk() {
  const rows = (state.opsSnapshot?.approvals || []).filter((a) => a.status === 'pending' && String(a.risk || '').toLowerCase() === 'low');
  if (!rows.length) {
    appendMessage('system', 'No low-risk approvals pending.');
    return;
  }
  for (let i = 0; i < rows.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await resolveApprovalById(rows[i].id, 'approve');
  }
  appendMessage('system', `Approved ${rows.length} low-risk requests.`);
}

function setActiveView(view) {
  state.activeView = view;
  const titles = {
    chat: { tag: 'Chat Agent', title: 'Talk naturally. Execute safely.' },
    data: { tag: 'Data Console', title: 'Inspect live conversation and execution trails.' },
    ops: { tag: 'Ops Center', title: 'Run workflows, resolve approvals, and clear alerts.' },
    config: { tag: 'Config', title: 'Runtime profile, defaults, and token state.' },
    devtools: { tag: 'Developer Toolkit', title: 'Commands, providers, and integration shortcuts.' },
    help: { tag: 'Help', title: 'Prompt patterns for developer and marketing flows.' },
    settings: { tag: 'Settings', title: 'Keyboard, auto-scroll, and compact display options.' }
  };
  const copy = titles[view] || titles.chat;
  if (els.viewTag) els.viewTag.textContent = copy.tag;
  if (els.viewTitle) els.viewTitle.textContent = copy.title;

  els.sideNavItems.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  els.viewPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `view-${view}`);
  });
  if (view === 'data') renderDataConsole(state.latestPayload);
  if (view === 'ops') refreshOps();
  if (view === 'config') refreshConfig();
}

function renderExecuted(executed) {
  if (!Array.isArray(executed) || !executed.length) return;
  executed.forEach((row) => {
    if (row.success) {
      appendMessage('system', `OK: ${row.summary || row.tool}`);
      if (Array.isArray(row.suggestions) && row.suggestions.length) {
        appendMessage('agent', `Suggestions:\n${row.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
      }
    } else {
      appendMessage('system', `ERROR: ${row.tool}: ${row.error || 'failed'}`);
      if (Array.isArray(row.suggestions) && row.suggestions.length) {
        appendMessage('agent', `Suggestions:\n${row.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
      }
    }
  });
}

async function refreshSessions() {
  try {
    const res = await api('/api/sessions');
    const sessions = res.sessions || [];
    if (els.kpiSessions) els.kpiSessions.textContent = String(sessions.length);
    els.sessionsList.innerHTML = '';
    if (!sessions.length) {
      const li = document.createElement('li');
      li.textContent = 'No saved sessions';
      li.style.opacity = '0.7';
      els.sessionsList.appendChild(li);
      return;
    }
    sessions.forEach((s) => {
      const li = document.createElement('li');
      li.textContent = `${s.sessionId}\n${new Date(s.updatedAt).toLocaleString()}`;
      li.onclick = () => startSession(s.sessionId);
      els.sessionsList.appendChild(li);
    });
  } catch (error) {
    console.error(error);
  }
}

async function checkHealth() {
  try {
    const res = await api('/api/health');
    const service = String(res.service || '');
    const version = String(res.version || '');
    const isLegacy = service && service !== 'social-api-gateway';
    els.healthStatus.classList.toggle('warn', isLegacy);
    els.healthStatus.textContent = isLegacy
      ? `Legacy build detected (${service})`
      : `Online (${version})`;
    if (els.topApiBadge) {
      els.topApiBadge.classList.remove('badge-ok', 'badge-warn', 'badge-error');
      els.topApiBadge.classList.add(isLegacy ? 'badge-warn' : 'badge-ok');
      els.topApiBadge.textContent = isLegacy ? 'LEGACY BUILD' : 'API LIVE';
    }
    if (els.buildLabel) {
      els.buildLabel.textContent = `${service || 'unknown-service'} | v${version || '-'}`;
    }
    if (isLegacy) {
      appendMessage('system', 'Legacy gateway service detected. Run `social gateway --open` from the latest social-cli install.');
    }
  } catch (error) {
    els.healthStatus.textContent = `Offline: ${error.message}`;
    els.healthStatus.classList.add('warn');
    if (els.topApiBadge) {
      els.topApiBadge.classList.remove('badge-ok', 'badge-warn');
      els.topApiBadge.classList.add('badge-error');
      els.topApiBadge.textContent = 'API OFFLINE';
    }
    if (els.buildLabel) {
      els.buildLabel.textContent = 'Build: unavailable';
    }
  }
}

async function startSession(sessionId = '') {
  const res = await api('/api/chat/start', { method: 'POST', body: { sessionId } });
  setSession(res.sessionId);
  els.messageList.innerHTML = '';
  appendMessage('system', res.resumed ? `Resumed session ${res.sessionId}` : `Started session ${res.sessionId}`);
  appendMessage('agent', 'Ready. Tell me what you want to do.');

  state.latestPayload = {
    history: res.history || [],
    pendingActions: [],
    executed: [],
    summary: res.summary || {}
  };

  updateKpis(state.latestPayload);
  renderDataConsole(state.latestPayload);
  await refreshSessions();
}

async function sendMessage() {
  if (state.sending) return;
  const text = els.messageInput.value.trim();
  if (!text) return;

  setSending(true);
  appendMessage('user', text);
  els.messageInput.value = '';

  try {
    const res = await api('/api/chat/message', {
      method: 'POST',
      body: {
        sessionId: state.sessionId,
        message: text
      }
    });

    const agentText = res.response?.message || '(no response)';
    appendMessage('agent', agentText);
    if (Array.isArray(res.response?.suggestions) && res.response.suggestions.length) {
      appendMessage('agent', `Suggestions:\n${res.response.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    }
    if (res.pendingActions?.length) {
      appendMessage('system', pendingActionsText(res.pendingActions));
    }
    renderExecuted(res.executed);

    state.latestPayload = {
      history: res.history || [],
      pendingActions: res.pendingActions || [],
      executed: res.executed || [],
      summary: res.summary || {}
    };
    updateKpis(state.latestPayload);
    renderDataConsole(state.latestPayload);
    await refreshSessions();
  } catch (error) {
    appendMessage('system', `Error: ${error.message}`);
  } finally {
    setSending(false);
    els.messageInput.focus();
  }
}

function wireEvents() {
  els.sendBtn.addEventListener('click', sendMessage);
  els.messageInput.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && !evt.shiftKey && state.settings.enterToSend) {
      evt.preventDefault();
      sendMessage();
    }
  });
  els.newSessionBtn.addEventListener('click', () => startSession(''));
  document.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      els.messageInput.value = btn.getAttribute('data-prompt') || '';
      setActiveView('chat');
      els.messageInput.focus();
    });
  });

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = btn.getAttribute('data-copy') || '';
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        appendMessage('system', `Copied command: ${value}`);
      } catch (error) {
        appendMessage('system', `Copy failed. Command: ${value}`);
      }
    });
  });

  els.sideNavItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveView(btn.dataset.view || 'chat');
    });
  });

  if (els.notifBtn) {
    els.notifBtn.addEventListener('click', () => {
      const pending = Number((els.kpiPending && els.kpiPending.textContent) || '0') || 0;
      appendMessage('system', `${pending} pending actions await confirmation.`);
      setActiveView('chat');
    });
  }

  if (els.refreshConfigBtn) {
    els.refreshConfigBtn.addEventListener('click', refreshConfig);
  }

  if (els.opsRefreshBtn) {
    els.opsRefreshBtn.addEventListener('click', refreshOps);
  }
  if (els.opsSourcesRefreshBtn) {
    els.opsSourcesRefreshBtn.addEventListener('click', async () => {
      try {
        await refreshSources();
      } catch (error) {
        setSourcesStatus(`Failed to refresh sources: ${error.message}`);
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsSourceSaveBtn) {
    els.opsSourceSaveBtn.addEventListener('click', async () => {
      try {
        await saveSource();
      } catch (error) {
        setSourcesStatus(`Failed to save source: ${error.message}`);
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsSourceSyncBtn) {
    els.opsSourceSyncBtn.addEventListener('click', async () => {
      try {
        await syncSources();
      } catch (error) {
        setSourcesStatus(`Failed to sync sources: ${error.message}`);
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsGuardRefreshBtn) {
    els.opsGuardRefreshBtn.addEventListener('click', async () => {
      try {
        await loadGuardPolicy();
      } catch (error) {
        setGuardStatus(`Failed to load guard policy: ${error.message}`);
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsGuardModeSaveBtn) {
    els.opsGuardModeSaveBtn.addEventListener('click', async () => {
      try {
        await saveGuardMode();
      } catch (error) {
        setGuardStatus(`Failed to save guard mode: ${error.message}`);
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsGuardPolicySaveBtn) {
    els.opsGuardPolicySaveBtn.addEventListener('click', async () => {
      try {
        await saveGuardPolicy();
      } catch (error) {
        setGuardStatus(`Failed to save guard policy: ${error.message}`);
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsMorningBtn) {
    els.opsMorningBtn.addEventListener('click', async () => {
      try {
        await runMorningOps();
      } catch (error) {
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsRunDueBtn) {
    els.opsRunDueBtn.addEventListener('click', async () => {
      try {
        await runDueSchedules();
      } catch (error) {
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsAckTokenBtn) {
    els.opsAckTokenBtn.addEventListener('click', async () => {
      try {
        await ackTokenAlerts();
      } catch (error) {
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }
  if (els.opsApproveLowBtn) {
    els.opsApproveLowBtn.addEventListener('click', async () => {
      try {
        await approveLowRisk();
      } catch (error) {
        appendMessage('system', `Ops error: ${error.message}`);
      }
    });
  }

  document.addEventListener('click', async (evt) => {
    const btn = evt.target.closest('button');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (!id) return;
    try {
      if (btn.classList.contains('js-ops-ack')) {
        await ackAlertById(id);
      } else if (btn.classList.contains('js-ops-approve')) {
        await resolveApprovalById(id, 'approve');
      } else if (btn.classList.contains('js-ops-reject')) {
        await resolveApprovalById(id, 'reject');
      } else if (btn.classList.contains('js-source-sync')) {
        await syncSources([id]);
      }
    } catch (error) {
      appendMessage('system', `Ops error: ${error.message}`);
    }
  });

  if (els.settingEnterSend) {
    els.settingEnterSend.addEventListener('change', () => {
      state.settings.enterToSend = Boolean(els.settingEnterSend.checked);
      persistSettings();
    });
  }

  if (els.settingAutoScroll) {
    els.settingAutoScroll.addEventListener('change', () => {
      state.settings.autoScroll = Boolean(els.settingAutoScroll.checked);
      persistSettings();
    });
  }

  if (els.settingCompactMode) {
    els.settingCompactMode.addEventListener('change', () => {
      state.settings.compactMode = Boolean(els.settingCompactMode.checked);
      applySettings();
      persistSettings();
    });
  }

  if (els.settingThemeMode) {
    els.settingThemeMode.addEventListener('change', () => {
      state.settings.themeMode = String(els.settingThemeMode.value || 'dark');
      applySettings();
      persistSettings();
    });
  }

  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener('click', () => {
      const current = resolvedTheme(state.settings.themeMode || 'dark');
      state.settings.themeMode = current === 'dark' ? 'light' : 'dark';
      applySettings();
      persistSettings();
    });
  }
}

async function init() {
  setTopClock();
  setInterval(setTopClock, 1000);
  loadSettings();
  applySettings();
  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onThemeChange = () => {
      if ((state.settings.themeMode || 'dark') === 'system') {
        applySettings();
      }
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onThemeChange);
    } else if (typeof media.addListener === 'function') {
      media.addListener(onThemeChange);
    }
  }
  wireEvents();
  await checkHealth();
  await refreshConfig();
  await startSession('');
  await refreshOps();
  setActiveView('chat');
}

init().catch((error) => {
  appendMessage('system', `Failed to initialize: ${error.message}`);
});

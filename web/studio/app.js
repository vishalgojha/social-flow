const state = {
  sessionId: '',
  sending: false,
  activeView: 'chat',
  workspace: 'default',
  wsConnected: false,
  ws: null,
  liveLogs: [],
  currentPlan: [],
  waba: {
    integration: null,
    doctor: null
  },
  regionPolicy: {
    region: null,
    preflight: null
  },
  team: {
    operator: null,
    role: '',
    activity: [],
    roles: [],
    invites: []
  },
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
    themeMode: 'dark',
    gatewayApiKey: '',
    lang: 'en'
  }
};

const I18N = {
  en: {
    send: 'Send',
    sending: 'Sending...',
    view_chat_tag: 'Chat Agent',
    view_chat_title: 'Talk naturally. Execute safely.',
    view_posts_tag: 'Posts',
    view_posts_title: 'Recent publishing actions across platforms.',
    view_analytics_tag: 'Analytics',
    view_analytics_title: 'Reach, engagement, and execution trend snapshot.',
    view_settings_tag: 'Settings',
    view_settings_title: 'Keyboard, theme, and gateway security settings.',
    waba_connected: 'CONNECTED',
    waba_not_connected: 'NOT CONNECTED',
    waba_no_checks: 'No doctor checks yet. Click "Refresh Status".',
    waba_status_error: 'WABA status error: {error}',
    waba_connect_ready: 'WABA connect ready.',
    waba_connect_partial: 'WABA connect partial.',
    waba_connect_failed: 'WABA connect failed: {error}',
    waba_disconnected: 'WABA integration disconnected.',
    waba_disconnect_failed: 'WABA disconnect failed: {error}',
    no_plan: 'No plan available to execute.',
    unknown_palette: 'Unknown palette command: {cmd}',
    failed_init: 'Failed to initialize: {error}',
    doctor_pass: 'PASS',
    doctor_fail: 'FAIL',
    doctor_skip: 'SKIP'
  },
  hi: {
    send: 'Bhejo',
    sending: 'Bhej rahe hain...',
    view_chat_tag: 'Chat Agent',
    view_chat_title: 'Natural language mein bolo. Safe execute hoga.',
    view_posts_tag: 'Posts',
    view_posts_title: 'Recent publishing actions across platforms.',
    view_analytics_tag: 'Analytics',
    view_analytics_title: 'Reach, engagement aur execution trend snapshot.',
    view_settings_tag: 'Settings',
    view_settings_title: 'Keyboard, theme aur gateway security settings.',
    waba_connected: 'CONNECTED',
    waba_not_connected: 'NOT CONNECTED',
    waba_no_checks: 'Doctor checks abhi nahi hain. "Refresh Status" dabao.',
    waba_status_error: 'WABA status error: {error}',
    waba_connect_ready: 'WABA connect ready.',
    waba_connect_partial: 'WABA connect partial.',
    waba_connect_failed: 'WABA connect failed: {error}',
    waba_disconnected: 'WABA integration disconnect ho gaya.',
    waba_disconnect_failed: 'WABA disconnect failed: {error}',
    no_plan: 'Execute karne ke liye abhi koi plan nahi hai.',
    unknown_palette: 'Unknown palette command: {cmd}',
    failed_init: 'Initialize failed: {error}',
    doctor_pass: 'PASS',
    doctor_fail: 'FAIL',
    doctor_skip: 'SKIP'
  }
};

function st(key, vars = {}) {
  const lang = String((state.settings && state.settings.lang) || 'en').toLowerCase();
  const table = I18N[lang] || I18N.en;
  let out = String(table[key] || I18N.en[key] || key);
  Object.entries(vars || {}).forEach(([k, v]) => {
    out = out.replaceAll(`{${k}}`, String(v));
  });
  return out;
}

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
  wsLiveBadge: document.getElementById('wsLiveBadge'),
  kpiMessages: document.getElementById('kpiMessages'),
  kpiPending: document.getElementById('kpiPending'),
  kpiExecuted: document.getElementById('kpiExecuted'),
  kpiSessions: document.getElementById('kpiSessions'),
  messageTemplate: document.getElementById('messageTemplate'),
  sideNavItems: Array.from(document.querySelectorAll('.side-nav-item')),
  topTabs: Array.from(document.querySelectorAll('.top-tab')),
  viewPanels: Array.from(document.querySelectorAll('.view-panel')),
  viewTag: document.getElementById('viewTag'),
  viewTitle: document.getElementById('viewTitle'),
  liveLogs: document.getElementById('liveLogs'),
  planCard: document.getElementById('planCard'),
  planSteps: document.getElementById('planSteps'),
  planStepCount: document.getElementById('planStepCount'),
  executePlanBtn: document.getElementById('executePlanBtn'),
  editPlanBtn: document.getElementById('editPlanBtn'),
  dryRunPlanBtn: document.getElementById('dryRunPlanBtn'),
  rollbackBtn: document.getElementById('rollbackBtn'),
  postsTable: document.getElementById('postsTable'),
  analyticsReach: document.getElementById('analyticsReach'),
  analyticsEngagement: document.getElementById('analyticsEngagement'),
  analyticsMessages: document.getElementById('analyticsMessages'),
  analyticsRate: document.getElementById('analyticsRate'),
  analyticsSparkline: document.getElementById('analyticsSparkline'),
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
  teamActivityRefreshBtn: document.getElementById('teamActivityRefreshBtn'),
  teamActivityExportJsonBtn: document.getElementById('teamActivityExportJsonBtn'),
  teamActivityExportCsvBtn: document.getElementById('teamActivityExportCsvBtn'),
  teamActivityActorInput: document.getElementById('teamActivityActorInput'),
  teamActivityTable: document.getElementById('teamActivityTable'),
  handoffPackTemplateInput: document.getElementById('handoffPackTemplateInput'),
  handoffPackOutDirInput: document.getElementById('handoffPackOutDirInput'),
  handoffPackGenerateBtn: document.getElementById('handoffPackGenerateBtn'),
  handoffPackOutput: document.getElementById('handoffPackOutput'),
  handoffPackFiles: document.getElementById('handoffPackFiles'),
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
  settingLang: document.getElementById('settingLang'),
  settingGatewayApiKey: document.getElementById('settingGatewayApiKey'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  wabaConnectBadge: document.getElementById('wabaConnectBadge'),
  wabaTokenInput: document.getElementById('wabaTokenInput'),
  wabaBusinessIdInput: document.getElementById('wabaBusinessIdInput'),
  wabaWabaIdInput: document.getElementById('wabaWabaIdInput'),
  wabaPhoneNumberIdInput: document.getElementById('wabaPhoneNumberIdInput'),
  wabaWebhookCallbackInput: document.getElementById('wabaWebhookCallbackInput'),
  wabaWebhookVerifyTokenInput: document.getElementById('wabaWebhookVerifyTokenInput'),
  wabaTestToInput: document.getElementById('wabaTestToInput'),
  wabaConnectBtn: document.getElementById('wabaConnectBtn'),
  wabaStatusBtn: document.getElementById('wabaStatusBtn'),
  wabaDisconnectBtn: document.getElementById('wabaDisconnectBtn'),
  wabaDoctorCards: document.getElementById('wabaDoctorCards'),
  regionPolicyBadge: document.getElementById('regionPolicyBadge'),
  regionCountryInput: document.getElementById('regionCountryInput'),
  regionTimezoneInput: document.getElementById('regionTimezoneInput'),
  regionModeInput: document.getElementById('regionModeInput'),
  regionPolicySaveBtn: document.getElementById('regionPolicySaveBtn'),
  regionPolicyCheckBtn: document.getElementById('regionPolicyCheckBtn'),
  regionPolicySummary: document.getElementById('regionPolicySummary'),
  teamRoleBadge: document.getElementById('teamRoleBadge'),
  teamOperatorIdInput: document.getElementById('teamOperatorIdInput'),
  teamOperatorNameInput: document.getElementById('teamOperatorNameInput'),
  teamOperatorSaveBtn: document.getElementById('teamOperatorSaveBtn'),
  teamOperatorClearBtn: document.getElementById('teamOperatorClearBtn'),
  teamRoleUserInput: document.getElementById('teamRoleUserInput'),
  teamRoleInput: document.getElementById('teamRoleInput'),
  teamRoleSaveBtn: document.getElementById('teamRoleSaveBtn'),
  teamStatusRefreshBtn: document.getElementById('teamStatusRefreshBtn'),
  teamStatusSummary: document.getElementById('teamStatusSummary'),
  teamRolesRefreshBtn: document.getElementById('teamRolesRefreshBtn'),
  teamRolesTable: document.getElementById('teamRolesTable'),
  teamInviteRoleInput: document.getElementById('teamInviteRoleInput'),
  teamInviteExpiresInput: document.getElementById('teamInviteExpiresInput'),
  teamInviteCreateBtn: document.getElementById('teamInviteCreateBtn'),
  teamInviteRefreshBtn: document.getElementById('teamInviteRefreshBtn'),
  teamInviteAcceptTokenInput: document.getElementById('teamInviteAcceptTokenInput'),
  teamInviteAcceptUserInput: document.getElementById('teamInviteAcceptUserInput'),
  teamInviteAcceptBtn: document.getElementById('teamInviteAcceptBtn'),
  teamInviteSummary: document.getElementById('teamInviteSummary'),
  teamInvitesTable: document.getElementById('teamInvitesTable')
};

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const APPROVAL_ROLES = new Set(['operator', 'owner']);

function currentWorkspaceRole() {
  return String((state.team && state.team.role) || '').trim().toLowerCase();
}

function canResolveApprovals() {
  return APPROVAL_ROLES.has(currentWorkspaceRole());
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
  if (!state.settings.lang) {
    const nav = String((navigator.language || 'en')).toLowerCase();
    state.settings.lang = nav.startsWith('hi') ? 'hi' : 'en';
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
  if (els.settingLang) els.settingLang.value = String(state.settings.lang || 'en');
  if (els.settingGatewayApiKey) els.settingGatewayApiKey.value = String(state.settings.gatewayApiKey || '');
  document.body.classList.toggle('compact-mode', Boolean(state.settings.compactMode));

  const activeTheme = resolvedTheme(state.settings.themeMode || 'dark');
  document.documentElement.setAttribute('data-theme', activeTheme);
  if (els.themeToggleBtn) {
    els.themeToggleBtn.textContent = `Theme: ${activeTheme === 'dark' ? 'Dark' : 'Light'}`;
  }
  if (els.sendBtn && !state.sending) {
    els.sendBtn.textContent = st('send');
  }
  if (state.activeView) {
    setActiveView(state.activeView);
  }
  renderWabaCards();
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
  const headers = {
    'Content-Type': 'application/json'
  };
  const gatewayApiKey = String(state.settings.gatewayApiKey || '').trim();
  if (gatewayApiKey) headers['X-Gateway-Key'] = gatewayApiKey;
  if (state.sessionId) headers['X-Session-Id'] = state.sessionId;
  if (options.headers && typeof options.headers === 'object') {
    Object.assign(headers, options.headers);
  }
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  setTopLatency(Date.now() - startedAt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

function setWsState(mode, text) {
  if (!els.wsLiveBadge) return;
  els.wsLiveBadge.textContent = text || mode;
  els.wsLiveBadge.classList.remove('status-live', 'status-error', 'status-idle');
  els.wsLiveBadge.classList.add(mode === 'live' ? 'status-live' : mode === 'error' ? 'status-error' : 'status-idle');
}

function pushLiveLog(line) {
  const entry = `${new Date().toLocaleTimeString()} ${line}`;
  state.liveLogs.push(entry);
  if (state.liveLogs.length > 120) state.liveLogs.shift();
  if (!els.liveLogs) return;
  els.liveLogs.innerHTML = state.liveLogs.slice(-40)
    .map((x) => `<div class="live-log-line">${escapeHtml(x)}</div>`)
    .join('');
  els.liveLogs.scrollTop = els.liveLogs.scrollHeight;
}

function riskFromTool(tool) {
  const t = String(tool || '').toLowerCase();
  if (t.includes('delete') || t.includes('approve') || t.includes('whatsapp')) return 'high';
  if (t.includes('post') || t.includes('campaign') || t.includes('create')) return 'medium';
  return 'low';
}

function renderPlanCard(actions) {
  const rows = Array.isArray(actions) ? actions : [];
  state.currentPlan = rows;
  if (!els.planCard || !els.planSteps || !els.planStepCount) return;
  if (!rows.length) {
    els.planCard.classList.add('hidden');
    els.planSteps.innerHTML = '';
    els.planStepCount.textContent = '0 steps';
    return;
  }
  els.planCard.classList.remove('hidden');
  els.planStepCount.textContent = `${rows.length} step${rows.length > 1 ? 's' : ''}`;
  els.planSteps.innerHTML = rows.map((step, idx) => {
    const risk = String(step.risk || riskFromTool(step.tool || '')).toLowerCase();
    const riskClass = risk === 'high' ? 'risk-high' : risk === 'medium' ? 'risk-medium' : 'risk-low';
    return [
      '<div class="plan-step">',
      `<span>${idx + 1}. ${escapeHtml(step.description || step.tool || 'action')}</span>`,
      `<span class="risk-badge ${riskClass}">${risk.toUpperCase()}</span>`,
      '</div>'
    ].join('');
  }).join('');
}

function renderPostsView(payload = {}) {
  if (!els.postsTable) return;
  const rows = [...(payload.executed || [])].slice(-12).reverse();
  if (!rows.length) {
    els.postsTable.innerHTML = '<p class="muted">No post/campaign execution history yet.</p>';
    return;
  }
  const html = [
    '<table>',
    '<thead><tr><th>Tool</th><th>Status</th><th>Summary</th></tr></thead>',
    '<tbody>',
    ...rows.map((row) => `<tr><td>${escapeHtml(row.tool || '-')}</td><td>${row.success ? 'posted' : 'failed'}</td><td>${escapeHtml(short(row.summary || row.error || '-', 80))}</td></tr>`),
    '</tbody></table>'
  ].join('');
  els.postsTable.innerHTML = html;
}

function renderAnalytics(payload = {}) {
  const history = Array.isArray(payload.history) ? payload.history : [];
  const pending = Array.isArray(payload.pendingActions) ? payload.pendingActions.length : 0;
  const executed = Array.isArray(payload.executed) ? payload.executed.length : 0;
  if (els.analyticsReach) els.analyticsReach.textContent = String(Math.max(0, executed * 240));
  if (els.analyticsEngagement) els.analyticsEngagement.textContent = `${Math.max(2, executed * 3)}%`;
  if (els.analyticsMessages) els.analyticsMessages.textContent = String(history.length);
  if (els.analyticsRate) els.analyticsRate.textContent = pending > 3 ? 'elevated' : 'healthy';
  if (!els.analyticsSparkline) return;
  const points = [];
  const n = 14;
  for (let i = 0; i < n; i += 1) {
    const v = history[Math.max(0, history.length - n + i)];
    const y = v ? 12 + ((i * 9 + String(v.role || '').length * 4) % 42) : 45;
    const x = Math.round((i / (n - 1)) * 240);
    points.push(`${x},${y}`);
  }
  els.analyticsSparkline.innerHTML = `<polyline fill="none" stroke="#06b6d4" stroke-width="2" points="${points.join(' ')}"></polyline>`;
}

function connectWs() {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${scheme}://${window.location.host}/ws`;
  setWsState('idle', 'ws connecting');
  try {
    const ws = new WebSocket(wsUrl);
    state.ws = ws;
    ws.onopen = () => {
      state.wsConnected = true;
      setWsState('live', 'ws live');
      pushLiveLog('Connected to live stream.');
    };
    ws.onclose = () => {
      state.wsConnected = false;
      setWsState('idle', 'ws reconnect');
      setTimeout(connectWs, 1500);
    };
    ws.onerror = () => {
      setWsState('error', 'ws error');
    };
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data || '{}');
        if (data.type === 'output') pushLiveLog(String(data.data || ''));
        if (data.type === 'error') pushLiveLog(`ERROR: ${data.message || 'unknown'}`);
        if (data.type === 'plan') renderPlanCard(data.steps || []);
        if (data.type === 'step_start') pushLiveLog(`-> Step ${data.step} started`);
        if (data.type === 'step_done') pushLiveLog(`${data.success ? '[OK]' : '[ERR]'} Step ${data.step}: ${data.summary || ''}`);
      } catch {
        // ignore malformed payloads
      }
    };
  } catch {
    setWsState('error', 'ws unavailable');
  }
}

function doctorStateClass(ok) {
  if (ok === true) return 'doctor-ok';
  if (ok === false) return 'doctor-fail';
  return 'doctor-skip';
}

function doctorStateText(ok) {
  if (ok === true) return st('doctor_pass');
  if (ok === false) return st('doctor_fail');
  return st('doctor_skip');
}

function renderWabaCards() {
  const integration = state.waba.integration || {};
  const doctor = state.waba.doctor || {};
  if (els.wabaConnectBadge) {
    const connected = Boolean(integration.connected);
    els.wabaConnectBadge.classList.remove('badge-ok', 'badge-warn');
    els.wabaConnectBadge.classList.add(connected ? 'badge-ok' : 'badge-warn');
    els.wabaConnectBadge.textContent = connected ? st('waba_connected') : st('waba_not_connected');
  }
  if (els.wabaBusinessIdInput && !els.wabaBusinessIdInput.value) els.wabaBusinessIdInput.value = integration.businessId || '';
  if (els.wabaWabaIdInput && !els.wabaWabaIdInput.value) els.wabaWabaIdInput.value = integration.wabaId || '';
  if (els.wabaPhoneNumberIdInput && !els.wabaPhoneNumberIdInput.value) els.wabaPhoneNumberIdInput.value = integration.phoneNumberId || '';
  if (els.wabaWebhookCallbackInput && !els.wabaWebhookCallbackInput.value) els.wabaWebhookCallbackInput.value = integration.webhookCallbackUrl || '';
  if (els.wabaWebhookVerifyTokenInput && !els.wabaWebhookVerifyTokenInput.value) els.wabaWebhookVerifyTokenInput.value = integration.webhookVerifyToken || '';
  if (!els.wabaDoctorCards) return;
  const checks = Array.isArray(doctor.checks) ? doctor.checks : [];
  if (!checks.length) {
    els.wabaDoctorCards.innerHTML = `<p class="muted">${escapeHtml(st('waba_no_checks'))}</p>`;
    return;
  }
  els.wabaDoctorCards.innerHTML = checks.map((c) => `
    <article class="doctor-card">
      <div class="doctor-card-key">${escapeHtml(c.key || '')}</div>
      <div class="doctor-card-state ${doctorStateClass(c.ok)}">${doctorStateText(c.ok)}</div>
      <div class="doctor-card-detail">${escapeHtml(c.detail || '')}</div>
    </article>
  `).join('');
}

async function refreshWabaStatus() {
  try {
    const res = await api('/api/integrations/waba/status?doctor=1');
    state.waba.integration = res.integration || null;
    state.waba.doctor = res.doctor || null;
    renderWabaCards();
  } catch (error) {
    appendMessage('system', st('waba_status_error', { error: error.message }));
  }
}

async function connectWabaFromUi() {
  const body = {
    token: String((els.wabaTokenInput && els.wabaTokenInput.value) || '').trim(),
    businessId: String((els.wabaBusinessIdInput && els.wabaBusinessIdInput.value) || '').trim(),
    wabaId: String((els.wabaWabaIdInput && els.wabaWabaIdInput.value) || '').trim(),
    phoneNumberId: String((els.wabaPhoneNumberIdInput && els.wabaPhoneNumberIdInput.value) || '').trim(),
    webhookCallbackUrl: String((els.wabaWebhookCallbackInput && els.wabaWebhookCallbackInput.value) || '').trim(),
    webhookVerifyToken: String((els.wabaWebhookVerifyTokenInput && els.wabaWebhookVerifyTokenInput.value) || '').trim(),
    testTo: String((els.wabaTestToInput && els.wabaTestToInput.value) || '').trim()
  };
  try {
    const res = await api('/api/integrations/waba/connect', { method: 'POST', body });
    state.waba.integration = res.integration || null;
    state.waba.doctor = res.doctor || null;
    renderWabaCards();
    appendMessage('system', res.integration?.connected ? st('waba_connect_ready') : st('waba_connect_partial'));
  } catch (error) {
    appendMessage('system', st('waba_connect_failed', { error: error.message }));
  }
}

async function disconnectWabaFromUi() {
  try {
    await api('/api/integrations/waba/disconnect', {
      method: 'POST',
      body: { clearToken: false }
    });
    state.waba.integration = null;
    state.waba.doctor = null;
    if (els.wabaTokenInput) els.wabaTokenInput.value = '';
    if (els.wabaBusinessIdInput) els.wabaBusinessIdInput.value = '';
    if (els.wabaWabaIdInput) els.wabaWabaIdInput.value = '';
    if (els.wabaPhoneNumberIdInput) els.wabaPhoneNumberIdInput.value = '';
    if (els.wabaWebhookCallbackInput) els.wabaWebhookCallbackInput.value = '';
    if (els.wabaWebhookVerifyTokenInput) els.wabaWebhookVerifyTokenInput.value = '';
    if (els.wabaTestToInput) els.wabaTestToInput.value = '';
    renderWabaCards();
    appendMessage('system', st('waba_disconnected'));
  } catch (error) {
    appendMessage('system', st('waba_disconnect_failed', { error: error.message }));
  }
}

function renderRegionPolicy() {
  const region = state.regionPolicy.region || {};
  const report = state.regionPolicy.preflight || null;
  if (els.regionCountryInput && !els.regionCountryInput.value) els.regionCountryInput.value = region.country || '';
  if (els.regionTimezoneInput && !els.regionTimezoneInput.value) els.regionTimezoneInput.value = region.timezone || '';
  if (els.regionModeInput) els.regionModeInput.value = region.regulatoryMode || 'standard';
  if (els.regionPolicyBadge) {
    let cls = 'badge-warn';
    let label = 'CHECK NEEDED';
    if (report) {
      if (report.summary && Number(report.summary.blockers || 0) > 0) {
        cls = 'badge-error';
        label = 'BLOCKED';
      } else if (report.summary && Number(report.summary.warnings || 0) > 0) {
        cls = 'badge-warn';
        label = 'WARNINGS';
      } else {
        cls = 'badge-ok';
        label = 'READY';
      }
    }
    els.regionPolicyBadge.classList.remove('badge-ok', 'badge-warn', 'badge-error');
    els.regionPolicyBadge.classList.add(cls);
    els.regionPolicyBadge.textContent = label;
  }
  if (els.regionPolicySummary) {
    if (!report) {
      els.regionPolicySummary.textContent = 'No policy check yet.';
    } else if (report.summary.blockers > 0) {
      els.regionPolicySummary.textContent = `Blocked: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s).`;
    } else if (report.summary.warnings > 0) {
      els.regionPolicySummary.textContent = `Caution: ${report.summary.warnings} warning(s).`;
    } else {
      els.regionPolicySummary.textContent = 'Policy preflight passed.';
    }
  }
}

async function refreshRegionPolicyStatus() {
  try {
    const res = await api('/api/status');
    state.regionPolicy.region = (res.config && res.config.region) || null;
    renderRegionPolicy();
  } catch (error) {
    appendMessage('system', `Region policy status error: ${error.message}`);
  }
}

async function saveRegionPolicy() {
  const body = {
    country: String((els.regionCountryInput && els.regionCountryInput.value) || '').trim().toUpperCase(),
    timezone: String((els.regionTimezoneInput && els.regionTimezoneInput.value) || '').trim(),
    regulatoryMode: String((els.regionModeInput && els.regionModeInput.value) || 'standard').trim().toLowerCase()
  };
  try {
    const res = await api('/api/policy/region', { method: 'POST', body });
    state.regionPolicy.region = res.region || null;
    renderRegionPolicy();
    appendMessage('system', 'Region policy settings saved.');
  } catch (error) {
    appendMessage('system', `Region policy save failed: ${error.message}`);
  }
}

async function runRegionPreflight() {
  try {
    const res = await api('/api/policy/preflight', {
      method: 'POST',
      body: { intent: 'send whatsapp promo message' }
    });
    state.regionPolicy.preflight = res.report || null;
    renderRegionPolicy();
  } catch (error) {
    appendMessage('system', `Region preflight failed: ${error.message}`);
  }
}

function renderTeamStatus() {
  const operator = state.team.operator || { id: '', name: '' };
  const role = String(state.team.role || '').trim();
  if (els.teamOperatorIdInput && !els.teamOperatorIdInput.value) els.teamOperatorIdInput.value = operator.id || '';
  if (els.teamOperatorNameInput && !els.teamOperatorNameInput.value) els.teamOperatorNameInput.value = operator.name || '';
  if (els.teamRoleUserInput && !els.teamRoleUserInput.value) els.teamRoleUserInput.value = operator.id || '';
  if (els.teamRoleBadge) {
    els.teamRoleBadge.classList.remove('badge-ok', 'badge-warn');
    if (role) {
      els.teamRoleBadge.classList.add('badge-ok');
      els.teamRoleBadge.textContent = `ROLE: ${role.toUpperCase()}`;
    } else {
      els.teamRoleBadge.classList.add('badge-warn');
      els.teamRoleBadge.textContent = 'ROLE UNKNOWN';
    }
  }
  if (els.teamStatusSummary) {
    const id = operator.id || '(not set)';
    const name = operator.name ? ` (${operator.name})` : '';
    els.teamStatusSummary.textContent = `Active operator: ${id}${name} | workspace role: ${role || '(unknown)'}`;
  }
  if (els.opsApproveLowBtn) {
    const allowed = canResolveApprovals();
    els.opsApproveLowBtn.disabled = !allowed;
    els.opsApproveLowBtn.title = allowed ? '' : 'Requires operator/owner role';
  }
  renderOpsApprovals(state.opsSnapshot?.approvals || []);
}

function renderTeamActivity() {
  if (!els.teamActivityTable) return;
  const rows = Array.isArray(state.team.activity) ? state.team.activity : [];
  if (!rows.length) {
    els.teamActivityTable.innerHTML = '<p class="empty-note">No team activity yet.</p>';
    return;
  }
  const html = [
    '<table class="mini-table">',
    '<thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Status</th><th>Summary</th></tr></thead>',
    '<tbody>',
    ...rows.map((x) => `<tr><td>${escapeHtml(fmtTime(x.createdAt))}</td><td>${escapeHtml(x.actor || '')}</td><td>${escapeHtml(x.action || '')}</td><td>${escapeHtml(x.status || '')}</td><td>${escapeHtml(short(x.summary || '', 110))}</td></tr>`),
    '</tbody></table>'
  ].join('');
  els.teamActivityTable.innerHTML = html;
}

function renderTeamRoles() {
  if (!els.teamRolesTable) return;
  const rows = Array.isArray(state.team.roles) ? state.team.roles : [];
  if (!rows.length) {
    els.teamRolesTable.innerHTML = '<p class="empty-note">No roles found for this workspace.</p>';
    return;
  }
  const body = rows.map((x) => `
    <tr>
      <td>${escapeHtml(x.user || '')}</td>
      <td>${escapeHtml(x.scope || '')}</td>
      <td>
        <select class="setting-select js-team-role-row-select" data-user="${escapeHtml(x.user || '')}">
          ${['viewer', 'analyst', 'operator', 'owner'].map((r) => `<option value="${r}" ${String(x.role || '') === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
      <td>
        <button class="ghost-btn small js-team-role-row-save" data-user="${escapeHtml(x.user || '')}">Save</button>
      </td>
    </tr>
  `).join('');
  els.teamRolesTable.innerHTML = `
    <table class="mini-table">
      <thead><tr><th>User</th><th>Scope</th><th>Role</th><th>Action</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderTeamInvites() {
  if (!els.teamInvitesTable) return;
  const rows = Array.isArray(state.team.invites) ? state.team.invites : [];
  if (els.teamInviteSummary) {
    els.teamInviteSummary.textContent = rows.length
      ? `Loaded ${rows.length} invite(s).`
      : 'No invites for this workspace.';
  }
  if (!rows.length) {
    els.teamInvitesTable.innerHTML = '<p class="empty-note">No invites yet.</p>';
    return;
  }
  const body = rows.map((x) => `
    <tr>
      <td>${escapeHtml(x.role || '')}</td>
      <td>${escapeHtml(x.status || '')}</td>
      <td>${escapeHtml(fmtTime(x.expiresAt))}</td>
      <td class="mono">${escapeHtml(short(x.token || '', 24))}</td>
      <td>
        <button class="ghost-btn small js-team-invite-copy" data-token="${escapeHtml(x.token || '')}">Copy Accept</button>
        <button class="ghost-btn small js-team-invite-copy-link" data-link="${escapeHtml(String(x.acceptUrl || (x.token ? `${window.location.origin}/?invite=${encodeURIComponent(x.token)}` : '')))}">Copy Link</button>
        ${String(x.status || '') === 'active' ? `<button class="ghost-btn small js-team-invite-revoke" data-id="${escapeHtml(x.id || '')}">Revoke</button>` : ''}
      </td>
    </tr>
  `).join('');
  els.teamInvitesTable.innerHTML = `
    <table class="mini-table">
      <thead><tr><th>Role</th><th>Status</th><th>Expires</th><th>Token</th><th>Actions</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

async function refreshTeamStatus() {
  try {
    const res = await api('/api/team/status');
    state.team.operator = res.operator || null;
    state.team.role = String(res.role || '');
    renderTeamStatus();
    await refreshTeamRoles();
  } catch (error) {
    appendMessage('system', `Team status error: ${error.message}`);
  }
}

async function setTeamOperatorFromUi() {
  const id = String((els.teamOperatorIdInput && els.teamOperatorIdInput.value) || '').trim();
  const name = String((els.teamOperatorNameInput && els.teamOperatorNameInput.value) || '').trim();
  try {
    const res = await api('/api/team/operator', {
      method: 'POST',
      body: { id, name }
    });
    state.team.operator = res.operator || null;
    state.team.role = String(res.role || '');
    renderTeamStatus();
    appendMessage('system', `Active operator set: ${id}`);
  } catch (error) {
    appendMessage('system', `Set operator failed: ${error.message}`);
  }
}

async function clearTeamOperatorFromUi() {
  try {
    await api('/api/team/operator/clear', { method: 'POST', body: {} });
    state.team.operator = { id: '', name: '' };
    state.team.role = '';
    if (els.teamOperatorIdInput) els.teamOperatorIdInput.value = '';
    if (els.teamOperatorNameInput) els.teamOperatorNameInput.value = '';
    renderTeamStatus();
    appendMessage('system', 'Active operator cleared.');
  } catch (error) {
    appendMessage('system', `Clear operator failed: ${error.message}`);
  }
}

async function setTeamRoleFromUi() {
  const user = String((els.teamRoleUserInput && els.teamRoleUserInput.value) || '').trim();
  const role = String((els.teamRoleInput && els.teamRoleInput.value) || '').trim();
  if (!user || !role) {
    appendMessage('system', 'Provide user and role first.');
    return;
  }
  try {
    await api('/api/team/role', {
      method: 'POST',
      body: { user, role, workspace: state.workspace }
    });
    appendMessage('system', `Role updated: ${user} => ${role}`);
    await refreshTeamStatus();
    await refreshTeamRoles();
  } catch (error) {
    appendMessage('system', `Set role failed: ${error.message}`);
  }
}

async function refreshTeamRoles() {
  try {
    const ws = encodeURIComponent(state.workspace || 'default');
    const res = await api(`/api/team/roles?workspace=${ws}`);
    state.team.roles = Array.isArray(res.roles) ? res.roles : [];
    renderTeamRoles();
  } catch (error) {
    appendMessage('system', `Team roles error: ${error.message}`);
  }
}

async function refreshTeamInvites() {
  try {
    const ws = encodeURIComponent(state.workspace || 'default');
    const res = await api(`/api/team/invites?workspace=${ws}`);
    state.team.invites = Array.isArray(res.invites) ? res.invites : [];
    renderTeamInvites();
  } catch (error) {
    appendMessage('system', `Team invites error: ${error.message}`);
  }
}

async function createTeamInviteFromUi() {
  const role = String((els.teamInviteRoleInput && els.teamInviteRoleInput.value) || 'viewer').trim();
  const expiresInHours = Number((els.teamInviteExpiresInput && els.teamInviteExpiresInput.value) || 72);
  const res = await api('/api/team/invites', {
    method: 'POST',
    body: { workspace: state.workspace, role, expiresInHours, baseUrl: window.location.origin }
  });
  appendMessage('system', `Invite created (${role}).`);
  state.team.invites = Array.isArray(res.invites) ? res.invites : state.team.invites;
  renderTeamInvites();
}

function prefillInviteFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const token = String(params.get('invite') || '').trim();
    if (token && els.teamInviteAcceptTokenInput && !els.teamInviteAcceptTokenInput.value) {
      els.teamInviteAcceptTokenInput.value = token;
      appendMessage('system', 'Invite token detected from URL. Enter user ID and click Accept Invite.');
    }
  } catch {
    // no-op
  }
}

async function acceptTeamInviteFromUi() {
  const token = String((els.teamInviteAcceptTokenInput && els.teamInviteAcceptTokenInput.value) || '').trim();
  const user = String((els.teamInviteAcceptUserInput && els.teamInviteAcceptUserInput.value) || '').trim();
  if (!token || !user) {
    appendMessage('system', 'Provide invite token and user ID.');
    return;
  }
  const res = await api('/api/team/invites/accept', {
    method: 'POST',
    body: { token, user }
  });
  appendMessage('system', `Invite accepted: ${res.invite.workspace} -> ${res.invite.role} (${user})`);
  if (els.teamInviteAcceptTokenInput) els.teamInviteAcceptTokenInput.value = '';
  await refreshTeamStatus();
  await refreshTeamRoles();
  await refreshTeamInvites();
}

async function refreshTeamActivity() {
  const actor = String((els.teamActivityActorInput && els.teamActivityActorInput.value) || '').trim();
  const q = actor ? `?actor=${encodeURIComponent(actor)}&limit=50` : '?limit=50';
  try {
    const res = await api(`/api/team/activity${q}`);
    state.team.activity = Array.isArray(res.activity) ? res.activity : [];
    renderTeamActivity();
  } catch (error) {
    appendMessage('system', `Team activity error: ${error.message}`);
  }
}

function exportTeamActivity(format = 'json') {
  const actor = String((els.teamActivityActorInput && els.teamActivityActorInput.value) || '').trim();
  const params = new URLSearchParams();
  params.set('workspace', state.workspace || 'default');
  params.set('format', format === 'csv' ? 'csv' : 'json');
  params.set('limit', '500');
  if (actor) params.set('actor', actor);

  const a = document.createElement('a');
  a.href = `/api/team/activity/export?${params.toString()}`;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function generateHandoffPackFromUi() {
  const template = String((els.handoffPackTemplateInput && els.handoffPackTemplateInput.value) || 'agency').trim().toLowerCase();
  const outDirRaw = String((els.handoffPackOutDirInput && els.handoffPackOutDirInput.value) || '').trim();
  const outDir = outDirRaw || `handoff-${state.workspace || 'default'}`;
  const res = await api('/api/ops/handoff/pack', {
    method: 'POST',
    body: {
      workspace: state.workspace || 'default',
      template,
      outDir
    }
  });
  if (els.handoffPackOutput) {
    els.handoffPackOutput.textContent = JSON.stringify(res, null, 2);
  }
  if (els.handoffPackFiles) {
    const files = res.files && typeof res.files === 'object' ? res.files : {};
    const rows = Object.entries(files).map(([key, value]) => `
      <tr>
        <td>${escapeHtml(key)}</td>
        <td class="mono">${escapeHtml(String(value || ''))}</td>
        <td>
          <button class="ghost-btn small js-download-pack-file" data-path="${escapeHtml(String(value || ''))}">Download</button>
          <button class="ghost-btn small js-copy-pack-path" data-path="${escapeHtml(String(value || ''))}">Copy Path</button>
        </td>
      </tr>
    `).join('');
    if (rows) {
      els.handoffPackFiles.innerHTML = `
        <table class="mini-table">
          <thead><tr><th>File</th><th>Path</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else {
      els.handoffPackFiles.innerHTML = '<p class="empty-note">No files returned.</p>';
    }
  }
  appendMessage('system', `Handoff pack generated: ${res.outDir}`);
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
  els.sendBtn.textContent = isSending ? st('sending') : st('send');
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

  renderPlanCard(p.pendingActions || []);
  renderPostsView(p);
  renderAnalytics(p);
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
    const blocked = !canResolveApprovals();
    const disabled = blocked ? 'disabled title="Requires operator/owner role"' : '';
    return [
      `<button class="ghost-btn small js-ops-approve" data-id="${escapeHtml(row.id)}" ${disabled}>Approve</button>`,
      `<button class="ghost-btn small js-ops-reject" data-id="${escapeHtml(row.id)}" ${disabled}>Reject</button>`
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
      <td>${escapeHtml(a.requestedBy || '')}</td>
      <td>${escapeHtml(a.decidedBy || '')}</td>
      <td>${opsActionButtons('approval', a)}</td>
    </tr>
  `).join('');
  els.opsApprovalsTable.innerHTML = `
    <table class="mini-table">
      <thead><tr><th>Risk</th><th>Title</th><th>Reason</th><th>Requested By</th><th>Resolved By</th><th>Decision</th></tr></thead>
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
    await refreshTeamActivity();
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
  if (!canResolveApprovals()) {
    appendMessage('system', `Role "${currentWorkspaceRole() || 'viewer'}" cannot resolve approvals. Use operator/owner.`);
    return;
  }
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
  if (!canResolveApprovals()) {
    appendMessage('system', `Role "${currentWorkspaceRole() || 'viewer'}" cannot approve low-risk actions.`);
    return;
  }
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
    chat: { tag: st('view_chat_tag'), title: st('view_chat_title') },
    posts: { tag: st('view_posts_tag'), title: st('view_posts_title') },
    analytics: { tag: st('view_analytics_tag'), title: st('view_analytics_title') },
    data: { tag: 'Data Console', title: 'Inspect live conversation and execution trails.' },
    ops: { tag: 'Ops Center', title: 'Run workflows, resolve approvals, and clear alerts.' },
    config: { tag: 'Config', title: 'Runtime profile, defaults, and token state.' },
    devtools: { tag: 'Developer Toolkit', title: 'Commands, providers, and integration shortcuts.' },
    help: { tag: 'Help', title: 'Prompt patterns for developer and marketing flows.' },
    settings: { tag: st('view_settings_tag'), title: st('view_settings_title') }
  };
  const copy = titles[view] || titles.chat;
  if (els.viewTag) els.viewTag.textContent = copy.tag;
  if (els.viewTitle) els.viewTitle.textContent = copy.title;

  els.sideNavItems.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (Array.isArray(els.topTabs)) {
    els.topTabs.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
  }
  els.viewPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `view-${view}`);
  });
  if (view === 'data') renderDataConsole(state.latestPayload);
  if (view === 'posts') renderPostsView(state.latestPayload);
  if (view === 'analytics') renderAnalytics(state.latestPayload);
  if (view === 'ops') refreshOps();
  if (view === 'ops') refreshTeamActivity();
  if (view === 'config') refreshConfig();
  if (view === 'settings') refreshTeamStatus();
  if (view === 'settings') refreshTeamInvites();
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
    const res = await api('/api/ai', {
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
    if (Array.isArray(res.response?.actions) && res.response.actions.length) {
      renderPlanCard(res.response.actions);
      pushLiveLog(`Plan generated: ${res.response.actions.length} step(s)`);
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

async function executeCurrentPlan(dryRun = false) {
  const steps = Array.isArray(state.currentPlan) ? state.currentPlan : [];
  if (!steps.length) {
    appendMessage('system', st('no_plan'));
    return;
  }
  if (dryRun) {
    appendMessage('system', `Dry run: ${steps.length} step(s) validated. No action executed.`);
    pushLiveLog('Dry run complete.');
    return;
  }
  pushLiveLog('Executing plan...');
  try {
    const res = await api('/api/execute', {
      method: 'POST',
      body: {
        sessionId: state.sessionId,
        plan: { steps }
      }
    });
    appendMessage('agent', `Execution complete. ${Array.isArray(res.executed) ? res.executed.length : 0} step(s) processed.`);
    state.latestPayload = {
      ...state.latestPayload,
      executed: Array.isArray(res.executed) ? res.executed : state.latestPayload.executed,
      history: Array.isArray(res.history) ? res.history : state.latestPayload.history,
      summary: res.summary || state.latestPayload.summary
    };
    updateKpis(state.latestPayload);
    renderDataConsole(state.latestPayload);
    pushLiveLog('Execution finished.');
  } catch (error) {
    appendMessage('system', `Execution failed: ${error.message}`);
    pushLiveLog(`Execution error: ${error.message}`);
  }
}

function openCommandPalette() {
  const quick = window.prompt('Command palette: type chat/posts/analytics/settings/new');
  const cmd = String(quick || '').trim().toLowerCase();
  if (!cmd) return;
  if (cmd === 'new') {
    startSession('');
    return;
  }
  const allowed = new Set(['chat', 'posts', 'analytics', 'settings', 'data', 'ops']);
  if (allowed.has(cmd)) {
    setActiveView(cmd);
    return;
  }
  appendMessage('system', st('unknown_palette', { cmd }));
}

function wireEvents() {
  els.sendBtn.addEventListener('click', sendMessage);
  els.messageInput.addEventListener('keydown', (evt) => {
    const isCmdEnter = evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey);
    if ((evt.key === 'Enter' && !evt.shiftKey && state.settings.enterToSend) || isCmdEnter) {
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
  if (Array.isArray(els.topTabs)) {
    els.topTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveView(btn.dataset.view || 'chat');
      });
    });
  }
  if (els.executePlanBtn) {
    els.executePlanBtn.addEventListener('click', () => {
      void executeCurrentPlan(false);
    });
  }
  if (els.dryRunPlanBtn) {
    els.dryRunPlanBtn.addEventListener('click', () => {
      void executeCurrentPlan(true);
    });
  }
  if (els.editPlanBtn) {
    els.editPlanBtn.addEventListener('click', () => {
      appendMessage('system', 'Edit plan: send an updated instruction and I will replace the pending plan.');
      els.messageInput.focus();
    });
  }
  if (els.rollbackBtn) {
    els.rollbackBtn.addEventListener('click', () => {
      appendMessage('system', 'Rollback stub: capture idempotency key and run `social replay <id>` as needed.');
    });
  }

  document.addEventListener('keydown', (evt) => {
    if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'k') {
      evt.preventDefault();
      openCommandPalette();
      return;
    }
    if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'n') {
      evt.preventDefault();
      void startSession('');
      return;
    }
    if ((evt.metaKey || evt.ctrlKey) && ['1', '2', '3', '4'].includes(evt.key)) {
      evt.preventDefault();
      const map = { '1': 'chat', '2': 'posts', '3': 'analytics', '4': 'settings' };
      setActiveView(map[evt.key] || 'chat');
    }
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
        if (!canResolveApprovals()) {
          appendMessage('system', `Role "${currentWorkspaceRole() || 'viewer'}" cannot resolve approvals.`);
          return;
        }
        await resolveApprovalById(id, 'approve');
      } else if (btn.classList.contains('js-ops-reject')) {
        if (!canResolveApprovals()) {
          appendMessage('system', `Role "${currentWorkspaceRole() || 'viewer'}" cannot resolve approvals.`);
          return;
        }
        await resolveApprovalById(id, 'reject');
      } else if (btn.classList.contains('js-source-sync')) {
        await syncSources([id]);
      } else if (btn.classList.contains('js-copy-pack-path')) {
        const value = String(btn.getAttribute('data-path') || '').trim();
        if (!value) return;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(value);
          appendMessage('system', 'Path copied.');
        } else {
          appendMessage('system', `Copy manually: ${value}`);
        }
      } else if (btn.classList.contains('js-download-pack-file')) {
        const value = String(btn.getAttribute('data-path') || '').trim();
        if (!value) return;
        const href = `/api/ops/handoff/file?path=${encodeURIComponent(value)}`;
        const a = document.createElement('a');
        a.href = href;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (btn.classList.contains('js-team-role-row-save')) {
        const user = String(btn.getAttribute('data-user') || '').trim();
        if (!user) return;
        const select = document.querySelector(`.js-team-role-row-select[data-user="${CSS.escape(user)}"]`);
        const role = String((select && select.value) || '').trim();
        if (!role) return;
        await api('/api/team/role', {
          method: 'POST',
          body: { workspace: state.workspace, user, role }
        });
        appendMessage('system', `Role updated: ${user} => ${role}`);
        await refreshTeamRoles();
        await refreshTeamStatus();
      } else if (btn.classList.contains('js-team-invite-copy')) {
        const token = String(btn.getAttribute('data-token') || '').trim();
        if (!token) return;
        const cmd = `social ops invite accept ${token} --user <user-id>`;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(cmd);
          appendMessage('system', 'Invite accept command copied.');
        } else {
          appendMessage('system', cmd);
        }
      } else if (btn.classList.contains('js-team-invite-revoke')) {
        const id = String(btn.getAttribute('data-id') || '').trim();
        if (!id) return;
        await api('/api/team/invites/revoke', {
          method: 'POST',
          body: { workspace: state.workspace, id }
        });
        appendMessage('system', `Invite revoked: ${id}`);
        await refreshTeamInvites();
      } else if (btn.classList.contains('js-team-invite-copy-link')) {
        const link = String(btn.getAttribute('data-link') || '').trim();
        if (!link) return;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(link);
          appendMessage('system', 'Invite link copied.');
        } else {
          appendMessage('system', link);
        }
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

  if (els.settingLang) {
    els.settingLang.addEventListener('change', () => {
      state.settings.lang = String(els.settingLang.value || 'en');
      applySettings();
      persistSettings();
    });
  }

  if (els.settingGatewayApiKey) {
    els.settingGatewayApiKey.addEventListener('change', () => {
      state.settings.gatewayApiKey = String(els.settingGatewayApiKey.value || '').trim();
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

  if (els.wabaConnectBtn) {
    els.wabaConnectBtn.addEventListener('click', () => {
      void connectWabaFromUi();
    });
  }
  if (els.wabaStatusBtn) {
    els.wabaStatusBtn.addEventListener('click', () => {
      void refreshWabaStatus();
    });
  }
  if (els.wabaDisconnectBtn) {
    els.wabaDisconnectBtn.addEventListener('click', () => {
      void disconnectWabaFromUi();
    });
  }
  if (els.regionPolicySaveBtn) {
    els.regionPolicySaveBtn.addEventListener('click', () => {
      void saveRegionPolicy();
    });
  }
  if (els.regionPolicyCheckBtn) {
    els.regionPolicyCheckBtn.addEventListener('click', () => {
      void runRegionPreflight();
    });
  }
  if (els.teamOperatorSaveBtn) {
    els.teamOperatorSaveBtn.addEventListener('click', () => {
      void setTeamOperatorFromUi();
    });
  }
  if (els.teamOperatorClearBtn) {
    els.teamOperatorClearBtn.addEventListener('click', () => {
      void clearTeamOperatorFromUi();
    });
  }
  if (els.teamRoleSaveBtn) {
    els.teamRoleSaveBtn.addEventListener('click', () => {
      void setTeamRoleFromUi();
    });
  }
  if (els.teamStatusRefreshBtn) {
    els.teamStatusRefreshBtn.addEventListener('click', () => {
      void refreshTeamStatus();
    });
  }
  if (els.teamRolesRefreshBtn) {
    els.teamRolesRefreshBtn.addEventListener('click', () => {
      void refreshTeamRoles();
    });
  }
  if (els.teamInviteCreateBtn) {
    els.teamInviteCreateBtn.addEventListener('click', () => {
      void createTeamInviteFromUi();
    });
  }
  if (els.teamInviteRefreshBtn) {
    els.teamInviteRefreshBtn.addEventListener('click', () => {
      void refreshTeamInvites();
    });
  }
  if (els.teamInviteAcceptBtn) {
    els.teamInviteAcceptBtn.addEventListener('click', () => {
      void acceptTeamInviteFromUi();
    });
  }
  if (els.teamActivityRefreshBtn) {
    els.teamActivityRefreshBtn.addEventListener('click', () => {
      void refreshTeamActivity();
    });
  }
  if (els.teamActivityExportJsonBtn) {
    els.teamActivityExportJsonBtn.addEventListener('click', () => {
      exportTeamActivity('json');
    });
  }
  if (els.teamActivityExportCsvBtn) {
    els.teamActivityExportCsvBtn.addEventListener('click', () => {
      exportTeamActivity('csv');
    });
  }
  if (els.handoffPackGenerateBtn) {
    els.handoffPackGenerateBtn.addEventListener('click', () => {
      void generateHandoffPackFromUi();
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
  prefillInviteFromQuery();
  connectWs();
  await checkHealth();
  await refreshConfig();
  await startSession('');
  await refreshOps();
  await refreshWabaStatus();
  await refreshRegionPolicyStatus();
  await runRegionPreflight();
  await refreshTeamStatus();
  await refreshTeamInvites();
  await refreshTeamActivity();
  setActiveView('chat');
}

init().catch((error) => {
  appendMessage('system', st('failed_init', { error: error.message }));
});

const state = {
  sessionId: '',
  sending: false,
  activeView: 'chat',
  latestPayload: {
    history: [],
    pendingActions: [],
    executed: [],
    summary: {}
  },
  settings: {
    enterToSend: true,
    autoScroll: true,
    compactMode: false
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
  healthStatus: document.getElementById('healthStatus'),
  buildLabel: document.getElementById('buildLabel'),
  topPendingBadge: document.getElementById('topPendingBadge'),
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
  configDump: document.getElementById('configDump'),
  refreshConfigBtn: document.getElementById('refreshConfigBtn'),
  settingEnterSend: document.getElementById('settingEnterSend'),
  settingAutoScroll: document.getElementById('settingAutoScroll'),
  settingCompactMode: document.getElementById('settingCompactMode')
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
  document.body.classList.toggle('compact-mode', Boolean(state.settings.compactMode));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
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
  } catch (error) {
    els.configDump.textContent = `Failed to load config: ${error.message}`;
  }
}

function setActiveView(view) {
  state.activeView = view;
  const titles = {
    chat: { tag: 'Chat Agent', title: 'Talk naturally. Execute safely.' },
    data: { tag: 'Data Console', title: 'Inspect live conversation and execution trails.' },
    config: { tag: 'Config', title: 'Runtime profile, defaults, and token state.' },
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
    if (els.buildLabel) {
      els.buildLabel.textContent = `${service || 'unknown-service'} | v${version || '-'}`;
    }
    if (isLegacy) {
      appendMessage('system', 'Legacy gateway service detected. Run `social gateway --open` from the latest social-cli install.');
    }
  } catch (error) {
    els.healthStatus.textContent = `Offline: ${error.message}`;
    els.healthStatus.classList.add('warn');
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
}

async function init() {
  loadSettings();
  applySettings();
  wireEvents();
  await checkHealth();
  await startSession('');
  setActiveView('chat');
}

init().catch((error) => {
  appendMessage('system', `Failed to initialize: ${error.message}`);
});

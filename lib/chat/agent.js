const intentsSchema = require('../ai/intents.json');
const { aiParseIntent } = require('../ai/parser');
const { validateIntent } = require('../ai/validator');
const { executeIntent } = require('../ai/executor');
const { sanitizeForLog } = require('../api');
const {
  normalizeProvider,
  defaultModelForProvider,
  resolveApiKeyForProvider,
  hasProviderCredential,
  chatComplete
} = require('../llm-providers');
const { getToolRegistry } = require('../../tools/registry');
const { toolDescriptions, systemPrompt, buildUserPrompt, parseJsonPayload } = require('./prompt');
const { DEFAULT_CLARIFICATION_CHOICES, resolveIntentDecision } = require('./intent-engine');
const { confirmationPromptForRisk, highestRisk } = require('../ui/risk-policy');
const opsStorage = require('../ops/storage');
const opsWorkflows = require('../ops/workflows');
const opsRbac = require('../ops/rbac');

const CHAT_SPECIAL_TOOLS = [
  {
    name: 'ops.summary',
    risk: 'low',
    required: [],
    optional: ['workspace'],
    description: 'Read ops summary (alerts, approvals, schedules, leads, sources) for a workspace.'
  },
  {
    name: 'ops.morning_run',
    risk: 'medium',
    required: [],
    optional: ['workspace', 'spend', 'force'],
    description: 'Run morning ops workflow for a workspace.'
  },
  {
    name: 'ops.schedule.run_due',
    risk: 'medium',
    required: [],
    optional: ['workspace'],
    description: 'Run due ops schedules for a workspace.'
  },
  {
    name: 'ops.alerts.ack_token_missing',
    risk: 'low',
    required: [],
    optional: ['workspace'],
    description: 'Acknowledge all open token-missing alerts in a workspace.'
  },
  {
    name: 'ops.approvals.approve_low_risk',
    risk: 'high',
    required: [],
    optional: ['workspace'],
    description: 'Approve pending low-risk approvals in a workspace.'
  },
  {
    name: 'connector.sources.list',
    risk: 'low',
    required: [],
    optional: ['workspace', 'connector'],
    description: 'List knowledge sources/connectors for a workspace.'
  },
  {
    name: 'connector.sources.sync',
    risk: 'medium',
    required: [],
    optional: ['workspace', 'connector', 'sourceIds'],
    description: 'Sync connector sources in a workspace.'
  },
  {
    name: 'connector.integrations.show',
    risk: 'low',
    required: [],
    optional: ['workspace'],
    description: 'Show sanitized integration status for a workspace.'
  }
];

function resolveChatProvider(config) {
  const cfg = typeof config?.getAgentConfig === 'function' ? config.getAgentConfig() : {};
  return normalizeProvider(
    process.env.SOCIAL_CHAT_PROVIDER ||
    process.env.META_CHAT_PROVIDER ||
    process.env.SOCIAL_AI_PROVIDER ||
    process.env.META_AI_PROVIDER ||
    cfg.provider ||
    'openai'
  );
}

function resolveChatModel(provider, config) {
  const cfg = typeof config?.getAgentConfig === 'function' ? config.getAgentConfig() : {};
  return process.env.SOCIAL_CHAT_MODEL ||
    process.env.META_CHAT_MODEL ||
    process.env.SOCIAL_AI_MODEL ||
    process.env.META_AI_MODEL ||
    cfg.model ||
    defaultModelForProvider(provider);
}

function resolveChatApiKey(provider, config) {
  const cfg = typeof config?.getAgentConfig === 'function' ? config.getAgentConfig() : {};
  const configured = cfg.apiKey ||
    process.env.SOCIAL_CHAT_API_KEY ||
    process.env.META_CHAT_API_KEY ||
    process.env.SOCIAL_AI_KEY ||
    process.env.META_AI_KEY ||
    process.env.SOCIAL_AGENT_API_KEY ||
    process.env.META_AGENT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  return resolveApiKeyForProvider(provider, configured);
}

function isSmallTalk(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return true;
  return ['hi', 'hello', 'hey', 'thanks', 'thank you', 'cool', 'great', 'awesome'].includes(s);
}

function deriveSuggestionForAction(action) {
  if (action === 'post_facebook' || action === 'post_instagram') {
    return 'Want me to create a follow-up analytics check for tomorrow?';
  }
  if (action === 'post_whatsapp') {
    return 'Need me to prepare a follow-up template message too?';
  }
  if (action === 'query_insights' || action === 'get_analytics') {
    return 'I can also break this down by campaign status if you want.';
  }
  if (action === 'auth.status') {
    return 'Need me to debug a specific token after this?';
  }
  if (action === 'webhooks.list') {
    return 'I can verify callback and webhook subscription setup next.';
  }
  return 'I can keep going if you want another action.';
}

function uniq(items) {
  const out = [];
  const seen = new Set();
  (items || []).forEach((x) => {
    const v = String(x || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function normalizeActions(actions, isSupportedTool) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => ({
      tool: String(a?.tool || '').trim(),
      params: a?.params && typeof a.params === 'object' ? a.params : {},
      description: String(a?.description || '').trim() || `Run ${String(a?.tool || '')}`
    }))
    .filter((a) => a.tool && isSupportedTool(a.tool));
}

function extractTokenCandidate(text) {
  const s = String(text || '').trim();
  const exact = s.match(/\bEA[A-Za-z0-9]{20,}\b/);
  if (exact) return exact[0];
  const generic = s.match(/\b[A-Za-z0-9_-]{30,}\b/);
  return generic ? generic[0] : '';
}

function extractWorkspaceFromText(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/\b(?:workspace|profile)\s+([a-zA-Z0-9._-]{2,80})\b/i);
  return match ? match[1] : '';
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toolRisk(toolName, devToolByName, specialToolByName = null) {
  if (intentsSchema[toolName]) return intentsSchema[toolName]?.risk || 'low';
  if (specialToolByName && specialToolByName.has(toolName)) {
    return specialToolByName.get(toolName)?.risk || 'low';
  }
  return devToolByName.get(toolName)?.risk || 'low';
}

function hasHighRisk(actions, devToolByName, specialToolByName = null) {
  return (actions || []).some((a) => toolRisk(a.tool, devToolByName, specialToolByName) === 'high');
}

function isLikelyCliCommand(text) {
  return /^(social|meta)\s+[a-z]/i.test(String(text || '').trim());
}

const SPECIALIST_ROLES = {
  router: {
    id: 'router',
    name: 'Router Agent',
    mission: 'Route the request to the right specialist.'
  },
  marketing: {
    id: 'marketing',
    name: 'Marketing Agent',
    mission: 'Campaigns, content publishing, and analytics.'
  },
  developer: {
    id: 'developer',
    name: 'Developer Agent',
    mission: 'Auth, token, webhook, and diagnostics workflows.'
  },
  ops: {
    id: 'ops',
    name: 'Ops Agent',
    mission: 'Approvals, alerts, policy, and operational control.'
  },
  connector: {
    id: 'connector',
    name: 'Connector Agent',
    mission: 'Connector/source sync and integration workflows.'
  }
};

function specialistById(id) {
  return SPECIALIST_ROLES[id] || SPECIALIST_ROLES.router;
}

function recommendedOllamaModelsFor16Gb() {
  return ['llama3.1:8b', 'qwen2.5:7b', 'mistral:7b'];
}

function defaultMessageForIntent(intent) {
  const action = intent.action;
  if (action === 'post_facebook') return 'I can post that to Facebook. Review this plan and confirm when ready.';
  if (action === 'post_instagram') return 'I can publish that to Instagram. Review and confirm to proceed.';
  if (action === 'post_whatsapp') return 'I can send that WhatsApp message. Confirm and I will execute it.';
  if (action === 'query_pages') return 'I can fetch your Facebook pages now.';
  if (action === 'query_me') return 'I can fetch your profile now.';
  if (action === 'query_insights' || action === 'get_analytics') return 'I can pull your ad analytics now.';
  if (action === 'list_campaigns') return 'I can list your campaigns now.';
  if (action === 'check_limits') return 'I can check your current rate limit status now.';
  if (action === 'schedule_post') return 'I can schedule that post. Confirm to continue.';
  if (action === 'create_campaign') return 'I can create this campaign. Confirm to proceed.';
  return 'I can do that. Confirm and I will proceed.';
}

class AutonomousAgent {
  constructor({ context, config, options }) {
    this.context = context;
    this.config = config;
    this.options = options || {};
    this.devTools = getToolRegistry();
    this.devToolByName = new Map(this.devTools.map((t) => [t.name, t]));
    this.specialTools = CHAT_SPECIAL_TOOLS.slice();
    this.specialToolByName = new Map(this.specialTools.map((t) => [t.name, t]));
    this.tools = [
      ...toolDescriptions(),
      ...this.devTools.map((t) => ({
        name: t.name,
        risk: t.risk,
        required: [],
        optional: [],
        description: t.description || ''
      })),
      ...this.specialTools
    ];
  }

  isSupportedTool(toolName) {
    return Boolean(intentsSchema[toolName] || this.devToolByName.has(toolName) || this.specialToolByName.has(toolName));
  }

  toolDomain(toolName) {
    const tool = String(toolName || '').trim();
    if (!tool) return 'router';
    if (/^ops[._]/i.test(tool) || /^guard[._]/i.test(tool)) return 'ops';
    if (/source|connector|sync/i.test(tool)) return 'connector';
    if (tool === 'local.ollama.setup') return 'developer';

    if (this.devToolByName.has(tool)) {
      if (/^auth[._]/i.test(tool) || /^webhooks[._]/i.test(tool) || /^utils[._]/i.test(tool)) return 'developer';
      if (/^query[._]/i.test(tool) || /^marketing[._]/i.test(tool)) return 'marketing';
      return 'developer';
    }

    if (intentsSchema[tool]) {
      const lower = tool.toLowerCase();
      if (lower.includes('campaign') || lower.includes('insight') || lower.includes('post') || lower.includes('schedule')) return 'marketing';
      if (lower.includes('query') || lower.includes('check_limits')) return 'marketing';
      return 'marketing';
    }

    return 'router';
  }

  specialistFromText(text) {
    const raw = String(text || '').toLowerCase();
    if (!raw) return 'router';
    if (/\b(ops|approval|approvals|alert|alerts|guard|incident|rollback|run due|morning ops)\b/.test(raw)) return 'ops';
    if (/\b(connector|connectors|source|sources|sync|slack|hubspot|salesforce|zendesk|notion|drive)\b/.test(raw)) return 'connector';
    if (/\b(auth|token|webhook|debug|developer|scope|rate limit|setup ollama|local model)\b/.test(raw)) return 'developer';
    if (/\b(marketing|campaign|ads|insight|analytics|facebook|instagram|whatsapp|post|launch|creative)\b/.test(raw)) return 'marketing';
    return 'router';
  }

  selectSpecialist(userInput, actions) {
    if (Array.isArray(actions) && actions.length) {
      const counts = { marketing: 0, developer: 0, ops: 0, connector: 0, router: 0 };
      actions.forEach((a) => {
        const d = this.toolDomain(a.tool);
        counts[d] = (counts[d] || 0) + 1;
      });
      let winner = 'router';
      let winnerScore = -1;
      Object.keys(counts).forEach((k) => {
        if (counts[k] > winnerScore) {
          winner = k;
          winnerScore = counts[k];
        }
      });
      if (winnerScore > 0) return winner;
    }
    return this.specialistFromText(userInput);
  }

  allowedBySpecialist(specialistId, toolName) {
    const domain = this.toolDomain(toolName);
    if (specialistId === 'router') return true;
    if (specialistId === 'developer') return domain === 'developer';
    if (specialistId === 'marketing') return domain === 'marketing';
    if (specialistId === 'ops') return domain === 'ops';
    if (specialistId === 'connector') return domain === 'connector';
    return true;
  }

  enforceSpecialistScope(specialistId, actions) {
    const rows = Array.isArray(actions) ? actions : [];
    const allowed = [];
    const blocked = [];
    rows.forEach((a) => {
      if (this.allowedBySpecialist(specialistId, a.tool)) {
        allowed.push(a);
      } else {
        blocked.push(a);
      }
    });
    return { allowed, blocked };
  }

  setActiveSpecialist(specialistId) {
    const role = specialistById(specialistId);
    if (typeof this.context?.setActiveSpecialist === 'function') {
      this.context.setActiveSpecialist(role.id, role.name);
      return role;
    }
    this.context.sessionMeta = this.context.sessionMeta || {};
    this.context.sessionMeta.activeSpecialist = role.id;
    this.context.sessionMeta.activeSpecialistName = role.name;
    return role;
  }

  workspaceFromParams(params = {}, rawInput = '') {
    const hintFromParams = String(params.workspace || '').trim();
    const hintFromText = extractWorkspaceFromText(rawInput);
    const fromConfig = typeof this.config?.getActiveProfile === 'function'
      ? String(this.config.getActiveProfile() || '').trim()
      : '';
    return opsStorage.sanitizeWorkspace(hintFromParams || hintFromText || fromConfig || 'default');
  }

  buildOpsSnapshot(workspace) {
    const ws = opsStorage.ensureWorkspace(workspace);
    const alerts = opsStorage.listAlerts(ws).filter((x) => x.status === 'open');
    const approvals = opsStorage.listApprovals(ws).filter((x) => x.status === 'pending');
    const schedulesDue = opsStorage.listDueSchedules(ws);
    const leadsDue = opsStorage.listLeads(ws).filter((x) => x.status === 'no_reply_3d' || x.status === 'followup_due');
    const sources = opsStorage.listSources(ws);
    const readySources = sources.filter((x) => x.enabled !== false && x.status === 'ready');
    const state = opsStorage.getState(ws);
    return {
      workspace: ws,
      summary: {
        role: opsRbac.roleFor({ workspace: ws }),
        alertsOpen: alerts.length,
        approvalsPending: approvals.length,
        leadsDue: leadsDue.length,
        schedulesDue: schedulesDue.length,
        sourcesConfigured: sources.filter((x) => x.enabled !== false).length,
        sourcesReady: readySources.length,
        lastMorningRunDate: state.lastMorningRunDate || ''
      },
      alerts: alerts.slice(0, 20),
      approvals: approvals.slice(0, 20),
      leadsDue: leadsDue.slice(0, 20),
      sources: sources.slice(0, 40)
    };
  }

  async executeSpecialTool(toolName, params = {}, action = null) {
    const ws = this.workspaceFromParams(params, action?.rawInput || '');

    if (toolName === 'ops.summary') {
      return this.buildOpsSnapshot(ws);
    }

    if (toolName === 'ops.morning_run') {
      const spend = toNumber(params.spend, 0);
      const force = toBool(params.force, false);
      const result = opsWorkflows.runMorningOps({
        workspace: ws,
        config: this.config,
        spend,
        force
      });
      return {
        workspace: ws,
        result,
        snapshot: this.buildOpsSnapshot(ws)
      };
    }

    if (toolName === 'ops.schedule.run_due') {
      const result = opsWorkflows.runDueSchedules({
        workspace: ws,
        config: this.config
      });
      return {
        workspace: ws,
        result,
        snapshot: this.buildOpsSnapshot(ws)
      };
    }

    if (toolName === 'ops.alerts.ack_token_missing') {
      const openTokenAlerts = opsStorage.listAlerts(ws)
        .filter((a) => a.status === 'open' && a.type === 'token_missing');
      const acked = [];
      openTokenAlerts.forEach((row) => {
        acked.push(opsStorage.ackAlert(ws, row.id));
      });
      return {
        workspace: ws,
        ackedCount: acked.length,
        acked,
        snapshot: this.buildOpsSnapshot(ws)
      };
    }

    if (toolName === 'ops.approvals.approve_low_risk') {
      const rows = opsStorage.listApprovals(ws)
        .filter((a) => a.status === 'pending' && String(a.risk || '').toLowerCase() === 'low');
      const resolved = [];
      rows.forEach((row) => {
        resolved.push(opsWorkflows.resolveApproval({
          workspace: ws,
          approvalId: row.id,
          decision: 'approve',
          note: 'Auto-approved by chat low-risk flow'
        }));
      });
      return {
        workspace: ws,
        approvedCount: resolved.length,
        approvals: resolved,
        snapshot: this.buildOpsSnapshot(ws)
      };
    }

    if (toolName === 'connector.sources.list') {
      let rows = opsStorage.listSources(ws);
      const connector = String(params.connector || '').trim().toLowerCase();
      if (connector) rows = rows.filter((x) => String(x.connector || '').toLowerCase() === connector);
      return {
        workspace: ws,
        count: rows.length,
        sources: rows
      };
    }

    if (toolName === 'connector.sources.sync') {
      let sourceIds = [];
      if (Array.isArray(params.sourceIds)) {
        sourceIds = params.sourceIds.map((x) => String(x || '').trim()).filter(Boolean);
      } else if (params.id !== undefined) {
        const one = String(params.id || '').trim();
        if (one) sourceIds = [one];
      } else if (params.connector !== undefined) {
        const connector = String(params.connector || '').trim().toLowerCase();
        sourceIds = opsStorage.listSources(ws)
          .filter((x) => String(x.connector || '').toLowerCase() === connector)
          .map((x) => x.id);
      }
      const result = opsWorkflows.syncSources({
        workspace: ws,
        sourceIds: sourceIds.length ? sourceIds : null,
        config: this.config
      });
      return {
        workspace: ws,
        result,
        snapshot: this.buildOpsSnapshot(ws)
      };
    }

    if (toolName === 'connector.integrations.show') {
      const val = opsStorage.getIntegrations(ws);
      return {
        workspace: ws,
        integrations: {
          slackWebhookConfigured: Boolean(val.slackWebhook),
          outboundWebhookConfigured: Boolean(val.outboundWebhook)
        }
      };
    }

    throw new Error(`Unsupported specialist tool: ${toolName}`);
  }

  developerHeuristicDecision(userInput) {
    const raw = String(userInput || '').trim();
    const s = raw.toLowerCase();
    if (!s) return null;
    const workspace = extractWorkspaceFromText(raw);

    if (/\b(ops summary|show ops|ops status|operations status|control plane status)\b/.test(s)) {
      return {
        message: 'I can load your ops control-plane summary now.',
        actions: [
          {
            tool: 'ops.summary',
            params: { workspace },
            description: 'Load ops summary'
          }
        ],
        needsInput: true,
        suggestions: ['I can run morning ops after this if you want fresh alerts and approvals.']
      };
    }

    if (/\b(run|execute)\s+morning ops\b|\bmorning ops now\b/.test(s)) {
      return {
        message: 'I can run the morning ops workflow now.',
        actions: [
          {
            tool: 'ops.morning_run',
            params: { workspace, force: false },
            description: 'Run morning ops workflow'
          }
        ],
        needsInput: true,
        suggestions: ['After this, I can acknowledge token alerts and process low-risk approvals.']
      };
    }

    if (/\b(run|execute)\s+due schedules\b|\brun-due\b|\bschedule run due\b/.test(s)) {
      return {
        message: 'I can run all due schedules now.',
        actions: [
          {
            tool: 'ops.schedule.run_due',
            params: { workspace },
            description: 'Run due ops schedules'
          }
        ],
        needsInput: true,
        suggestions: ['I can show the updated ops summary after this run.']
      };
    }

    if (/\b(ack|acknowledge)\b.*\b(token alert|token alerts|token issue|token missing)\b/.test(s)) {
      return {
        message: 'I can acknowledge all open token-missing alerts.',
        actions: [
          {
            tool: 'ops.alerts.ack_token_missing',
            params: { workspace },
            description: 'Acknowledge token-missing alerts'
          }
        ],
        needsInput: true,
        suggestions: ['I can trigger a fresh morning ops run once token issues are cleared.']
      };
    }

    if (/\bapprove\b.*\blow[- ]risk\b/.test(s)) {
      return {
        message: 'I can approve all pending low-risk approvals.',
        actions: [
          {
            tool: 'ops.approvals.approve_low_risk',
            params: { workspace },
            description: 'Approve low-risk approvals'
          }
        ],
        needsInput: true,
        suggestions: ['If needed, I can show remaining pending approvals after this.']
      };
    }

    if (/\b(show|list)\b.*\b(connectors|connector|sources|knowledge sources)\b/.test(s)) {
      return {
        message: 'I can list your connector sources now.',
        actions: [
          {
            tool: 'connector.sources.list',
            params: { workspace },
            description: 'List connector sources'
          }
        ],
        needsInput: true,
        suggestions: ['I can sync all sources or only a specific connector next.']
      };
    }

    if (/\b(sync|run sync)\b.*\b(connectors|connector|sources|knowledge sources)\b/.test(s)) {
      const connectorMatch = s.match(/\b(slack_channels|facebook_ads|instagram_insights|whatsapp_events|marketing_campaigns|csv_upload|webhook|custom)\b/);
      return {
        message: 'I can run connector source sync now.',
        actions: [
          {
            tool: 'connector.sources.sync',
            params: { workspace, connector: connectorMatch ? connectorMatch[1] : '' },
            description: 'Sync connector sources'
          }
        ],
        needsInput: true,
        suggestions: ['I can show source statuses immediately after sync completes.']
      };
    }

    if (/\b(show|list)\b.*\bintegrations\b/.test(s)) {
      return {
        message: 'I can show integration readiness for connector workflows.',
        actions: [
          {
            tool: 'connector.integrations.show',
            params: { workspace },
            description: 'Show connector integrations'
          }
        ],
        needsInput: true,
        suggestions: ['I can sync sources right after integration checks.']
      };
    }

    if (
      s.includes('setup ollama') ||
      s.includes('configure ollama') ||
      s.includes('use ollama') ||
      s.includes('local model')
    ) {
      const modelMatch = raw.match(/\b([a-z0-9._-]+:[a-z0-9._-]+)\b/i);
      const model = modelMatch ? modelMatch[1] : 'llama3.1:8b';
      return {
        message: `I can switch to local Ollama using model "${model}" and test connectivity.`,
        actions: [
          {
            tool: 'local.ollama.setup',
            params: { model, pull: false },
            description: `Configure local Ollama (${model})`
          }
        ],
        needsInput: true,
        suggestions: [
          `If model is missing, run: ollama pull ${model}`,
          `Or auto-configure directly: social agent setup --provider ollama --model ${model}`
        ]
      };
    }

    if (
      s.includes('auth status') ||
      ((s.includes('auth') || s.includes('token') || s.includes('setup') || s.includes('config')) && s.includes('status'))
    ) {
      return {
        message: 'I can check your developer setup, configured tokens, and defaults right now.',
        actions: [
          {
            tool: 'auth.status',
            params: {},
            description: 'Check auth/config status'
          }
        ],
        needsInput: true,
        suggestions: ['I can debug a specific token next if you paste it.']
      };
    }

    if (s.includes('debug token')) {
      const token = extractTokenCandidate(raw);
      if (!token) {
        return {
          message: 'Please paste the token you want me to debug.',
          actions: [],
          needsInput: true,
          suggestions: ['Example: "debug token EAAB..."']
        };
      }
      return {
        message: 'I can debug that token now.',
        actions: [
          {
            tool: 'auth.debugToken',
            params: { token },
            description: 'Debug token'
          }
        ],
        needsInput: true,
        suggestions: ['After this, I can compare scopes with required permissions.']
      };
    }

    if (s.includes('webhook') || s.includes('subscription')) {
      return {
        message: 'I can list your app webhook subscriptions now.',
        actions: [
          {
            tool: 'webhooks.list',
            params: {},
            description: 'List webhook subscriptions'
          }
        ],
        needsInput: true,
        suggestions: ['I can also help validate callback URL and verify token setup.']
      };
    }

    if (s.includes('rate limit') && (s.includes('developer') || s.includes('app') || s.includes('header') || s.includes('usage'))) {
      return {
        message: 'I can check app/page/ad usage headers right now.',
        actions: [
          {
            tool: 'utils.limits.check',
            params: {},
            description: 'Check API rate-limit headers'
          }
        ],
        needsInput: true,
        suggestions: ['I can suggest throttling adjustments if usage is high.']
      };
    }

    if (
      s.includes('list pages') ||
      s.includes('my pages') ||
      /\bdo i have\b.*\bfacebook\b.*\bpage\b/.test(s) ||
      /\bdo i have\b.*\bpage\b/.test(s)
    ) {
      return {
        message: 'I can list your Facebook pages now.',
        actions: [
          {
            tool: 'query.pages',
            params: { limit: 50 },
            description: 'List Facebook pages'
          }
        ],
        needsInput: true,
        suggestions: ['I can also check page-level permissions after listing them.']
      };
    }

    return null;
  }

  async process(userInput) {
    this.context.addMessage('user', userInput);

    if (this.context.hasPendingActions()) {
      if (this.context.userConfirmedLatest(userInput)) {
        const pending = this.context.pendingActions.slice();
        const specialistId = this.selectSpecialist(userInput, pending);
        const specialist = this.setActiveSpecialist(specialistId);
        this.context.clearPendingActions();
        const msg = pending.length > 1
          ? `Perfect. I'll execute ${pending.length} actions now.`
          : 'Perfect. I will execute that now.';
        this.context.addMessage('agent', msg);
        return {
          message: msg,
          actions: pending,
          needsInput: false,
          specialist: specialist.id,
          specialistName: specialist.name,
          suggestions: this.proactiveSuggestionsFromContext()
        };
      }
      if (this.context.userRejectedLatest(userInput)) {
        this.context.clearPendingActions();
        const msg = 'No problem. Tell me what to change and I will adjust the plan.';
        this.context.addMessage('agent', msg);
        return { message: msg, actions: [], needsInput: true, suggestions: this.proactiveSuggestionsFromContext() };
      }
      // User sent a new instruction instead of confirming/rejecting pending work.
      // Treat this as plan replacement so stale pending actions do not block execution.
      this.context.clearPendingActions();
    }

    const clarificationPick = this.context.resolveClarificationChoice(userInput);
    if (clarificationPick) {
      this.context.clearClarificationChoices();
      this.context.addMessage('agent', `Using option ${clarificationPick.index}: ${clarificationPick.label}`);
      this.context.addMessage('user', clarificationPick.prompt);
      userInput = clarificationPick.prompt;
    } else if (this.context.hasClarificationChoices()) {
      this.context.clearClarificationChoices();
    }

    if (isSmallTalk(userInput)) {
      const msg = 'I can help with developer setup, token/webhook diagnostics, posts, scheduling, WhatsApp messaging, analytics, and campaigns. What do you want to do?';
      this.context.addMessage('agent', msg);
      const specialist = this.setActiveSpecialist('router');
      return {
        message: msg,
        actions: [],
        needsInput: true,
        specialist: specialist.id,
        specialistName: specialist.name,
        suggestions: this.proactiveSuggestionsFromContext()
      };
    }

    let decision = this.developerHeuristicDecision(userInput);
    if (!decision && this.canUseLlm()) {
      decision = await this.tryLlmDecision();
    }
    if (!decision) {
      decision = await this.heuristicDecision(userInput);
    }

    const specialistId = this.selectSpecialist(userInput, decision.actions);
    const specialist = this.setActiveSpecialist(specialistId);
    const scoped = this.enforceSpecialistScope(specialist.id, decision.actions);
    decision.actions = scoped.allowed;
    if (scoped.blocked.length) {
      decision.suggestions = uniq([
        ...(decision.suggestions || []),
        `Blocked ${scoped.blocked.length} out-of-scope action(s) for ${specialist.name}.`,
        'Split cross-domain requests into separate steps for safer execution.'
      ]);
      if (!decision.actions.length) {
        decision.needsInput = true;
        decision.message = `I routed this to ${specialist.name}, but the requested actions were outside that specialist scope.`;
      }
    }

    if (decision.actions.length > 0) {
      decision.actions = decision.actions.map((a) => ({
        ...a,
        risk: toolRisk(a.tool, this.devToolByName, this.specialToolByName)
      }));
      this.context.clearClarificationChoices();
      const highRisk = hasHighRisk(decision.actions, this.devToolByName, this.specialToolByName);
      const allLowRisk = decision.actions.every((a) => toolRisk(a.tool, this.devToolByName, this.specialToolByName) === 'low');
      const autoApproved = Boolean(this.options.yes) || Boolean(this.options.agentic);
      const autoRun = (!highRisk && autoApproved) ||
        (!highRisk && allLowRisk && isLikelyCliCommand(userInput));

      if (autoRun) {
        decision.message = `${decision.message}\n\nExecuting now.`;
        decision.needsInput = false;
      } else {
        this.context.setPendingActions(decision.actions);
      }

      if (!autoRun) {
        const overallRisk = highestRisk(decision.actions.map((a) => a.risk));
        decision.message = `${decision.message}\n\n${confirmationPromptForRisk(overallRisk, { surface: 'chat' })}`;
        decision.needsInput = true;
      }
    }

    if (Array.isArray(decision.clarificationChoices) && decision.clarificationChoices.length) {
      this.context.setClarificationChoices(decision.clarificationChoices);
    } else {
      this.context.clearClarificationChoices();
    }

    decision.suggestions = uniq([...(decision.suggestions || []), ...this.proactiveSuggestionsFromContext()]);
    if (!this.canUseLlm()) {
      decision.suggestions = uniq([...(decision.suggestions || []), ...this.noKeyFallbackSuggestions()]);
    }
    decision.specialist = specialist.id;
    decision.specialistName = specialist.name;
    decision.message = `[${specialist.name}] ${decision.message}`;
    this.context.addMessage('agent', decision.message);
    return decision;
  }

  canUseLlm() {
    const provider = resolveChatProvider(this.config);
    const apiKey = resolveChatApiKey(provider, this.config);
    return hasProviderCredential(provider, apiKey);
  }

  noKeyFallbackSuggestions() {
    const provider = resolveChatProvider(this.config);
    if (provider === 'ollama') return [];
    const models = recommendedOllamaModelsFor16Gb();
    return [
      `No cloud LLM key found. For ~16GB RAM use Ollama models: ${models.join(', ')}`,
      `Pull a model: ollama pull ${models[0]}`,
      `Auto-configure Social CLI: social agent setup --provider ollama --model ${models[0]}`
    ];
  }

  proactiveSuggestionsFromContext() {
    const suggestions = [];
    const summary = this.context.getSummary();
    const facts = summary?.facts || {};
    const recentTools = summary?.recentTools || [];
    const channels = Array.isArray(facts.channels) ? facts.channels : [];

    if (facts.launchDateHint && (channels.includes('facebook') || channels.includes('instagram'))) {
      if (!recentTools.includes('schedule_post')) {
        suggestions.push(`Want me to schedule all launch posts for ${facts.launchDateHint} at 10:00 AM?`);
      }
    }

    if (channels.includes('whatsapp') && !recentTools.includes('post_whatsapp')) {
      suggestions.push('Need me to prepare a WhatsApp broadcast version too?');
    }

    if (recentTools.includes('post_facebook') || recentTools.includes('post_instagram')) {
      suggestions.push('Want me to set a reminder to check engagement in 1 hour?');
    }

    if (recentTools.includes('query_insights') || recentTools.includes('get_analytics')) {
      suggestions.push('I can break analytics down by campaign status or date if helpful.');
    }

    if (recentTools.includes('auth.status')) {
      suggestions.push('Want me to run webhook subscription checks next?');
    }

    return uniq(suggestions).slice(0, 3);
  }

  async tryLlmDecision() {
    try {
      const provider = resolveChatProvider(this.config);
      const model = resolveChatModel(provider, this.config);
      const key = resolveChatApiKey(provider, this.config);

      const userPrompt = buildUserPrompt({
        summary: this.context.getSummary(),
        history: this.context.getHistory(16),
        latest: this.context.getLatestUserMessage()
      });

      const text = await chatComplete({
        provider,
        model,
        apiKey: key,
        system: `${systemPrompt()}\n\nTOOLS:\n${JSON.stringify(this.tools, null, 2)}`,
        user: userPrompt,
        temperature: 0.2,
        timeoutMs: 4500
      });
      const parsed = parseJsonPayload(text);
      if (!parsed || typeof parsed !== 'object') return null;

      return {
        message: String(parsed.message || '').trim() || 'I drafted a plan for you.',
        actions: normalizeActions(parsed.actions, (toolName) => this.isSupportedTool(toolName)),
        needsInput: Boolean(parsed.needsInput),
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : []
      };
    } catch {
      return null;
    }
  }

  async heuristicDecision(userInput) {
    const dev = this.developerHeuristicDecision(userInput);
    if (dev) return dev;
    return resolveIntentDecision({
      userInput,
      parseIntent: (text) => aiParseIntent(text, { debug: Boolean(this.options.debug) }),
      isSupportedTool: (tool) => this.isSupportedTool(tool),
      validateIntent: (intent) => validateIntent(intent, this.config),
      onValidIntent: (intent) => ({
        message: defaultMessageForIntent(intent),
        actions: [
          {
            tool: intent.action,
            params: intent,
            description: defaultMessageForIntent(intent)
          }
        ],
        needsInput: true,
        suggestions: [deriveSuggestionForAction(intent.action)]
      }),
      clarificationChoices: DEFAULT_CLARIFICATION_CHOICES,
      unknownSuggestions: ['Try: "social hatch" for the new agentic TUI flow'],
      ambiguousSuggestions: ['If you prefer local AI without cloud keys: social agent setup --provider ollama --model llama3.1:8b']
    });
  }

  async execute(action) {
    const params = action?.params && typeof action.params === 'object' ? action.params : {};
    const toolName = String(action?.tool || '');

    if (this.specialToolByName.has(toolName)) {
      const output = await this.executeSpecialTool(toolName, params, action);
      const wrapped = {
        success: true,
        data: output,
        metadata: {
          apiCalls: null,
          executionTime: null,
          cost: null
        }
      };
      return {
        success: true,
        summary: this.summaryFromResult(action, wrapped),
        raw: wrapped,
        suggestions: this.postExecutionSuggestions(action, wrapped)
      };
    }

    if (intentsSchema[toolName]) {
      const result = await executeIntent(params, this.config);
      if (!result.success) {
        throw new Error(result.error || 'Action failed.');
      }
      return {
        success: true,
        summary: this.summaryFromResult(action, result),
        raw: result,
        suggestions: this.postExecutionSuggestions(action, result)
      };
    }

    const tool = this.devToolByName.get(toolName);
    if (!tool) {
      throw new Error(`Unsupported action tool: ${toolName}`);
    }

    const output = await tool.execute({
      config: this.config,
      options: this.options,
      scope: 'chat',
      sanitizeForLog
    }, params);

    const wrapped = {
      success: true,
      data: output,
      metadata: {
        apiCalls: null,
        executionTime: null,
        cost: null
      }
    };

    return {
      success: true,
      summary: this.summaryFromResult(action, wrapped),
      raw: wrapped,
      suggestions: this.postExecutionSuggestions(action, wrapped)
    };
  }

  failureAdvice(action, error) {
    const raw = String(error?.message || error || '').trim();
    const msg = raw || 'Action failed.';
    const lower = msg.toLowerCase();

    const inferApi = () => {
      const tool = String(action?.tool || '');
      const explicit = String(action?.params?.api || '').toLowerCase();
      if (explicit === 'facebook' || explicit === 'instagram' || explicit === 'whatsapp') return explicit;
      if (tool.includes('whatsapp')) return 'whatsapp';
      if (tool.includes('instagram')) return 'instagram';
      return 'facebook';
    };

    if (
      lower.includes('session has expired') ||
      lower.includes('error validating access token') ||
      /\b190\b/.test(lower)
    ) {
      const api = inferApi();
      return {
        message: `Access token expired for ${api}. Re-authenticate with: social auth login -a ${api}`,
        suggestions: [
          `Run: social auth login -a ${api}`,
          'Then re-run the same request.'
        ]
      };
    }

    if (lower.includes('no facebook token found')) {
      return {
        message: 'No Facebook token configured.',
        suggestions: ['Run: social auth login -a facebook']
      };
    }
    if (lower.includes('no instagram') && lower.includes('token')) {
      return {
        message: 'No Instagram token configured.',
        suggestions: ['Run: social auth login -a facebook']
      };
    }
    if (lower.includes('no whatsapp token found')) {
      return {
        message: 'No WhatsApp token configured.',
        suggestions: ['Run: social auth login -a whatsapp']
      };
    }
    if (lower.includes('permission denied for action')) {
      return {
        message: 'Permission denied for this ops action.',
        suggestions: [
          'Use an operator/owner role for this workspace.',
          'Check role: social ops roles show --workspace <workspace>',
          'Set role (owner only): social ops roles set <user> operator --workspace <workspace>'
        ]
      };
    }

    return { message: msg, suggestions: [] };
  }

  postExecutionSuggestions(action, result) {
    const suggestions = [];
    const tool = action?.tool;
    if (tool === 'post_facebook' || tool === 'post_instagram') {
      suggestions.push('Want me to generate a channel-specific follow-up post?');
      suggestions.push('I can check engagement stats later today.');
    }
    if (tool === 'post_whatsapp') {
      suggestions.push('Need me to draft a follow-up WhatsApp message for non-responders?');
    }
    if (tool === 'check_limits' || tool === 'utils.limits.check') {
      const usage = result?.data?.usage || {};
      const hot = Number(usage.call_count) > 70 || Number(usage.total_time) > 70 || Number(usage.total_cputime) > 70;
      if (hot) {
        suggestions.push('Rate usage looks high. Want me to switch to lower-frequency querying?');
      } else {
        suggestions.push('Rate usage is healthy. Want me to continue with analytics pulls?');
      }
    }
    if (tool === 'query_insights' || tool === 'get_analytics') {
      suggestions.push('I can export this report or fetch campaign-level details next.');
    }
    if (tool === 'list_campaigns') {
      suggestions.push('Need me to filter these by ACTIVE status only?');
    }
    if (tool === 'auth.status') {
      suggestions.push('Want me to debug a specific token next?');
    }
    if (tool === 'auth.debugToken') {
      suggestions.push('Need me to compare token scopes with required permissions?');
    }
    if (tool === 'webhooks.list') {
      suggestions.push('I can help verify callback URL and verify token configuration.');
    }
    if (tool === 'ops.summary') {
      suggestions.push('I can run morning ops now if you want fresh checks.');
    }
    if (tool === 'ops.morning_run') {
      suggestions.push('I can acknowledge token alerts and approve low-risk items next.');
    }
    if (tool === 'ops.schedule.run_due') {
      suggestions.push('Want me to show an updated ops summary after due runs?');
    }
    if (tool === 'ops.alerts.ack_token_missing') {
      suggestions.push('Need me to run morning ops to regenerate current alerts?');
    }
    if (tool === 'ops.approvals.approve_low_risk') {
      suggestions.push('I can show any remaining high/medium-risk approvals now.');
    }
    if (tool === 'connector.sources.list') {
      suggestions.push('I can sync all sources, or only one connector type.');
    }
    if (tool === 'connector.sources.sync') {
      suggestions.push('I can show source readiness and integration status next.');
    }
    if (tool === 'connector.integrations.show') {
      suggestions.push('If integrations are ready, I can run source sync immediately.');
    }
    return uniq(suggestions).slice(0, 3);
  }

  summaryFromResult(action, result) {
    const tool = action.tool;
    if (tool === 'post_facebook') return 'Posted to Facebook successfully.';
    if (tool === 'post_instagram') return 'Published to Instagram successfully.';
    if (tool === 'post_whatsapp') return 'Sent WhatsApp message successfully.';
    if (tool === 'query_pages') return `Fetched ${(result.data?.data || []).length} Facebook pages.`;
    if (tool === 'query_me') return 'Fetched profile information.';
    if (tool === 'query_insights' || tool === 'get_analytics') return `Fetched ${(result.data?.rows || []).length} analytics rows.`;
    if (tool === 'list_campaigns') return `Fetched ${(result.data || []).length} campaigns.`;
    if (tool === 'check_limits') return 'Fetched current rate-limit headers.';
    if (tool === 'schedule_post') return 'Scheduled post successfully.';
    if (tool === 'create_campaign') return 'Campaign created successfully.';
    if (tool === 'auth.status') return 'Fetched developer auth/config status.';
    if (tool === 'auth.debugToken') return 'Token debug completed.';
    if (tool === 'webhooks.list') return 'Fetched webhook subscriptions.';
    if (tool === 'utils.limits.check') return 'Fetched app/page/ad usage headers.';
    if (tool === 'query.pages') return `Fetched ${(result.data || []).length} pages.`;
    if (tool === 'query.me') return 'Fetched profile information.';
    if (tool === 'ops.summary') return `Loaded ops summary for workspace ${result.data?.workspace || 'default'}.`;
    if (tool === 'ops.morning_run') return `Morning ops completed for ${result.data?.workspace || 'default'}.`;
    if (tool === 'ops.schedule.run_due') return `Executed due schedules for ${result.data?.workspace || 'default'}.`;
    if (tool === 'ops.alerts.ack_token_missing') return `Acknowledged ${Number(result.data?.ackedCount || 0)} token alerts.`;
    if (tool === 'ops.approvals.approve_low_risk') return `Approved ${Number(result.data?.approvedCount || 0)} low-risk approvals.`;
    if (tool === 'connector.sources.list') return `Listed ${Number(result.data?.count || 0)} connector sources.`;
    if (tool === 'connector.sources.sync') return `Completed connector sync for ${result.data?.workspace || 'default'}.`;
    if (tool === 'connector.integrations.show') return `Loaded integration readiness for ${result.data?.workspace || 'default'}.`;
    return `${tool} completed.`;
  }
}

module.exports = {
  AutonomousAgent
};

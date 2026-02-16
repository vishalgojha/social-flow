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

function toolRisk(toolName, devToolByName) {
  if (intentsSchema[toolName]) return intentsSchema[toolName]?.risk || 'low';
  return devToolByName.get(toolName)?.risk || 'low';
}

function hasHighRisk(actions, devToolByName) {
  return (actions || []).some((a) => toolRisk(a.tool, devToolByName) === 'high');
}

function isLikelyCliCommand(text) {
  return /^(social|meta)\s+[a-z]/i.test(String(text || '').trim());
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
    this.tools = [
      ...toolDescriptions(),
      ...this.devTools.map((t) => ({
        name: t.name,
        risk: t.risk,
        required: [],
        optional: [],
        description: t.description || ''
      }))
    ];
  }

  isSupportedTool(toolName) {
    return Boolean(intentsSchema[toolName] || this.devToolByName.has(toolName));
  }

  developerHeuristicDecision(userInput) {
    const raw = String(userInput || '').trim();
    const s = raw.toLowerCase();
    if (!s) return null;

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

    if (s.includes('list pages') || s.includes('my pages')) {
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
        this.context.clearPendingActions();
        const msg = pending.length > 1
          ? `Perfect. I'll execute ${pending.length} actions now.`
          : 'Perfect. I will execute that now.';
        this.context.addMessage('agent', msg);
        return { message: msg, actions: pending, needsInput: false, suggestions: this.proactiveSuggestionsFromContext() };
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

    if (isSmallTalk(userInput)) {
      const msg = 'I can help with developer setup, token/webhook diagnostics, posts, scheduling, WhatsApp messaging, analytics, and campaigns. What do you want to do?';
      this.context.addMessage('agent', msg);
      return { message: msg, actions: [], needsInput: true, suggestions: this.proactiveSuggestionsFromContext() };
    }

    let decision = this.developerHeuristicDecision(userInput);
    if (!decision && this.canUseLlm()) {
      decision = await this.tryLlmDecision();
    }
    if (!decision) {
      decision = await this.heuristicDecision(userInput);
    }

    if (decision.actions.length > 0) {
      const highRisk = hasHighRisk(decision.actions, this.devToolByName);
      const allLowRisk = decision.actions.every((a) => toolRisk(a.tool, this.devToolByName) === 'low');
      const autoRun = (!highRisk && Boolean(this.options.yes)) ||
        (!highRisk && allLowRisk && isLikelyCliCommand(userInput));

      if (autoRun) {
        decision.message = `${decision.message}\n\nExecuting now.`;
        decision.needsInput = false;
      } else {
        this.context.setPendingActions(decision.actions);
      }

      if (!autoRun && highRisk) {
        decision.message = `${decision.message}\n\nThis is a high-risk action. Reply "yes" to execute or "no" to cancel.`;
        decision.needsInput = true;
      } else if (!autoRun) {
        decision.message = `${decision.message}\n\nReply "yes" to execute now, or tell me what to change.`;
        decision.needsInput = true;
      }
    }

    decision.suggestions = uniq([...(decision.suggestions || []), ...this.proactiveSuggestionsFromContext()]);
    this.context.addMessage('agent', decision.message);
    return decision;
  }

  canUseLlm() {
    const provider = resolveChatProvider(this.config);
    const apiKey = resolveChatApiKey(provider, this.config);
    return hasProviderCredential(provider, apiKey);
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

    const intent = await aiParseIntent(userInput, { debug: Boolean(this.options.debug) });
    const validation = await validateIntent(intent, this.config);

    if (!validation.valid) {
      const question = validation.suggestions[0] || 'I need a bit more detail before I can execute that.';
      return {
        message: question,
        actions: [],
        needsInput: true,
        suggestions: validation.suggestions.slice(1, 3)
      };
    }

    const action = {
      tool: intent.action,
      params: intent,
      description: defaultMessageForIntent(intent)
    };

    return {
      message: defaultMessageForIntent(intent),
      actions: [action],
      needsInput: true,
      suggestions: [deriveSuggestionForAction(intent.action)]
    };
  }

  async execute(action) {
    const params = action?.params && typeof action.params === 'object' ? action.params : {};
    const toolName = String(action?.tool || '');

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
    return `${tool} completed.`;
  }
}

module.exports = {
  AutonomousAgent
};

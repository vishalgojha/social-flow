const chalk = require('chalk');
const inquirer = require('inquirer');
const config = require('./config');
const {
  normalizeProvider,
  defaultModelForProvider,
  resolveApiKeyForProvider,
  hasProviderCredential,
  chatComplete
} = require('./llm-providers');

function getAgentConfig() {
  const cfg = typeof config.getAgentConfig === 'function' ? config.getAgentConfig() : {};
  const provider = normalizeProvider(
    cfg.provider ||
    process.env.SOCIAL_AGENT_PROVIDER ||
    process.env.META_AGENT_PROVIDER ||
    'openai'
  );
  return {
    provider,
    model: cfg.model || process.env.SOCIAL_AGENT_MODEL || process.env.META_AGENT_MODEL || '',
    apiKey: cfg.apiKey || process.env.SOCIAL_AGENT_API_KEY || process.env.META_AGENT_API_KEY || ''
  };
}

async function maybePromptForApiKey(provider) {
  const p = normalizeProvider(provider);
  const cfg = getAgentConfig();
  if (hasProviderCredential(p, cfg.apiKey)) {
    return resolveApiKeyForProvider(p, cfg.apiKey);
  }

  if (p === 'ollama') {
    return '';
  }

  if (!process.stdout.isTTY) {
    throw new Error(`Missing LLM API key for provider "${p}".`);
  }

  console.log(chalk.yellow('\nLLM planning needs an API key.'));
  console.log(chalk.gray(`You can set SOCIAL_AGENT_API_KEY (or provider-specific env vars) for "${p}", or enter it now.\n`));

  const ans = await inquirer.prompt([
    {
      type: 'password',
      name: 'key',
      message: `Enter ${p} API key:`,
      validate: (v) => Boolean(String(v || '').trim()) || 'API key cannot be empty'
    },
    {
      type: 'confirm',
      name: 'save',
      default: false,
      message: 'Save this key in ~/.social-cli/config.json? (not recommended for shared machines)'
    }
  ]);

  if (ans.save && typeof config.setAgentApiKey === 'function') {
    config.setAgentProvider(p);
    config.setAgentApiKey(ans.key);
  }

  return String(ans.key || '');
}

function buildToolListMarkdown(tools) {
  return tools.map((t) => `- ${t.name} (${t.risk}): ${t.description}`).join('\n');
}

function parseJsonFromText(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const chunk = s.slice(start, end + 1);
      try {
        return JSON.parse(chunk);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function riskFromSteps(steps, tools) {
  const map = new Map(tools.map((t) => [t.name, t.risk]));
  let risk = 'low';
  (steps || []).forEach((s) => {
    const r = map.get(s.tool) || 'low';
    if (r === 'high') risk = 'high';
    else if (r === 'medium' && risk !== 'high') risk = 'medium';
  });
  return risk;
}

function toMarkdownPlan({ intent, memorySummary, steps, tools }) {
  const lines = [];
  if (memorySummary) {
    lines.push('**Loaded Memory Summary**');
    lines.push('');
    const snippet = memorySummary.split('\n').slice(0, 30).join('\n').trim();
    lines.push(snippet ? '```md\n' + snippet + '\n```' : '_No summary available._');
    lines.push('');
  }

  lines.push('**Intent**');
  lines.push('');
  lines.push('```');
  lines.push(String(intent).trim());
  lines.push('```');
  lines.push('');

  lines.push('**Steps**');
  lines.push('');
  (steps || []).forEach((s, idx) => {
    const tool = tools.find((t) => t.name === s.tool);
    const risk = tool ? tool.risk : 'low';
    const why = s.why ? `: ${s.why}` : '';
    lines.push(`${idx + 1}. \`${s.tool}\` (${risk})${why}`);
  });
  lines.push('');
  return lines.join('\n');
}

async function planWithProvider({ provider, apiKey, model, intent, scope, tools, memorySummary }) {
  const p = normalizeProvider(provider);
  const toolList = buildToolListMarkdown(tools);
  const sys = [
    'You are Social DevOps co-pilot.',
    'Strict rules:',
    '- You can ONLY propose steps using the registered tool names below.',
    '- Output MUST be a single JSON object and nothing else.',
    '- JSON schema:',
    '{ "risk": "low|medium|high", "steps": [ { "tool": string, "args": object, "why": string } ] }',
    '- Be conservative: prefer read-only checks first. Use high-risk tools only if necessary.',
    '- Never include secrets/tokens in args. Use placeholders instead (e.g. "<WABA_ID>").',
    '',
    'Registered tools:',
    toolList
  ].join('\n');

  const user = [
    `Scope: ${scope}`,
    memorySummary ? `Memory summary:\n${memorySummary}` : 'Memory summary: (none)',
    '',
    `Intent: ${intent}`
  ].join('\n');

  const raw = await chatComplete({
    provider: p,
    model,
    apiKey,
    system: sys,
    user,
    temperature: 0.2,
    timeoutMs: 60000
  });

  const parsed = parseJsonFromText(raw);
  if (!parsed || !Array.isArray(parsed.steps)) {
    throw new Error('LLM returned an invalid plan JSON.');
  }

  const steps = parsed.steps.map((s) => ({
    tool: String(s.tool || '').trim(),
    args: s.args && typeof s.args === 'object' ? s.args : {},
    why: String(s.why || '').trim()
  })).filter((s) => s.tool);

  const risk = (parsed.risk === 'high' || parsed.risk === 'medium' || parsed.risk === 'low')
    ? parsed.risk
    : riskFromSteps(steps, tools);

  return {
    risk,
    steps,
    markdown: toMarkdownPlan({ intent, memorySummary, steps, tools })
  };
}

async function planWithLLM({ provider, model, intent, scope, tools, memorySummary }) {
  const cfg = getAgentConfig();
  const p = normalizeProvider(provider || cfg.provider);
  const finalModel = model || cfg.model || defaultModelForProvider(p);
  const apiKey = await maybePromptForApiKey(p);
  return planWithProvider({
    provider: p,
    model: finalModel,
    apiKey,
    intent,
    scope,
    tools,
    memorySummary
  });
}

function planWithHeuristics({ intent, tools, memorySummary }) {
  const text = String(intent || '').toLowerCase();
  const pick = (name, args, why) => ({ tool: name, args: args || {}, why: why || '' });

  const steps = [pick('auth.status', {}, 'Check configured tokens/app credentials before making calls.')];

  if (text.includes('webhook')) {
    steps.push(pick('webhooks.list', {}, 'Inspect current app subscriptions.'));
  }
  if (text.includes('whatsapp')) {
    steps.push(pick('utils.limits.check', {}, 'Check rate limits before actions.'));
  } else if (text.includes('instagram')) {
    steps.push(pick('query.me', { api: 'instagram', fields: 'id,name' }, 'Validate IG token works.'));
  } else {
    steps.push(pick('query.me', { api: 'facebook', fields: 'id,name' }, 'Validate token works.'));
  }

  const risk = riskFromSteps(steps, tools);
  return {
    risk,
    steps,
    markdown: toMarkdownPlan({ intent, memorySummary, steps, tools })
  };
}

module.exports = {
  planWithLLM,
  planWithHeuristics
};

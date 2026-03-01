import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateIntent } from "../schema/validate-intent.js";
import type { ParseResult, ParsedIntent } from "../types.js";

type AiProvider = "ollama" | "openai" | "openrouter" | "xai";

type CoreIntent = {
  action: "onboard" | "doctor" | "status" | "config" | "get" | "create" | "list" | "logs" | "replay";
  target: "system" | "profile" | "post" | "ads" | "logs";
  params: Record<string, string>;
  risk: "LOW" | "MEDIUM" | "HIGH";
};

type CoreAiParse = (text: string, opts: {
  provider: AiProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}) => Promise<CoreIntent>;

type CoreConfig = {
  ai?: {
    provider?: AiProvider;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  };
};

function normalizeAiProvider(value: string): AiProvider {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "openrouter") return "openrouter";
  if (raw === "xai" || raw === "grok") return "xai";
  if (raw === "openai") return "openai";
  return "ollama";
}

function defaultModel(provider: AiProvider): string {
  if (provider === "openai") return "gpt-4o-mini";
  if (provider === "openrouter") return "openai/gpt-4o-mini";
  if (provider === "xai") return "grok-2-latest";
  return "qwen2.5:7b";
}

function defaultBaseUrl(provider: AiProvider): string {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (provider === "xai") return "https://api.x.ai/v1";
  return "http://127.0.0.1:11434";
}

function extractPhone(input: string): string | undefined {
  const match = input.match(/(\+?\d[\d -]{7,}\d)/);
  if (!match) return undefined;
  const digits = match[1].replace(/\D/g, "");
  return digits || undefined;
}

function extractQuoted(input: string): string | undefined {
  const m = input.match(/"([^"]+)"/) || input.match(/'([^']+)'/);
  return m?.[1]?.trim();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function detectDomainTopic(input: string): string {
  const s = String(input || "").toLowerCase();
  const hasPhoneNumber = /\+?\d[\d -]{7,}\d/.test(s);
  const hasMessageVerb = hasAny(s, [/\bsend\b/, /\bmsg\b/, /\bmessage\b/, /\btext\b/, /\bping\b/]);

  if (hasAny(s, [/\bwhatsapp\b/, /\bwaba\b/, /\btemplate\b/, /\bwebhook\b/, /\bphone number id\b/]) || (hasPhoneNumber && hasMessageVerb)) {
    return "waba";
  }
  if (hasAny(s, [/\binstagram\b/, /\binsta\b/, /\big\b/, /\breel\b/, /\bstory\b/, /\bmedia\b/])) {
    return "instagram";
  }
  if (hasAny(s, [/\bads?\b/, /\bmarketing\b/, /\bcampaign\b/, /\badset\b/, /\bact_[a-z0-9_]+\b/])) {
    return "marketing";
  }
  if (hasAny(s, [/\bfacebook\b/, /\bfb\b/, /\bpage\b/, /\bgraph api\b/])) {
    return "facebook";
  }
  if (hasAny(s, [/\btoken\b/, /\bapp id\b/, /\bapp secret\b/, /\bcredential\b/, /\bauth\b/])) {
    return "setup-auth";
  }

  return "";
}

function detectGuideTopic(input: string): string {
  const s = String(input || "").toLowerCase();
  const asksGuidance = hasAny(s, [
    /\b(setup|set up|configure|config|connect|onboard|auth|authenticate|login|guide|start)\b/,
    /\b(help|how to|how do i|where do i|what next)\b/
  ]);
  if (!asksGuidance) return "";
  return detectDomainTopic(s) || "setup-auth";
}

function inferAction(input: string): ParsedIntent["action"] {
  const s = input.toLowerCase();
  const guideTopic = detectGuideTopic(s);
  const domainTopic = detectDomainTopic(s);
  if (/\bsocial\s+hatch\b/.test(s) || /\bsocial\s+tui\b/.test(s)) return "help";
  if (guideTopic) return "guide";
  if (/\b(help|what can you do|what do you do|show commands|how do i use|start here)\b/.test(s)) return "help";
  if (/\b(hi|hello|hey|yo|hola|good morning|good evening|good afternoon)\b/.test(s)) return "status";
  if (/^\s*onboard\b/.test(s) || /\bsetup\b.*\bsocial\b/.test(s)) return "onboard";
  if (/\bdoctor\b|\bdiagnostic\b|\bhealth check\b/.test(s)) return "doctor";
  if (/\bstatus\b/.test(s)) return "status";
  if (/\bshow\b.*\bconfig\b|\bconfig\b/.test(s)) return "config";
  if (/\bshow\b.*\blogs\b|\blist\b.*\blogs\b/.test(s)) return "logs";
  if (/^\s*replay\b/.test(s)) return "replay";
  if (
    /\b(get|show|fetch)\b.*\b(profile|facebook profile)\b/.test(s) ||
    /\b(who am i|whoami|my profile|me)\b/.test(s)
  ) return "get_profile";
  if (
    /\b(create|publish)\b.*\bpost\b/.test(s) ||
    (/\bpost\b/.test(s) && (/\bfacebook\b/.test(s) || /\bpage\b/.test(s)))
  ) return "create_post";
  if (/\b(do i have|have (a|any)|show|list)\b.*\b(facebook\s+)?pages?\b/.test(s)) return "get_profile";
  if (/\b(list|show|fetch)\b.*\bads?\b/.test(s)) return "list_ads";
  if (/\b(status|health|ping|uptime)\b/.test(s)) return "get_status";
  if (
    /^(who|what|how|can you|help|menu|options|commands)\b/.test(s)
    && s.split(/\s+/).length <= 4
    && !/\b(post|ads?|profile|config|status|doctor|logs|replay|onboard|setup)\b/.test(s)
  ) return "help";
  if (domainTopic) return "guide";
  return "unknown";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function deterministicConfidenceScore(input: string, intent: ParsedIntent): number {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return 0.5;
  if (intent.action === "unknown") return 0.18;

  const hasGreeting = /\b(hi|hello|hey|yo|hola|good morning|good evening|good afternoon)\b/.test(s);
  const hasCapabilityQuestion = /\b(help|what can you do|what do you do|show commands|how do i use|start here)\b/.test(s);
  const shortQuestion = /^(who|what|how|can you|help|menu|options|commands)\b/.test(s) && s.split(/\s+/).length <= 4;

  if (intent.action === "status" && hasGreeting) return 0.95;
  if (intent.action === "help" && hasCapabilityQuestion) return 0.92;
  if (intent.action === "help" && shortQuestion) return 0.74;
  if (intent.action === "guide") return intent.params.topic ? 0.9 : 0.78;
  if (intent.action === "onboard") return intent.params.token ? 0.9 : 0.7;
  if (intent.action === "create_post") return intent.params.message ? 0.86 : 0.68;
  if (intent.action === "list_ads") return intent.params.adAccountId ? 0.84 : 0.76;
  if (intent.action === "logs") return 0.86;
  if (intent.action === "doctor") return 0.9;
  if (intent.action === "config") return 0.9;
  if (intent.action === "get_profile") return 0.88;
  if (intent.action === "get_status") return 0.9;
  if (intent.action === "status") return 0.86;
  if (intent.action === "replay") return intent.params.id ? 0.85 : 0.66;
  return 0.8;
}

function aiConfidenceScore(aiIntent: ParsedIntent, deterministic: ParseResult, explicitAi: boolean): number {
  const aiAction = aiIntent.action;
  const deterministicAction = deterministic.intent.action;

  if (aiAction === "unknown") return explicitAi ? 0.45 : 0.3;
  if (aiAction === deterministicAction) {
    return Math.max(0.9, deterministic.confidence || 0.8);
  }
  if (deterministicAction === "unknown") {
    return explicitAi ? 0.8 : 0.72;
  }
  if (deterministicAction === "guide" && aiAction !== "guide") {
    return explicitAi ? 0.65 : 0.55;
  }
  return explicitAi ? 0.68 : 0.58;
}

function normalizeIntent(intent: ParsedIntent): ParsedIntent {
  const out: ParsedIntent = { action: intent.action, params: {} };
  for (const [k, v] of Object.entries(intent.params)) {
    if (v !== undefined) out.params[k] = String(v).trim();
  }
  return out;
}

function resolveParserModules(): { aiPath?: string; configPath?: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "../../../../");
  const candidates = {
    aiPath: [
      path.join(repoRoot, "core", "ai", "intent-from-ai.js"),
      path.join(repoRoot, "dist-social", "core", "ai", "intent-from-ai.js")
    ],
    configPath: [
      path.join(repoRoot, "core", "config.js"),
      path.join(repoRoot, "dist-social", "core", "config.js")
    ]
  };
  const aiPath = candidates.aiPath.find((x) => existsSync(x));
  const configPath = candidates.configPath.find((x) => existsSync(x));
  return { aiPath, configPath };
}

function toParsedIntentFromCore(intent: CoreIntent): ParsedIntent {
  if (intent.action === "onboard") return { action: "onboard", params: intent.params };
  if (intent.action === "doctor") return { action: "doctor", params: intent.params };
  if (intent.action === "status") return { action: "status", params: intent.params };
  if (intent.action === "config") return { action: "config", params: intent.params };
  if (intent.action === "get" && intent.target === "system") return { action: "status", params: {} };
  if (intent.action === "logs") return { action: "logs", params: intent.params };
  if (intent.action === "list" && intent.target === "logs") return { action: "logs", params: intent.params };
  if (intent.action === "replay") return { action: "replay", params: intent.params };
  if (intent.action === "get" && intent.target === "profile") return { action: "get_profile", params: intent.params };
  if (intent.action === "create" && intent.target === "post") return { action: "create_post", params: intent.params };
  if (intent.action === "list" && intent.target === "ads") return { action: "list_ads", params: intent.params };
  return { action: "unknown", params: {} };
}

function buildDeterministicIntent(input: string): ParsedIntent {
  const text = String(input || "").trim();
  const action = inferAction(text);
  const params: Record<string, string> = {
    token: text.match(/\btoken\s+([^\s]+)/i)?.[1] || "",
    graphVersion: text.match(/\bgraph(?:[-_\s]?version)?\s+(v\d+\.\d+)/i)?.[1] || "",
    scopes: text.match(/\bscopes?\s+([a-z0-9_,.\s-]+)/i)?.[1]?.replace(/\s+/g, "") || "",
    defaultPageId: text.match(/\bpage(?:\s+id)?\s+([a-z0-9_]+)/i)?.[1] || "",
    defaultAdAccountId: text.match(/\baccount(?:\s+id)?\s+([a-z0-9_]+)/i)?.[1] || "",
    apiKey: text.match(/\bapi[-_\s]?key\s+([^\s]+)/i)?.[1] || "",
    baseUrl: text.match(/\bbase[-_\s]?url\s+([^\s]+)/i)?.[1] || "",
    model: text.match(/\bmodel\s+([a-z0-9_.:-]+)/i)?.[1] || "",
    provider: text.match(/\bprovider\s+(ollama|openai|openrouter|xai|grok)/i)?.[1]?.toLowerCase() || "",
    id: text.match(/\breplay\s+([a-z0-9-]+)/i)?.[1] || "",
    limit: text.match(/\blimit\s+(\d+)/i)?.[1] || "20",
    message: extractQuoted(text) || "",
    pageId: text.match(/\bpage\s+([a-z0-9_]+)/i)?.[1] || "",
    adAccountId: text.match(/\baccount\s+([a-z0-9_]+)/i)?.[1] || "",
    phone: extractPhone(text) || "",
    topic: detectGuideTopic(text) || detectDomainTopic(text) || "",
    fields: "id,name"
  };

  if (action === "onboard") {
    return { action, params: { ...params } };
  }
  if (action === "guide") {
    return { action, params: { topic: params.topic || "setup-auth" } };
  }
  if (action === "help" || action === "doctor" || action === "status" || action === "config") {
    return { action, params: {} };
  }
  if (action === "logs") {
    return { action, params: { limit: params.limit || "20" } };
  }
  if (action === "replay") {
    return { action, params: { id: params.id || "" } };
  }
  if (action === "get_profile") {
    return { action, params: { fields: "id,name" } };
  }
  if (action === "list_ads") {
    return { action, params: { adAccountId: params.adAccountId || "" } };
  }
  if (action === "create_post") {
    return {
      action,
      params: {
        message: params.message || "",
        pageId: params.pageId || ""
      }
    };
  }
  if (action === "get_status") {
    return { action, params: {} };
  }
  return { action: "unknown", params: {} };
}

function finalize(result: ParseResult): ParseResult {
  const defaultConfidence = result.intent.action === "unknown" ? 0.2 : 0.8;
  return {
    ...result,
    intent: normalizeIntent(result.intent),
    confidence: clampConfidence(typeof result.confidence === "number" ? result.confidence : defaultConfidence)
  };
}

export function parseNaturalLanguage(input: string): ParseResult {
  const normalized = normalizeIntent(buildDeterministicIntent(input));
  const confidence = deterministicConfidenceScore(input, normalized);
  return finalize({
    ...validateIntent(normalized),
    source: "deterministic",
    inputText: input,
    confidence
  });
}

export async function parseNaturalLanguageWithOptionalAi(input: string): Promise<ParseResult> {
  const raw = String(input || "").trim();
  const explicitAi = raw.toLowerCase().startsWith("/ai ");
  const cleanInput = explicitAi ? raw.slice(4).trim() : raw;
  const cleanLower = cleanInput.toLowerCase();
  const deterministic = parseNaturalLanguage(cleanInput);
  const autoAiEnabled = !/^(0|false|off|no)$/i.test(String(process.env.SOCIAL_TUI_AI_AUTO || "1"));
  const configuredProvider = normalizeAiProvider(
    process.env.SOCIAL_TUI_AI_PROVIDER
    || process.env.SOCIAL_TUI_AI_VENDOR
    || process.env.SOCIAL_AI_PROVIDER
    || ""
  );
  const hasApiKey = Boolean(String(
    process.env.SOCIAL_TUI_AI_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.OPENROUTER_API_KEY
    || process.env.XAI_API_KEY
    || ""
  ).trim());
  const needsApiKey = configuredProvider !== "ollama";
  const shouldUseAi = explicitAi || (autoAiEnabled && (!needsApiKey || hasApiKey));
  if (!cleanInput) {
    return deterministic;
  }
  if (!shouldUseAi) {
    return deterministic;
  }

  const { aiPath, configPath } = resolveParserModules();
  if (!aiPath || !configPath) {
    return deterministic;
  }

  try {
    const aiMod = await import(pathToFileURL(aiPath).href) as { parseIntentWithAi: CoreAiParse };
    const cfgMod = await import(pathToFileURL(configPath).href) as { readConfig: () => Promise<CoreConfig> };
    if (!aiMod.parseIntentWithAi || !cfgMod.readConfig) {
      return parseNaturalLanguage(cleanInput);
    }

    const cfg = await cfgMod.readConfig();
    const provider = normalizeAiProvider(
      process.env.SOCIAL_TUI_AI_PROVIDER
      || process.env.SOCIAL_TUI_AI_VENDOR
      || cfg.ai?.provider
      || "ollama"
    );
    const model = process.env.SOCIAL_TUI_AI_MODEL || cfg.ai?.model || defaultModel(provider);
    const baseUrl = process.env.SOCIAL_TUI_AI_BASE_URL || cfg.ai?.baseUrl || defaultBaseUrl(provider);
    const apiKey = process.env.SOCIAL_TUI_AI_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.OPENROUTER_API_KEY
      || process.env.XAI_API_KEY
      || cfg.ai?.apiKey
      || "";

    const aiIntent = await aiMod.parseIntentWithAi(cleanInput, { provider, model, baseUrl, apiKey });
    const mapped = normalizeIntent(toParsedIntentFromCore(aiIntent));
    const confidence = aiConfidenceScore(mapped, deterministic, explicitAi);
    const aiResult = finalize({
      ...validateIntent(mapped),
      source: "ai",
      inputText: cleanInput,
      confidence
    });

    // Keep direct command words deterministic so shortcuts stay predictable.
    if (!explicitAi && /^(doctor|status|config)\s*$/i.test(cleanInput)) {
      return deterministic;
    }

    // Preserve capability/help questions even when model drifts toward "status".
    const capabilityPrompt = /\b(what can (you|yo) do|what do you do|show commands|help)\b/i.test(cleanLower);
    if (!explicitAi && capabilityPrompt && deterministic.intent.action === "help" && aiResult.intent.action !== "help") {
      return deterministic;
    }

    if (deterministic.intent.action === "guide" && aiResult.intent.action !== "guide") {
      return deterministic;
    }
    if (aiResult.intent.action === "unknown" && deterministic.intent.action !== "unknown") {
      return deterministic;
    }

    return aiResult;
  } catch {
    return deterministic;
  }
}

export function applySlotEdits(intent: ParsedIntent, editLine: string): ParseResult {
  const [rawKey, ...rest] = String(editLine || "").split("=");
  const key = rawKey?.trim();
  const value = rest.join("=").trim();
  const next: ParsedIntent = {
    action: intent.action,
    params: { ...intent.params }
  };
  if (key) next.params[key] = value;
  return finalize({
    ...validateIntent(normalizeIntent(next)),
    source: "deterministic",
    inputText: editLine,
    confidence: 0.9
  });
}

import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateIntent } from "../schema/validate-intent.js";
import type { ParseResult, ParsedIntent } from "../types.js";

type AiProvider = "ollama" | "openai";

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

function inferAction(input: string): ParsedIntent["action"] {
  const s = input.toLowerCase();
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
  return "unknown";
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
  if (intent.action === "logs") return { action: "logs", params: intent.params };
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
    provider: text.match(/\bprovider\s+(ollama|openai)/i)?.[1]?.toLowerCase() || "",
    id: text.match(/\breplay\s+([a-z0-9-]+)/i)?.[1] || "",
    limit: text.match(/\blimit\s+(\d+)/i)?.[1] || "20",
    message: extractQuoted(text) || "",
    pageId: text.match(/\bpage\s+([a-z0-9_]+)/i)?.[1] || "",
    adAccountId: text.match(/\baccount\s+([a-z0-9_]+)/i)?.[1] || "",
    phone: extractPhone(text) || "",
    fields: "id,name"
  };

  if (action === "onboard") {
    return { action, params: { ...params } };
  }
  if (action === "doctor" || action === "status" || action === "config") {
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
  return {
    ...result,
    intent: normalizeIntent(result.intent)
  };
}

export function parseNaturalLanguage(input: string): ParseResult {
  const normalized = normalizeIntent(buildDeterministicIntent(input));
  return finalize({
    ...validateIntent(normalized),
    source: "deterministic",
    inputText: input
  });
}

export async function parseNaturalLanguageWithOptionalAi(input: string): Promise<ParseResult> {
  const raw = String(input || "").trim();
  const explicitAi = raw.toLowerCase().startsWith("/ai ");
  const cleanInput = explicitAi ? raw.slice(4).trim() : raw;
  const autoAiEnabled = !/^(0|false|off|no)$/i.test(String(process.env.SOCIAL_TUI_AI_AUTO || "1"));
  const hasApiKey = Boolean(String(process.env.SOCIAL_TUI_AI_API_KEY || process.env.OPENAI_API_KEY || "").trim());
  const shouldUseAi = explicitAi || (autoAiEnabled && hasApiKey);
  if (!cleanInput) {
    return parseNaturalLanguage(cleanInput);
  }
  if (!shouldUseAi) {
    return parseNaturalLanguage(cleanInput);
  }

  const { aiPath, configPath } = resolveParserModules();
  if (!aiPath || !configPath) {
    return parseNaturalLanguage(cleanInput);
  }

  try {
    const aiMod = await import(pathToFileURL(aiPath).href) as { parseIntentWithAi: CoreAiParse };
    const cfgMod = await import(pathToFileURL(configPath).href) as { readConfig: () => Promise<CoreConfig> };
    if (!aiMod.parseIntentWithAi || !cfgMod.readConfig) {
      return parseNaturalLanguage(cleanInput);
    }

    const cfg = await cfgMod.readConfig();
    const provider = (process.env.SOCIAL_TUI_AI_PROVIDER || cfg.ai?.provider || "ollama") as AiProvider;
    const model = process.env.SOCIAL_TUI_AI_MODEL || cfg.ai?.model || (provider === "openai" ? "gpt-4o-mini" : "qwen2.5:7b");
    const baseUrl = process.env.SOCIAL_TUI_AI_BASE_URL || cfg.ai?.baseUrl || (provider === "openai" ? "https://api.openai.com/v1" : "http://127.0.0.1:11434");
    const apiKey = process.env.SOCIAL_TUI_AI_API_KEY || process.env.OPENAI_API_KEY || cfg.ai?.apiKey || "";

    const aiIntent = await aiMod.parseIntentWithAi(cleanInput, { provider, model, baseUrl, apiKey });
    const mapped = normalizeIntent(toParsedIntentFromCore(aiIntent));
    return finalize({
      ...validateIntent(mapped),
      source: "ai",
      inputText: cleanInput
    });
  } catch {
    return parseNaturalLanguage(cleanInput);
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
    inputText: editLine
  });
}

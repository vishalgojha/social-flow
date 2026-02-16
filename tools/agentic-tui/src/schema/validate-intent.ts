import type { ParseResult, ParsedIntent } from "../types.js";

const ALLOWED_ACTIONS = new Set([
  "onboard",
  "doctor",
  "status",
  "config",
  "logs",
  "replay",
  "get_profile",
  "create_post",
  "list_ads",
  "get_status",
  "unknown"
]);

const REQUIRED_PARAMS: Record<string, string[]> = {
  onboard: ["token"],
  doctor: [],
  status: [],
  config: [],
  logs: [],
  replay: ["id"],
  get_profile: [],
  create_post: ["message"],
  list_ads: [],
  get_status: [],
  unknown: []
};

export function validateIntent(intent: ParsedIntent): ParseResult {
  const errors: string[] = [];
  const missingSlots: string[] = [];

  if (!ALLOWED_ACTIONS.has(intent.action)) {
    errors.push(`Unsupported action: ${intent.action}`);
  }

  if (!intent.params || typeof intent.params !== "object" || Array.isArray(intent.params)) {
    errors.push("params must be an object of string values");
  } else {
    for (const [k, v] of Object.entries(intent.params)) {
      if (typeof v !== "string") {
        errors.push(`params.${k} must be a string`);
      }
    }
  }

  for (const slot of REQUIRED_PARAMS[intent.action] || []) {
    const value = intent.params[slot];
    if (!value || !value.trim()) missingSlots.push(slot);
  }

  if (intent.action === "replay") {
    const value = intent.params.id || "";
    if (value && !/^(latest|last|[a-z0-9-]+)$/i.test(value)) {
      errors.push("params.id must be a valid log id");
    }
  }

  if (intent.action === "onboard") {
    const scopes = intent.params.scopes || "";
    if (scopes && !scopes.split(",").map((x) => x.trim()).filter(Boolean).length) {
      errors.push("params.scopes must include at least one scope when provided");
    }
  }

  return {
    intent,
    valid: errors.length === 0,
    errors,
    missingSlots
  };
}

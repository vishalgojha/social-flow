import type { Intent, IntentAction, IntentTarget, RiskLevel } from "./types.js";

const VALID_ACTIONS = new Set<IntentAction>([
  "onboard",
  "doctor",
  "status",
  "config",
  "get",
  "create",
  "list",
  "logs",
  "replay"
]);

const VALID_TARGETS = new Set<IntentTarget>(["system", "profile", "post", "ads", "logs"]);
const VALID_RISKS = new Set<RiskLevel>(["LOW", "MEDIUM", "HIGH"]);

export function validateIntentSchema(intent: Intent): void {
  if (!VALID_ACTIONS.has(intent.action)) {
    throw new Error(`Invalid action: ${intent.action}`);
  }
  if (!VALID_TARGETS.has(intent.target)) {
    throw new Error(`Invalid target: ${intent.target}`);
  }
  if (!VALID_RISKS.has(intent.risk)) {
    throw new Error(`Invalid risk: ${intent.risk}`);
  }
  if (!intent.params || typeof intent.params !== "object" || Array.isArray(intent.params)) {
    throw new Error("params must be an object");
  }
  for (const [k, v] of Object.entries(intent.params)) {
    if (typeof k !== "string" || typeof v !== "string") {
      throw new Error("params keys and values must be strings");
    }
  }
}


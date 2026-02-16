"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateIntentSchema = validateIntentSchema;
const VALID_ACTIONS = new Set([
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
const VALID_TARGETS = new Set(["system", "profile", "post", "ads", "logs"]);
const VALID_RISKS = new Set(["LOW", "MEDIUM", "HIGH"]);
function validateIntentSchema(intent) {
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

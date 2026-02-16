"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateToken = validateToken;
exports.validateScopes = validateScopes;
const SCOPE_REQUIREMENTS = {
    "get:profile": ["public_profile"],
    "create:post": ["pages_manage_posts"],
    "list:ads": ["ads_read"]
};
function validateToken(config) {
    if (!config.token || config.token.trim().length < 20) {
        throw new Error("Missing or invalid token in ~/.social-cli/config.json");
    }
}
function validateScopes(intent, config) {
    const key = `${intent.action}:${intent.target}`;
    const required = SCOPE_REQUIREMENTS[key] || [];
    if (!required.length)
        return;
    const missing = required.filter((scope) => !config.scopes.includes(scope));
    if (missing.length) {
        throw new Error(`Missing required scopes: ${missing.join(", ")}`);
    }
}

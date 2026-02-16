import type { Intent, SocialConfig } from "./types.js";

const SCOPE_REQUIREMENTS: Record<string, string[]> = {
  "get:profile": ["public_profile"],
  "create:post": ["pages_manage_posts"],
  "list:ads": ["ads_read"]
};

export function validateToken(config: SocialConfig): void {
  if (!config.token || config.token.trim().length < 20) {
    throw new Error("Missing or invalid token in ~/.social-cli/config.json");
  }
}

export function validateScopes(intent: Intent, config: SocialConfig): void {
  const key = `${intent.action}:${intent.target}`;
  const required = SCOPE_REQUIREMENTS[key] || [];
  if (!required.length) return;
  const missing = required.filter((scope) => !config.scopes.includes(scope));
  if (missing.length) {
    throw new Error(`Missing required scopes: ${missing.join(", ")}`);
  }
}


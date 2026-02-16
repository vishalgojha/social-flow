import type { Intent, SocialConfig } from "../core/types.js";
import { MetaHttpExecutor } from "./http.js";

export async function executePostCreate(
  http: MetaHttpExecutor,
  config: SocialConfig,
  intent: Intent
): Promise<Record<string, unknown>> {
  const pageId = intent.params.pageId || config.defaultPageId;
  if (!pageId) {
    throw new Error("Missing page ID. Provide --page-id or set defaultPageId in config.");
  }
  const message = intent.params.message || "";
  if (!message) throw new Error("Missing message for post creation.");
  return http.post(`/${pageId}/feed`, { message });
}


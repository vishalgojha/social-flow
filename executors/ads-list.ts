import type { Intent, SocialConfig } from "../core/types.js";
import { MetaHttpExecutor } from "./http.js";

export async function executeAdsList(
  http: MetaHttpExecutor,
  config: SocialConfig,
  intent: Intent
): Promise<Record<string, unknown>> {
  const adAccountId = intent.params.adAccountId || config.defaultAdAccountId || "";
  if (!adAccountId) {
    return http.get("/me/adaccounts", {});
  }
  return http.get(`/${adAccountId}/campaigns`, {});
}


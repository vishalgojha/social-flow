import type { Intent } from "../core/types.js";
import { MetaHttpExecutor } from "./http.js";

export async function executeProfileGet(http: MetaHttpExecutor, intent: Intent): Promise<Record<string, unknown>> {
  const fields = intent.params.fields || "id,name";
  return http.get("/me", { fields });
}


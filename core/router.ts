import { readConfig } from "./config.js";
import { reserveIdempotency } from "./idempotency.js";
import { validateIntentSchema } from "./intent-schema.js";
import { writeLog } from "./log-store.js";
import { riskGate } from "./risk-gate.js";
import { validateScopes, validateToken } from "./safety.js";
import type { ExecutionResult, Intent } from "./types.js";
import { executeAdsList } from "../executors/ads-list.js";
import { executeProfileGet } from "../executors/facebook-profile.js";
import { MetaHttpExecutor } from "../executors/http.js";
import { executePostCreate } from "../executors/post-create.js";

export async function routeIntent(intent: Intent, opts?: { replay?: boolean; skipRiskGate?: boolean }): Promise<ExecutionResult> {
  const startedAt = Date.now();
  let rollbackPlan = "No rollback";
  const actionName = `${intent.action}:${intent.target}`;

  try {
    validateIntentSchema(intent);
    const config = await readConfig();

    if (!["onboard", "doctor", "status", "config", "logs", "replay"].includes(intent.action)) {
      validateToken(config);
      validateScopes(intent, config);
    }

    if (!opts?.skipRiskGate) {
      await riskGate(intent);
    }

    await reserveIdempotency(intent, !!opts?.replay);

    const http = new MetaHttpExecutor(config);

    let data: Record<string, unknown>;
    if (intent.action === "get" && intent.target === "profile") {
      data = await executeProfileGet(http, intent);
      rollbackPlan = "Read-only. No rollback required.";
    } else if (intent.action === "create" && intent.target === "post") {
      data = await executePostCreate(http, config, intent);
      rollbackPlan = "Delete the created post by post_id if needed.";
    } else if (intent.action === "list" && intent.target === "ads") {
      data = await executeAdsList(http, config, intent);
      rollbackPlan = "Read-only. No rollback required.";
    } else {
      throw new Error(`No deterministic executor for ${actionName}`);
    }

    await writeLog({
      timestamp: new Date().toISOString(),
      action: actionName,
      params: intent.params,
      latency: Date.now() - startedAt,
      success: true,
      rollback_plan: rollbackPlan
    });

    return { data, rollback_plan: rollbackPlan };
  } catch (err) {
    await writeLog({
      timestamp: new Date().toISOString(),
      action: actionName,
      params: intent.params,
      latency: Date.now() - startedAt,
      success: false,
      error: String((err as Error)?.message || err),
      rollback_plan: rollbackPlan
    });
    throw err;
  }
}


"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeIntent = routeIntent;
const config_js_1 = require("./config.js");
const idempotency_js_1 = require("./idempotency.js");
const intent_schema_js_1 = require("./intent-schema.js");
const log_store_js_1 = require("./log-store.js");
const risk_gate_js_1 = require("./risk-gate.js");
const safety_js_1 = require("./safety.js");
const ads_list_js_1 = require("../executors/ads-list.js");
const facebook_profile_js_1 = require("../executors/facebook-profile.js");
const http_js_1 = require("../executors/http.js");
const post_create_js_1 = require("../executors/post-create.js");
async function routeIntent(intent, opts) {
    const startedAt = Date.now();
    let rollbackPlan = "No rollback";
    const actionName = `${intent.action}:${intent.target}`;
    try {
        (0, intent_schema_js_1.validateIntentSchema)(intent);
        const config = await (0, config_js_1.readConfig)();
        if (!["onboard", "doctor", "status", "config", "logs", "replay"].includes(intent.action)) {
            (0, safety_js_1.validateToken)(config);
            (0, safety_js_1.validateScopes)(intent, config);
        }
        if (!opts?.skipRiskGate) {
            await (0, risk_gate_js_1.riskGate)(intent);
        }
        await (0, idempotency_js_1.reserveIdempotency)(intent, !!opts?.replay);
        const http = new http_js_1.MetaHttpExecutor(config);
        let data;
        if (intent.action === "get" && intent.target === "profile") {
            data = await (0, facebook_profile_js_1.executeProfileGet)(http, intent);
            rollbackPlan = "Read-only. No rollback required.";
        }
        else if (intent.action === "create" && intent.target === "post") {
            data = await (0, post_create_js_1.executePostCreate)(http, config, intent);
            rollbackPlan = "Delete the created post by post_id if needed.";
        }
        else if (intent.action === "list" && intent.target === "ads") {
            data = await (0, ads_list_js_1.executeAdsList)(http, config, intent);
            rollbackPlan = "Read-only. No rollback required.";
        }
        else {
            throw new Error(`No deterministic executor for ${actionName}`);
        }
        await (0, log_store_js_1.writeLog)({
            timestamp: new Date().toISOString(),
            action: actionName,
            params: intent.params,
            latency: Date.now() - startedAt,
            success: true,
            rollback_plan: rollbackPlan
        });
        return { data, rollback_plan: rollbackPlan };
    }
    catch (err) {
        await (0, log_store_js_1.writeLog)({
            timestamp: new Date().toISOString(),
            action: actionName,
            params: intent.params,
            latency: Date.now() - startedAt,
            success: false,
            error: String(err?.message || err),
            rollback_plan: rollbackPlan
        });
        throw err;
    }
}

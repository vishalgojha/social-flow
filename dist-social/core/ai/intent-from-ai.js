"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseIntentWithAi = parseIntentWithAi;
const axios_1 = __importDefault(require("axios"));
const intent_schema_js_1 = require("../intent-schema.js");
function extractJsonObject(text) {
    const s = String(text || "").trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1])
        return fence[1].trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start)
        return s.slice(start, end + 1);
    return s;
}
function normalizeIntentShape(raw) {
    const x = (raw && typeof raw === "object") ? raw : {};
    const paramsIn = (x.params && typeof x.params === "object" && !Array.isArray(x.params))
        ? x.params
        : {};
    const params = {};
    for (const [k, v] of Object.entries(paramsIn))
        params[k] = String(v);
    return {
        action: String(x.action || ""),
        target: String(x.target || ""),
        params,
        risk: String(x.risk || "")
    };
}
function systemPrompt() {
    return [
        "You convert user intent into strict JSON only.",
        "Allowed action: onboard, doctor, status, config, get, create, list, logs, replay.",
        "Allowed target: system, profile, post, ads, logs.",
        "Allowed risk: LOW, MEDIUM, HIGH.",
        "Schema: {\"action\":string,\"target\":string,\"params\":object,\"risk\":\"LOW\"|\"MEDIUM\"|\"HIGH\"}.",
        "No markdown. No explanation. Return JSON only."
    ].join(" ");
}
async function inferWithOllama(text, opts) {
    const base = opts.baseUrl || "http://127.0.0.1:11434";
    const { data } = await axios_1.default.post(`${base.replace(/\/+$/, "")}/api/chat`, {
        model: opts.model || "qwen2.5:7b",
        stream: false,
        messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: text }
        ],
        options: { temperature: 0 }
    }, { timeout: 30_000 });
    return String(data?.message?.content || "");
}
async function inferWithOpenAICompatible(text, opts) {
    const base = opts.baseUrl || "https://api.openai.com/v1";
    const key = opts.apiKey || "";
    if (!key)
        throw new Error("Missing API key for openai provider.");
    const { data } = await axios_1.default.post(`${base.replace(/\/+$/, "")}/chat/completions`, {
        model: opts.model || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: text }
        ]
    }, {
        timeout: 30_000,
        headers: { Authorization: `Bearer ${key}` }
    });
    return String(data?.choices?.[0]?.message?.content || "");
}
async function parseIntentWithAi(text, opts) {
    const raw = opts.provider === "openai"
        ? await inferWithOpenAICompatible(text, opts)
        : await inferWithOllama(text, opts);
    const jsonText = extractJsonObject(raw);
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch (err) {
        throw new Error(`AI returned non-JSON output: ${String(err?.message || err)}`);
    }
    const intent = normalizeIntentShape(parsed);
    (0, intent_schema_js_1.validateIntentSchema)(intent);
    return intent;
}

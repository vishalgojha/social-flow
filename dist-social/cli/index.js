"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const promises_1 = __importDefault(require("node:readline/promises"));
const node_process_1 = require("node:process");
const config_js_1 = require("../core/config.js");
const intent_from_ai_js_1 = require("../core/ai/intent-from-ai.js");
const intent_parser_js_1 = require("../core/intent-parser.js");
const log_store_js_1 = require("../core/log-store.js");
const router_js_1 = require("../core/router.js");
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
async function prompt(question) {
    const rl = promises_1.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
    try {
        return (await rl.question(question)).trim();
    }
    finally {
        rl.close();
    }
}
const program = new commander_1.Command();
program
    .name("social")
    .description("Deterministic Social CLI")
    .version("0.3.0");
program
    .command("onboard")
    .description("Initialize ~/.social-cli/config.json")
    .action(async () => {
    const cfg = await (0, config_js_1.readConfig)();
    cfg.token = await prompt("Meta token: ");
    cfg.graphVersion = (await prompt("Graph version [v20.0]: ")) || "v20.0";
    const scopes = await prompt("Scopes CSV: ");
    cfg.scopes = scopes.split(",").map((x) => x.trim()).filter(Boolean);
    cfg.defaultPageId = (await prompt("Default page ID (optional): ")) || undefined;
    cfg.defaultAdAccountId = (await prompt("Default ad account ID (optional): ")) || undefined;
    const aiProviderRaw = (await prompt("AI provider [ollama|openai] (optional, default ollama): ")) || "ollama";
    const aiProvider = aiProviderRaw.toLowerCase() === "openai" ? "openai" : "ollama";
    const aiModel = await prompt(`AI model (optional, default ${aiProvider === "openai" ? "gpt-4o-mini" : "qwen2.5:7b"}): `);
    const aiBase = await prompt(`AI base URL (optional, default ${aiProvider === "openai" ? "https://api.openai.com/v1" : "http://127.0.0.1:11434"}): `);
    const aiKey = await prompt("AI API key (optional, leave blank to use env var): ");
    cfg.ai = {
        provider: aiProvider,
        model: aiModel || (aiProvider === "openai" ? "gpt-4o-mini" : "qwen2.5:7b"),
        baseUrl: aiBase || (aiProvider === "openai" ? "https://api.openai.com/v1" : "http://127.0.0.1:11434"),
        apiKey: aiKey || ""
    };
    await (0, config_js_1.writeConfig)(cfg);
    printJson({ ok: true, path: await (0, config_js_1.configPath)() });
});
program
    .command("doctor")
    .description("Validate local setup")
    .action(async () => {
    const cfg = await (0, config_js_1.readConfig)();
    const issues = [];
    if (!cfg.token || cfg.token.length < 20)
        issues.push("Token missing/invalid");
    if (!cfg.graphVersion)
        issues.push("Graph version missing");
    if (!Array.isArray(cfg.scopes))
        issues.push("Scopes missing");
    printJson({ ok: issues.length === 0, issues, config_path: await (0, config_js_1.configPath)() });
});
program
    .command("status")
    .description("Show non-sensitive status")
    .action(async () => {
    const cfg = await (0, config_js_1.readConfig)();
    printJson({
        token_set: !!cfg.token,
        graph_version: cfg.graphVersion,
        scopes: cfg.scopes,
        default_page_id: cfg.defaultPageId || null,
        default_ad_account_id: cfg.defaultAdAccountId || null,
        ai_provider: cfg.ai?.provider || "ollama",
        ai_model: cfg.ai?.model || null,
        ai_base_url: cfg.ai?.baseUrl || null,
        ai_key_set: !!cfg.ai?.apiKey
    });
});
program
    .command("config")
    .description("Print config")
    .action(async () => {
    const cfg = await (0, config_js_1.readConfig)();
    printJson(cfg);
});
const profile = program.command("profile").description("Profile commands");
profile
    .command("get")
    .option("--fields <fields>", "fields list", "id,name")
    .action(async (opts) => {
    const intent = {
        action: "get",
        target: "profile",
        params: { fields: opts.fields },
        risk: "LOW"
    };
    const result = await (0, router_js_1.routeIntent)(intent);
    printJson(result.data);
});
const post = program.command("post").description("Post commands");
post
    .command("create")
    .requiredOption("--message <message>", "post message")
    .option("--page-id <id>", "page id")
    .action(async (opts) => {
    const intent = {
        action: "create",
        target: "post",
        params: {
            message: opts.message,
            pageId: opts.pageId || ""
        },
        risk: "MEDIUM"
    };
    const result = await (0, router_js_1.routeIntent)(intent);
    printJson(result.data);
});
const ads = program.command("ads").description("Ads commands");
ads
    .command("list")
    .option("--account <id>", "ad account id")
    .action(async (opts) => {
    const intent = {
        action: "list",
        target: "ads",
        params: { adAccountId: opts.account || "" },
        risk: "LOW"
    };
    const result = await (0, router_js_1.routeIntent)(intent);
    printJson(result.data);
});
program
    .command("logs")
    .description("List execution logs")
    .action(async () => {
    const logs = await (0, log_store_js_1.listLogs)();
    printJson(logs);
});
program
    .command("replay")
    .description("Replay a logged action")
    .argument("<id>", "log id")
    .action(async (id) => {
    const log = await (0, log_store_js_1.readLogById)(id);
    const actionParts = String(log.action).split(":");
    const action = actionParts[0];
    const target = actionParts[1];
    const risk = action === "create" ? "MEDIUM" : "LOW";
    const intent = {
        action,
        target,
        params: log.params,
        risk
    };
    const result = await (0, router_js_1.routeIntent)(intent, { replay: true });
    printJson({ replayed: id, data: result.data });
});
program
    .command("ai")
    .description("Natural language interface (deterministic or AI-assisted)")
    .argument("<intent...>", "intent text")
    .option("--provider <provider>", "deterministic|ollama|openai", "deterministic")
    .option("--model <model>", "AI model name")
    .option("--base-url <url>", "AI base URL")
    .option("--api-key <key>", "API key for openai-compatible providers")
    .option("--no-fallback-deterministic", "disable deterministic fallback if AI parsing fails")
    .action(async (parts, opts) => {
    const text = parts.join(" ");
    const cfg = await (0, config_js_1.readConfig)();
    const provider = opts.provider || "deterministic";
    const model = opts.model ||
        cfg.ai?.model ||
        (provider === "openai" ? "gpt-4o-mini" : "qwen2.5:7b");
    const baseUrl = opts.baseUrl ||
        process.env.SOCIAL_AI_BASE_URL ||
        cfg.ai?.baseUrl ||
        (provider === "openai" ? "https://api.openai.com/v1" : "http://127.0.0.1:11434");
    const apiKey = opts.apiKey ||
        process.env.SOCIAL_AI_API_KEY ||
        process.env.OPENAI_API_KEY ||
        cfg.ai?.apiKey ||
        "";
    let intent;
    if (provider === "deterministic") {
        intent = (0, intent_parser_js_1.parseNaturalLanguageToIntent)(text);
    }
    else {
        try {
            intent = await (0, intent_from_ai_js_1.parseIntentWithAi)(text, {
                provider: provider === "openai" ? "openai" : "ollama",
                model,
                baseUrl,
                apiKey
            });
        }
        catch (err) {
            if (!opts.fallbackDeterministic)
                throw err;
            intent = (0, intent_parser_js_1.parseNaturalLanguageToIntent)(text);
        }
    }
    const result = await (0, router_js_1.routeIntent)(intent);
    printJson({
        provider,
        model,
        base_url: baseUrl,
        fallback_deterministic: opts.fallbackDeterministic,
        intent,
        data: result.data
    });
});
async function main() {
    await program.parseAsync(process.argv);
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(String(err?.stack || err));
    process.exitCode = 1;
});

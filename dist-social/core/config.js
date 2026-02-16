"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configPath = configPath;
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const CONFIG_DIR = node_path_1.default.join(node_os_1.default.homedir(), ".social-cli");
const CONFIG_FILE = node_path_1.default.join(CONFIG_DIR, "config.json");
const DEFAULT_CONFIG = {
    token: "",
    graphVersion: "v20.0",
    scopes: [],
    ai: {
        provider: "ollama",
        model: "qwen2.5:7b",
        baseUrl: "http://127.0.0.1:11434",
        apiKey: ""
    }
};
async function configPath() {
    await node_fs_1.promises.mkdir(CONFIG_DIR, { recursive: true });
    return CONFIG_FILE;
}
async function readConfig() {
    const file = await configPath();
    try {
        const raw = await node_fs_1.promises.readFile(file, "utf8");
        const parsed = JSON.parse(raw);
        return {
            token: typeof parsed.token === "string" ? parsed.token : "",
            graphVersion: typeof parsed.graphVersion === "string" ? parsed.graphVersion : "v20.0",
            scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map((x) => String(x)) : [],
            defaultPageId: typeof parsed.defaultPageId === "string" ? parsed.defaultPageId : undefined,
            defaultAdAccountId: typeof parsed.defaultAdAccountId === "string" ? parsed.defaultAdAccountId : undefined,
            ai: {
                provider: parsed.ai?.provider === "openai" ? "openai" : "ollama",
                model: typeof parsed.ai?.model === "string" ? parsed.ai.model : DEFAULT_CONFIG.ai?.model,
                baseUrl: typeof parsed.ai?.baseUrl === "string" ? parsed.ai.baseUrl : DEFAULT_CONFIG.ai?.baseUrl,
                apiKey: typeof parsed.ai?.apiKey === "string" ? parsed.ai.apiKey : ""
            }
        };
    }
    catch {
        await writeConfig(DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG };
    }
}
async function writeConfig(config) {
    const file = await configPath();
    await node_fs_1.promises.writeFile(file, JSON.stringify(config, null, 2), "utf8");
}

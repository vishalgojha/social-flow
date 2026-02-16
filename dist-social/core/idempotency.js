"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildIdempotencyKey = buildIdempotencyKey;
exports.reserveIdempotency = reserveIdempotency;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const STORE_FILE = node_path_1.default.join(node_os_1.default.homedir(), ".social-cli", "idempotency.json");
function buildPayload(intent) {
    return JSON.stringify({
        action: intent.action,
        target: intent.target,
        params: intent.params
    });
}
async function readStore() {
    try {
        const raw = await node_fs_1.promises.readFile(STORE_FILE, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function writeStore(store) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(STORE_FILE), { recursive: true });
    await node_fs_1.promises.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}
function buildIdempotencyKey(intent) {
    return (0, node_crypto_1.createHash)("sha256").update(buildPayload(intent)).digest("hex");
}
async function reserveIdempotency(intent, allowReplay) {
    const key = buildIdempotencyKey(intent);
    if (allowReplay)
        return key;
    const store = await readStore();
    if (store[key]) {
        throw new Error(`Idempotency violation: duplicate action key ${key}`);
    }
    store[key] = new Date().toISOString();
    await writeStore(store);
    return key;
}

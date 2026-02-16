"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeLog = writeLog;
exports.listLogs = listLogs;
exports.readLogById = readLogById;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const LOG_DIR = node_path_1.default.join(process.cwd(), "logs");
async function ensureDir() {
    await node_fs_1.promises.mkdir(LOG_DIR, { recursive: true });
}
async function writeLog(entry) {
    await ensureDir();
    const record = { id: (0, node_crypto_1.randomUUID)(), ...entry };
    const file = node_path_1.default.join(LOG_DIR, `${record.id}.json`);
    await node_fs_1.promises.writeFile(file, JSON.stringify(record, null, 2), "utf8");
    return record;
}
async function listLogs() {
    await ensureDir();
    const files = await node_fs_1.promises.readdir(LOG_DIR);
    const logs = [];
    for (const f of files) {
        if (!f.endsWith(".json"))
            continue;
        try {
            const raw = await node_fs_1.promises.readFile(node_path_1.default.join(LOG_DIR, f), "utf8");
            logs.push(JSON.parse(raw));
        }
        catch { }
    }
    logs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return logs;
}
async function readLogById(id) {
    await ensureDir();
    const raw = await node_fs_1.promises.readFile(node_path_1.default.join(LOG_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw);
}

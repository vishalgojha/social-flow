"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askYesNo = askYesNo;
const promises_1 = __importDefault(require("node:readline/promises"));
const node_process_1 = require("node:process");
async function askYesNo(prompt, defaultNo = true) {
    const rl = promises_1.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
    try {
        const suffix = defaultNo ? " (y/N): " : " (Y/n): ";
        const raw = (await rl.question(`${prompt}${suffix}`)).trim().toLowerCase();
        if (!raw)
            return !defaultNo;
        return raw === "y" || raw === "yes";
    }
    finally {
        rl.close();
    }
}

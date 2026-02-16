"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.riskGate = riskGate;
const confirm_js_1 = require("../utils/confirm.js");
async function riskGate(intent) {
    if (intent.risk === "LOW")
        return;
    if (intent.risk === "MEDIUM") {
        const ok = await (0, confirm_js_1.askYesNo)("MEDIUM risk action detected. Continue?", true);
        if (!ok)
            throw new Error("Action rejected at risk gate.");
        return;
    }
    const first = await (0, confirm_js_1.askYesNo)("HIGH risk action detected. Continue to manual approval?", true);
    if (!first)
        throw new Error("Action rejected at risk gate.");
    const second = await (0, confirm_js_1.askYesNo)("Manual approval required. Confirm execution?", true);
    if (!second)
        throw new Error("Action rejected at manual approval.");
}

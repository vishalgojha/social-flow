"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNaturalLanguageToIntent = parseNaturalLanguageToIntent;
const intent_schema_js_1 = require("./intent-schema.js");
function normalize(s) {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function parseNaturalLanguageToIntent(input) {
    const raw = String(input || "").trim();
    const text = normalize(raw);
    if (text === "get my profile" || text === "get facebook profile" || text === "get my facebook profile") {
        const intent = {
            action: "get",
            target: "profile",
            params: { fields: "id,name" },
            risk: "LOW"
        };
        (0, intent_schema_js_1.validateIntentSchema)(intent);
        return intent;
    }
    const createPost = raw.match(/^create post "(.*)"(?: page ([a-z0-9_]+))?$/i);
    if (createPost) {
        const intent = {
            action: "create",
            target: "post",
            params: {
                message: createPost[1],
                pageId: createPost[2] || ""
            },
            risk: "MEDIUM"
        };
        (0, intent_schema_js_1.validateIntentSchema)(intent);
        return intent;
    }
    const adsList = text.match(/^list ads(?: account ([a-z0-9_]+))?$/i);
    if (adsList) {
        const intent = {
            action: "list",
            target: "ads",
            params: { adAccountId: adsList[1] || "" },
            risk: "LOW"
        };
        (0, intent_schema_js_1.validateIntentSchema)(intent);
        return intent;
    }
    throw new Error("Unable to parse intent deterministically. Use an explicit supported phrase.");
}

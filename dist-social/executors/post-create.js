"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executePostCreate = executePostCreate;
async function executePostCreate(http, config, intent) {
    const pageId = intent.params.pageId || config.defaultPageId;
    if (!pageId) {
        throw new Error("Missing page ID. Provide --page-id or set defaultPageId in config.");
    }
    const message = intent.params.message || "";
    if (!message)
        throw new Error("Missing message for post creation.");
    return http.post(`/${pageId}/feed`, { message });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeAdsList = executeAdsList;
async function executeAdsList(http, config, intent) {
    const adAccountId = intent.params.adAccountId || config.defaultAdAccountId || "";
    if (!adAccountId) {
        return http.get("/me/adaccounts", {});
    }
    return http.get(`/${adAccountId}/campaigns`, {});
}

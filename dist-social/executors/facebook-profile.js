"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeProfileGet = executeProfileGet;
async function executeProfileGet(http, intent) {
    const fields = intent.params.fields || "id,name";
    return http.get("/me", { fields });
}

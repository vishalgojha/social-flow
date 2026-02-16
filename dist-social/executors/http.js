"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaHttpExecutor = void 0;
const axios_1 = __importDefault(require("axios"));
class MetaHttpExecutor {
    client;
    token;
    constructor(config) {
        this.token = config.token;
        this.client = axios_1.default.create({
            baseURL: `https://graph.facebook.com/${config.graphVersion}`,
            timeout: 30_000
        });
    }
    async get(path, params) {
        const { data } = await this.client.get(path, {
            params: { ...params, access_token: this.token }
        });
        return data;
    }
    async post(path, params) {
        const { data } = await this.client.post(path, null, {
            params: { ...params, access_token: this.token }
        });
        return data;
    }
}
exports.MetaHttpExecutor = MetaHttpExecutor;

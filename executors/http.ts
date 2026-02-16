import axios, { type AxiosInstance } from "axios";

import type { SocialConfig } from "../core/types.js";

export class MetaHttpExecutor {
  private readonly client: AxiosInstance;
  private readonly token: string;

  constructor(config: SocialConfig) {
    this.token = config.token;
    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${config.graphVersion}`,
      timeout: 30_000
    });
  }

  async get(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const { data } = await this.client.get(path, {
      params: { ...params, access_token: this.token }
    });
    return data as Record<string, unknown>;
  }

  async post(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const { data } = await this.client.post(path, null, {
      params: { ...params, access_token: this.token }
    });
    return data as Record<string, unknown>;
  }
}


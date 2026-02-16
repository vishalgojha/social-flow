import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SocialConfig } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".social-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: SocialConfig = {
  token: "",
  graphVersion: "v20.0",
  scopes: [],
  ai: {
    provider: "ollama",
    model: "qwen2.5:7b",
    baseUrl: "http://127.0.0.1:11434",
    apiKey: ""
  }
};

export async function configPath(): Promise<string> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  return CONFIG_FILE;
}

export async function readConfig(): Promise<SocialConfig> {
  const file = await configPath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<SocialConfig>;
    return {
      token: typeof parsed.token === "string" ? parsed.token : "",
      graphVersion: typeof parsed.graphVersion === "string" ? parsed.graphVersion : "v20.0",
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map((x) => String(x)) : [],
      defaultPageId: typeof parsed.defaultPageId === "string" ? parsed.defaultPageId : undefined,
      defaultAdAccountId: typeof parsed.defaultAdAccountId === "string" ? parsed.defaultAdAccountId : undefined,
      ai: {
        provider: parsed.ai?.provider === "openai" ? "openai" : "ollama",
        model: typeof parsed.ai?.model === "string" ? parsed.ai.model : DEFAULT_CONFIG.ai?.model,
        baseUrl: typeof parsed.ai?.baseUrl === "string" ? parsed.ai.baseUrl : DEFAULT_CONFIG.ai?.baseUrl,
        apiKey: typeof parsed.ai?.apiKey === "string" ? parsed.ai.apiKey : ""
      }
    };
  } catch {
    await writeConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(config: SocialConfig): Promise<void> {
  const file = await configPath();
  await fs.writeFile(file, JSON.stringify(config, null, 2), "utf8");
}

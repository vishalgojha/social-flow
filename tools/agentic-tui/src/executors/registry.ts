import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExecutionResult, ParsedIntent, RiskLevel } from "../types.js";

export type Executor = (intent: ParsedIntent) => Promise<ExecutionResult>;

export interface RegisteredExecutor {
  action: ParsedIntent["action"];
  risk: RiskLevel;
  execute: Executor;
}

type CoreIntent = {
  action: "onboard" | "doctor" | "status" | "config" | "get" | "create" | "list" | "logs" | "replay";
  target: "system" | "profile" | "post" | "ads" | "logs";
  params: Record<string, string>;
  risk: "LOW" | "MEDIUM" | "HIGH";
};

type CoreRouteResponse = { data: Record<string, unknown>; rollback_plan: string };
type CoreActionLog = {
  id: string;
  action: string;
  params: Record<string, string>;
  timestamp: string;
};
type SocialConfig = {
  token: string;
  graphVersion: string;
  scopes: string[];
  defaultPageId?: string;
  defaultAdAccountId?: string;
  ai?: {
    provider?: "ollama" | "openai";
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  };
};

type CoreModules = {
  routeIntent: (intent: CoreIntent, opts?: { replay?: boolean; skipRiskGate?: boolean }) => Promise<CoreRouteResponse>;
  readConfig: () => Promise<SocialConfig>;
  writeConfig: (cfg: SocialConfig) => Promise<void>;
  listLogs: () => Promise<CoreActionLog[]>;
  readLogById: (id: string) => Promise<CoreActionLog>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveModulePath(relativeToRepo: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "../../../../");
  const candidates = [
    path.join(repoRoot, relativeToRepo),
    path.join(repoRoot, "dist-social", relativeToRepo)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function loadCoreModules(): Promise<CoreModules> {
  const routerPath = resolveModulePath(path.join("core", "router.js"));
  const configPath = resolveModulePath(path.join("core", "config.js"));
  const logPath = resolveModulePath(path.join("core", "log-store.js"));
  if (!routerPath || !configPath || !logPath) {
    throw new Error("Core modules not found. Run `npm run build:social-ts` first.");
  }

  const routerMod = await import(pathToFileURL(routerPath).href) as { routeIntent: CoreModules["routeIntent"] };
  const configMod = await import(pathToFileURL(configPath).href) as {
    readConfig: CoreModules["readConfig"];
    writeConfig: CoreModules["writeConfig"];
  };
  const logMod = await import(pathToFileURL(logPath).href) as {
    listLogs: CoreModules["listLogs"];
    readLogById: CoreModules["readLogById"];
  };

  if (!routerMod.routeIntent || !configMod.readConfig || !configMod.writeConfig || !logMod.listLogs || !logMod.readLogById) {
    throw new Error("Core module exports are missing required functions.");
  }

  return {
    routeIntent: routerMod.routeIntent,
    readConfig: configMod.readConfig,
    writeConfig: configMod.writeConfig,
    listLogs: logMod.listLogs,
    readLogById: logMod.readLogById
  };
}

function toCoreIntent(intent: ParsedIntent): CoreIntent | null {
  if (intent.action === "get_profile") {
    return {
      action: "get",
      target: "profile",
      params: { fields: intent.params.fields || "id,name" },
      risk: "LOW"
    };
  }
  if (intent.action === "create_post") {
    return {
      action: "create",
      target: "post",
      params: {
        message: intent.params.message || "",
        pageId: intent.params.pageId || ""
      },
      risk: "MEDIUM"
    };
  }
  if (intent.action === "list_ads") {
    return {
      action: "list",
      target: "ads",
      params: { adAccountId: intent.params.adAccountId || "" },
      risk: "LOW"
    };
  }
  return null;
}

function coreActionToIntent(logAction: string): Pick<CoreIntent, "action" | "target" | "risk"> | null {
  if (logAction === "get:profile") return { action: "get", target: "profile", risk: "LOW" };
  if (logAction === "create:post") return { action: "create", target: "post", risk: "MEDIUM" };
  if (logAction === "list:ads") return { action: "list", target: "ads", risk: "LOW" };
  return null;
}

async function executeViaCoreRouter(intent: ParsedIntent): Promise<ExecutionResult> {
  const coreIntent = toCoreIntent(intent);
  if (!coreIntent) {
    return {
      ok: false,
      output: { error: `No core mapping for action ${intent.action}` }
    };
  }
  const { routeIntent } = await loadCoreModules();
  const result = await routeIntent(coreIntent, { skipRiskGate: true });
  return {
    ok: true,
    output: result.data,
    rollback: {
      note: result.rollback_plan,
      status: "STUB"
    }
  };
}

const executors: Record<ParsedIntent["action"], RegisteredExecutor> = {
  onboard: {
    action: "onboard",
    risk: "MEDIUM",
    execute: async (intent) => {
      const { readConfig, writeConfig } = await loadCoreModules();
      const cfg = await readConfig();
      const next: SocialConfig = {
        ...cfg,
        token: intent.params.token || cfg.token,
        graphVersion: intent.params.graphVersion || cfg.graphVersion || "v20.0",
        scopes: (intent.params.scopes || "").split(",").map((x) => x.trim()).filter(Boolean).length
          ? (intent.params.scopes || "").split(",").map((x) => x.trim()).filter(Boolean)
          : cfg.scopes,
        defaultPageId: intent.params.defaultPageId || cfg.defaultPageId,
        defaultAdAccountId: intent.params.defaultAdAccountId || cfg.defaultAdAccountId,
        ai: {
          provider: (intent.params.provider as "ollama" | "openai") || cfg.ai?.provider || "ollama",
          model: intent.params.model || cfg.ai?.model || "qwen2.5:7b",
          baseUrl: intent.params.baseUrl || cfg.ai?.baseUrl || "http://127.0.0.1:11434",
          apiKey: intent.params.apiKey || cfg.ai?.apiKey || ""
        }
      };
      await writeConfig(next);
      return {
        ok: true,
        output: {
          updated: true,
          graphVersion: next.graphVersion,
          scopes: next.scopes,
          defaultPageId: next.defaultPageId || null,
          defaultAdAccountId: next.defaultAdAccountId || null,
          ai: {
            provider: next.ai?.provider || "ollama",
            model: next.ai?.model || null,
            baseUrl: next.ai?.baseUrl || null,
            apiKeySet: !!next.ai?.apiKey
          }
        },
        rollback: {
          note: "Restore previous ~/.social-cli/config.json snapshot (manual rollback).",
          status: "STUB"
        }
      };
    }
  },
  doctor: {
    action: "doctor",
    risk: "LOW",
    execute: async () => {
      const { readConfig } = await loadCoreModules();
      const cfg = await readConfig();
      const issues: string[] = [];
      if (!cfg.token || cfg.token.length < 20) issues.push("Token missing/invalid");
      if (!cfg.graphVersion) issues.push("Graph version missing");
      if (!Array.isArray(cfg.scopes)) issues.push("Scopes missing");
      return {
        ok: issues.length === 0,
        output: {
          ok: issues.length === 0,
          issues,
          token_set: !!cfg.token,
          graph_version: cfg.graphVersion,
          scopes: cfg.scopes
        },
        rollback: {
          note: "Read-only diagnostic. No rollback required.",
          status: "DONE"
        }
      };
    }
  },
  status: {
    action: "status",
    risk: "LOW",
    execute: async () => {
      const { readConfig } = await loadCoreModules();
      const cfg = await readConfig();
      return {
        ok: true,
        output: {
          token_set: !!cfg.token,
          graph_version: cfg.graphVersion,
          scopes: cfg.scopes,
          default_page_id: cfg.defaultPageId || null,
          default_ad_account_id: cfg.defaultAdAccountId || null,
          ai_provider: cfg.ai?.provider || "ollama",
          ai_model: cfg.ai?.model || null,
          ai_base_url: cfg.ai?.baseUrl || null,
          ai_key_set: !!cfg.ai?.apiKey
        },
        rollback: {
          note: "Read-only status. No rollback required.",
          status: "DONE"
        }
      };
    }
  },
  config: {
    action: "config",
    risk: "MEDIUM",
    execute: async () => {
      const { readConfig } = await loadCoreModules();
      const cfg = await readConfig();
      return {
        ok: true,
        output: {
          ...cfg,
          token: cfg.token ? `${cfg.token.slice(0, 5)}...` : ""
        },
        rollback: {
          note: "Read-only config view. No rollback required.",
          status: "DONE"
        }
      };
    }
  },
  logs: {
    action: "logs",
    risk: "LOW",
    execute: async (intent) => {
      const { listLogs } = await loadCoreModules();
      const limit = Math.max(1, Math.min(100, Number.parseInt(intent.params.limit || "20", 10) || 20));
      const logs = await listLogs();
      return {
        ok: true,
        output: {
          count: logs.length,
          items: logs.slice(0, limit)
        },
        rollback: {
          note: "Read-only log inspection. No rollback required.",
          status: "DONE"
        }
      };
    }
  },
  replay: {
    action: "replay",
    risk: "HIGH",
    execute: async (intent) => {
      const { readLogById, listLogs, routeIntent } = await loadCoreModules();
      const requestedId = intent.params.id || "";
      if (!requestedId) {
        return { ok: false, output: { error: "Missing replay log id." } };
      }
      let log: CoreActionLog;
      if (requestedId === "latest" || requestedId === "last") {
        const logs = await listLogs();
        if (!logs.length) return { ok: false, output: { error: "No logs available for replay." } };
        log = logs[0];
      } else {
        log = await readLogById(requestedId);
      }
      const mapping = coreActionToIntent(log.action);
      if (!mapping) {
        return { ok: false, output: { error: `Replay unsupported for action ${log.action}` } };
      }
      const replayIntent: CoreIntent = {
        action: mapping.action,
        target: mapping.target,
        params: log.params || {},
        risk: mapping.risk
      };
      const result = await routeIntent(replayIntent, { replay: true, skipRiskGate: true });
      return {
        ok: true,
        output: {
          replayed: log.id,
          original_action: log.action,
          data: result.data
        },
        rollback: {
          note: result.rollback_plan,
          status: "STUB"
        }
      };
    }
  },
  get_profile: {
    action: "get_profile",
    risk: "LOW",
    execute: executeViaCoreRouter
  },
  create_post: {
    action: "create_post",
    risk: "MEDIUM",
    execute: executeViaCoreRouter
  },
  list_ads: {
    action: "list_ads",
    risk: "LOW",
    execute: executeViaCoreRouter
  },
  get_status: {
    action: "get_status",
    risk: "LOW",
    execute: async () => {
      await sleep(150);
      return {
        ok: true,
        output: {
          service: "social-agentic-tui",
          status: "healthy",
          timestamp: new Date().toISOString()
        },
        rollback: {
          note: "Read-only action. Nothing to rollback.",
          status: "DONE"
        }
      };
    }
  },
  unknown: {
    action: "unknown",
    risk: "MEDIUM",
    execute: async () => ({
      ok: false,
      output: {
        error: "Unknown intent. Use explicit commands like 'doctor', 'status', 'create post \"...\"', or '/ai ...'."
      }
    })
  }
};

export function getExecutor(action: ParsedIntent["action"]): RegisteredExecutor {
  return executors[action] || executors.unknown;
}

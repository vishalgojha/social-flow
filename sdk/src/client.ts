import type {
  SdkAction,
  SdkActionOptions,
  SdkEnvelope,
  SdkMeta,
  SdkPlanData,
  SocialFlowClientOptions
} from "./types.js";

function normalizeBaseUrl(input: string): string {
  const value = String(input || "").trim();
  if (!value) throw new Error("baseUrl is required.");
  return value.replace(/\/+$/, "");
}

function defaultMeta(action = "unknown"): SdkMeta {
  return {
    action,
    risk: "",
    requiresApproval: false,
    approvalToken: null,
    approvalTokenExpiresAt: null,
    source: "sdk-client"
  };
}

function toEnvelope<TData>(value: unknown, action = "unknown", traceId = ""): SdkEnvelope<TData> {
  const row = value && typeof value === "object" ? value as Partial<SdkEnvelope<TData>> : null;
  if (!row) {
    return {
      ok: false,
      traceId: traceId || `sdk_${Date.now().toString(36)}`,
      data: null,
      error: {
        code: "INVALID_RESPONSE",
        message: "Gateway returned non-JSON response.",
        retryable: false,
        suggestedNextCommand: ""
      },
      meta: defaultMeta(action)
    };
  }

  const meta = row.meta && typeof row.meta === "object" ? row.meta as SdkMeta : defaultMeta(action);
  const error = row.error && typeof row.error === "object" ? row.error : null;
  return {
    ok: Boolean(row.ok),
    traceId: String(row.traceId || traceId || `sdk_${Date.now().toString(36)}`),
    data: (row.data ?? null) as TData | null,
    error: error as SdkEnvelope<TData>["error"],
    meta
  };
}

export class SocialFlowSdkError<TData = unknown> extends Error {
  readonly envelope: SdkEnvelope<TData>;

  constructor(envelope: SdkEnvelope<TData>) {
    super(envelope.error?.message || "Social Flow SDK request failed.");
    this.name = "SocialFlowSdkError";
    this.envelope = envelope;
  }
}

export class SocialFlowClient {
  private readonly baseUrl: string;
  private readonly gatewayKey: string;
  private readonly sessionId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SocialFlowClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.gatewayKey = String(options.gatewayKey || "").trim();
    this.sessionId = String(options.sessionId || "").trim();
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 20_000));
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private async request<TData>(method: "GET" | "POST", endpoint: string, body?: unknown, actionHint = "unknown"): Promise<SdkEnvelope<TData>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.gatewayKey) headers["x-gateway-key"] = this.gatewayKey;
      if (this.sessionId) headers["x-session-id"] = this.sessionId;

      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      return toEnvelope<TData>(payload, actionHint);
    } catch (error) {
      return {
        ok: false,
        traceId: `sdk_${Date.now().toString(36)}`,
        data: null,
        error: {
          code: "NETWORK_ERROR",
          message: String((error as Error)?.message || error || "Network error"),
          retryable: true,
          suggestedNextCommand: ""
        },
        meta: defaultMeta(actionHint)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async listActions(): Promise<SdkEnvelope<{ actions: Array<{ action: string; risk: string; requiresApproval: boolean }> }>> {
    return this.request("GET", "/api/sdk/actions", undefined, "actions");
  }

  async status(): Promise<SdkEnvelope<Record<string, unknown>>> {
    return this.request("GET", "/api/sdk/status", undefined, "status");
  }

  async doctor(): Promise<SdkEnvelope<Record<string, unknown>>> {
    return this.request("GET", "/api/sdk/doctor", undefined, "doctor");
  }

  async plan(action: SdkAction, params: Record<string, unknown> = {}): Promise<SdkEnvelope<SdkPlanData>> {
    return this.request("POST", "/api/sdk/actions/plan", { action, params }, action);
  }

  async execute(action: SdkAction, params: Record<string, unknown> = {}, options: SdkActionOptions = {}): Promise<SdkEnvelope<Record<string, unknown>>> {
    return this.request("POST", "/api/sdk/actions/execute", {
      action,
      params,
      approvalToken: options.approvalToken || "",
      approvalReason: options.approvalReason || ""
    }, action);
  }

  readonly health = {
    status: async () => this.status(),
    doctor: async () => this.doctor()
  };

  readonly profile = {
    get: async (fields = "id,name") => this.execute("get_profile", { fields })
  };

  readonly posts = {
    create: async (input: { message?: string; pageId?: string; link?: string; draft?: boolean; schedule?: string }, options: SdkActionOptions = {}) =>
      this.execute("create_post", input, options)
  };

  readonly ads = {
    list: async (input: { adAccountId?: string; limit?: number; fields?: string } = {}) =>
      this.execute("list_ads", input)
  };

  readonly whatsapp = {
    send: async (input: { from?: string; to: string; body: string }, options: SdkActionOptions = {}) =>
      this.execute("send_whatsapp", input, options)
  };

  readonly logs = {
    list: async (limit = 20) => this.execute("logs", { limit })
  };

  readonly replay = {
    run: async (input: { id: string }, options: SdkActionOptions = {}) =>
      this.execute("replay", input, options)
  };

  readonly actions = {
    plan: async (action: SdkAction, params: Record<string, unknown> = {}) => this.plan(action, params),
    execute: async (action: SdkAction, params: Record<string, unknown> = {}, options: SdkActionOptions = {}) =>
      this.execute(action, params, options)
  };
}

export function createSocialFlowClient(options: SocialFlowClientOptions): SocialFlowClient {
  return new SocialFlowClient(options);
}

export function assertOk<TData>(envelope: SdkEnvelope<TData>): SdkEnvelope<TData> {
  if (!envelope.ok) throw new SocialFlowSdkError(envelope);
  return envelope;
}

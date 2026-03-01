export type SdkRisk = "LOW" | "MEDIUM" | "HIGH";

export type SdkAction =
  | "status"
  | "doctor"
  | "get_profile"
  | "create_post"
  | "list_ads"
  | "send_whatsapp"
  | "logs"
  | "replay";

export interface SdkError {
  code: string;
  message: string;
  retryable: boolean;
  suggestedNextCommand: string;
  details?: unknown;
}

export interface SdkMeta {
  action: string;
  risk: string;
  requiresApproval: boolean;
  approvalToken: string | null;
  approvalTokenExpiresAt: string | null;
  source: string;
}

export interface SdkEnvelope<TData = unknown> {
  ok: boolean;
  traceId: string;
  data: TData | null;
  error: SdkError | null;
  meta: SdkMeta;
}

export interface SdkPlanData {
  planned: boolean;
  action: SdkAction;
  params: Record<string, unknown>;
  risk: SdkRisk;
  requiresApproval: boolean;
  approvalToken: string | null;
  approvalTokenExpiresAt: string | null;
}

export interface SdkActionOptions {
  approvalToken?: string;
  approvalReason?: string;
}

export interface SocialFlowClientOptions {
  baseUrl: string;
  gatewayKey?: string;
  sessionId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

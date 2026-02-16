export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type IntentAction =
  | "onboard"
  | "doctor"
  | "status"
  | "config"
  | "get"
  | "create"
  | "list"
  | "logs"
  | "replay";

export type IntentTarget = "system" | "profile" | "post" | "ads" | "logs";

export interface Intent {
  action: IntentAction;
  target: IntentTarget;
  params: Record<string, string>;
  risk: RiskLevel;
}

export interface SocialConfig {
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
}

export interface ExecutionResult {
  data: Record<string, unknown>;
  rollback_plan: string;
}

export interface ActionLog {
  id: string;
  timestamp: string;
  action: string;
  params: Record<string, string>;
  latency: number;
  success: boolean;
  error?: string;
  rollback_plan: string;
}

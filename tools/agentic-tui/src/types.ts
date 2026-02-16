export type ActionType =
  | "onboard"
  | "doctor"
  | "status"
  | "config"
  | "logs"
  | "replay"
  | "get_profile"
  | "create_post"
  | "list_ads"
  | "get_status"
  | "unknown";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type AppPhase =
  | "INPUT"
  | "REVIEW"
  | "APPROVAL"
  | "HIGH_RISK_APPROVAL"
  | "EDIT_SLOTS"
  | "EXECUTING"
  | "RESULT"
  | "REJECTED";

export interface ParsedIntent {
  action: ActionType;
  params: Record<string, string>;
}

export interface ParseResult {
  intent: ParsedIntent;
  valid: boolean;
  errors: string[];
  missingSlots: string[];
  source?: "deterministic" | "ai";
  inputText?: string;
}

export interface ActionQueueItem {
  id: string;
  action: ActionType;
  params: Record<string, string>;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "REJECTED";
  createdAt: string;
}

export interface LogEntry {
  at: string;
  level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
  message: string;
}

export interface ApprovalEntry {
  at: string;
  action: ActionType;
  risk: RiskLevel;
  decision: "PENDING" | "APPROVED" | "REJECTED" | "AUTO_EXECUTED";
  reason?: string;
}

export interface RollbackEntry {
  at: string;
  action: ActionType;
  note: string;
  status: "STUB" | "DONE";
}

export interface ExecutionResult {
  ok: boolean;
  output: Record<string, unknown>;
  rollback?: {
    note: string;
    status: "STUB" | "DONE";
  };
}

export interface AppState {
  phase: AppPhase;
  input: string;
  editInput: string;
  approvalReason: string;
  showDetails: boolean;
  currentIntent: ParsedIntent | null;
  currentRisk: RiskLevel | null;
  missingSlots: string[];
  actionQueue: ActionQueueItem[];
  liveLogs: LogEntry[];
  approvals: ApprovalEntry[];
  results: Record<string, unknown> | null;
  rollbackHistory: RollbackEntry[];
  highRiskConfirmedOnce: boolean;
}

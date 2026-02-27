import type {
  ActionQueueItem,
  AppPhase,
  AppState,
  ApprovalEntry,
  LogEntry,
  ParsedIntent,
  RiskLevel,
  RollbackEntry
} from "../types.js";

export const INITIAL_STATE: AppState = {
  phase: "INPUT",
  input: "",
  editInput: "",
  approvalReason: "",
  showDetails: /^(1|true|on|yes)$/i.test(String(process.env.SOCIAL_TUI_VERBOSE || "")),
  currentIntent: null,
  currentRisk: null,
  currentConfidence: null,
  requiresIntentConfirmation: false,
  missingSlots: [],
  actionQueue: [],
  liveLogs: [],
  approvals: [],
  results: null,
  rollbackHistory: [],
  highRiskConfirmedOnce: false
};

type AppEvent =
  | { type: "SET_INPUT"; value: string }
  | { type: "SET_EDIT_INPUT"; value: string }
  | { type: "SET_APPROVAL_REASON"; value: string }
  | { type: "TOGGLE_DETAILS" }
  | {
      type: "PARSE_READY";
      intent: ParsedIntent;
      risk: RiskLevel;
      missingSlots: string[];
      confidence: number;
      requiresConfirmation: boolean;
    }
  | { type: "REQUEST_EDIT" }
  | { type: "RETURN_TO_APPROVAL" }
  | { type: "MARK_EXECUTING" }
  | { type: "SET_RESULT"; result: Record<string, unknown> }
  | { type: "RESET_FLOW" }
  | { type: "APPROVED"; reason?: string; auto?: boolean }
  | { type: "REJECTED"; reason?: string }
  | { type: "HIGH_CONFIRM_STEP_1" }
  | { type: "QUEUE_ADD"; item: ActionQueueItem }
  | { type: "QUEUE_UPDATE"; id: string; status: ActionQueueItem["status"] }
  | { type: "LOG_ADD"; entry: LogEntry }
  | { type: "ROLLBACK_ADD"; item: RollbackEntry };

const MAX_ITEMS = 25;

function pushBounded<T>(items: T[], item: T): T[] {
  return [...items.slice(-(MAX_ITEMS - 1)), item];
}

function nextPhaseAfterParse(risk: RiskLevel, missingSlots: string[], requiresConfirmation: boolean): AppPhase {
  if (missingSlots.length > 0) return "APPROVAL";
  if (risk === "LOW" && !requiresConfirmation) return "EXECUTING";
  return "APPROVAL";
}

function makeApproval(intent: ParsedIntent, risk: RiskLevel, decision: ApprovalEntry["decision"], reason?: string): ApprovalEntry {
  return {
    at: new Date().toISOString(),
    action: intent.action,
    risk,
    decision,
    reason
  };
}

export function reducer(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case "SET_INPUT":
      return { ...state, input: event.value };
    case "SET_EDIT_INPUT":
      return { ...state, editInput: event.value };
    case "SET_APPROVAL_REASON":
      return { ...state, approvalReason: event.value };
    case "TOGGLE_DETAILS":
      return { ...state, showDetails: !state.showDetails };
    case "PARSE_READY": {
      const nextApprovals =
        event.intent && event.risk
          ? pushBounded(state.approvals, makeApproval(event.intent, event.risk, "PENDING"))
          : state.approvals;
      return {
        ...state,
        currentIntent: event.intent,
        currentRisk: event.risk,
        currentConfidence: event.confidence,
        requiresIntentConfirmation: event.requiresConfirmation,
        missingSlots: event.missingSlots,
        phase: nextPhaseAfterParse(event.risk, event.missingSlots, event.requiresConfirmation),
        approvals: nextApprovals,
        approvalReason: "",
        highRiskConfirmedOnce: false
      };
    }
    case "REQUEST_EDIT":
      return { ...state, phase: "EDIT_SLOTS" };
    case "RETURN_TO_APPROVAL":
      return { ...state, phase: "APPROVAL", editInput: "" };
    case "MARK_EXECUTING":
      return { ...state, phase: "EXECUTING" };
    case "SET_RESULT":
      return { ...state, results: event.result, phase: "RESULT" };
    case "APPROVED": {
      if (!state.currentIntent || !state.currentRisk) return state;
      return {
        ...state,
        approvals: pushBounded(
          state.approvals,
          makeApproval(
            state.currentIntent,
            state.currentRisk,
            event.auto ? "AUTO_EXECUTED" : "APPROVED",
            event.reason
          )
        )
      };
    }
    case "REJECTED": {
      if (!state.currentIntent || !state.currentRisk) return { ...state, phase: "REJECTED" };
      return {
        ...state,
        phase: "REJECTED",
        approvals: pushBounded(
          state.approvals,
          makeApproval(state.currentIntent, state.currentRisk, "REJECTED", event.reason)
        )
      };
    }
    case "HIGH_CONFIRM_STEP_1":
      return { ...state, phase: "HIGH_RISK_APPROVAL", highRiskConfirmedOnce: true };
    case "QUEUE_ADD":
      return { ...state, actionQueue: pushBounded(state.actionQueue, event.item) };
    case "QUEUE_UPDATE":
      return {
        ...state,
        actionQueue: state.actionQueue.map((x) => (x.id === event.id ? { ...x, status: event.status } : x))
      };
    case "LOG_ADD":
      return { ...state, liveLogs: pushBounded(state.liveLogs, event.entry) };
    case "ROLLBACK_ADD":
      return { ...state, rollbackHistory: pushBounded(state.rollbackHistory, event.item) };
    case "RESET_FLOW":
      return {
        ...state,
        phase: "INPUT",
        input: "",
        editInput: "",
        approvalReason: "",
        currentIntent: null,
        currentRisk: null,
        currentConfidence: null,
        requiresIntentConfirmation: false,
        missingSlots: [],
        highRiskConfirmedOnce: false
      };
    default:
      return state;
  }
}


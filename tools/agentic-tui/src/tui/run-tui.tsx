import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Select } from "@inkjs/ui";
import TextInput from "ink-text-input";

import { getExecutor } from "../executors/registry.js";
import { applySlotEdits, parseNaturalLanguageWithOptionalAi } from "../parser/intent-parser.js";
import { INITIAL_STATE, reducer } from "../state/machine.js";
import type { ActionQueueItem, ExecutionResult, LogEntry, ParsedIntent } from "../types.js";
import { ThemeProvider, useTheme } from "../ui/theme.js";
import { handleSlashCommand } from "./tui-command-handlers.js";
import { handleShortcut } from "./tui-event-handlers.js";
import { buildActionBarHint } from "./action-bar.js";
import { detectDomainSkill } from "./domain-skills.js";
import {
  accountOptionsFromConfig,
  loadConfigSnapshot,
  loadPersistedLogs
} from "./tui-session-actions.js";
import type { ChatTurn, ConfigSnapshot, LoadState, PersistedLog } from "./tui-types.js";

function newLog(level: LogEntry["level"], message: string): LogEntry {
  return { at: new Date().toISOString(), level, message };
}

function newTurn(role: ChatTurn["role"], text: string): ChatTurn {
  return {
    id: `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    role,
    text
  };
}

function queueItem(action: ActionQueueItem["action"], params: Record<string, string>): ActionQueueItem {
  return {
    id: `aq_${Date.now().toString(36)}`,
    action,
    params,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };
}

function shortTime(iso: string): string {
  const date = new Date(String(iso || ""));
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toISOString().slice(11, 19);
}

function logLevelColor(level: LogEntry["level"]): "cyan" | "yellow" | "red" | "green" {
  if (level === "WARN") return "yellow";
  if (level === "ERROR") return "red";
  if (level === "SUCCESS") return "green";
  return "cyan";
}

function logLevelGlyph(level: LogEntry["level"]): string {
  if (level === "WARN") return "!";
  if (level === "ERROR") return "x";
  if (level === "SUCCESS") return "ok";
  return "i";
}

function roleGlyph(role: ChatTurn["role"]): string {
  if (role === "user") return "you";
  if (role === "assistant") return "agent";
  return "sys";
}

function summarizeIntent(intent: ParsedIntent, risk: string, missing: string[]): string {
  const slots = Object.entries(intent.params)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `Plan ready: action=${intent.action}, risk=${risk}${slots ? `, slots: ${slots}` : ""}${missing.length ? `, missing: ${missing.join(", ")}` : ""}`;
}

function formatToolCall(intent: ParsedIntent): string {
  const args = Object.entries(intent.params || {})
    .filter(([, value]) => String(value || "").trim().length > 0)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(", ");
  return `tool_call: ${intent.action}(${args})`;
}

function describeAction(action: ParsedIntent["action"]): string {
  if (action === "guide") return "run a guided setup path";
  if (action === "help") return "show available capabilities";
  if (action === "doctor") return "run diagnostics";
  if (action === "status" || action === "get_status") return "check runtime status";
  if (action === "config") return "show sanitized config";
  if (action === "logs") return "fetch recent logs";
  if (action === "replay") return "replay a previous action";
  if (action === "get_profile") return "get profile information";
  if (action === "create_post") return "create a post draft/publish flow";
  if (action === "list_ads") return "list ad account data";
  return "process that request";
}

function summarizeExecutionForChat(intent: ParsedIntent, result: ExecutionResult): string {
  const output = (result.output || {}) as Record<string, unknown>;

  if (!result.ok) {
    const error = String(output.error || "").trim();
    if (intent.action === "unknown") {
      return "I could not map that request yet. Try `what can you do`, `status`, or `/help`.";
    }
    return error ? `I could not complete that: ${error}` : "I could not complete that request.";
  }

  if (intent.action === "guide") {
    const label = String(output.label || output.topic || "Setup");
    const suggestions = Array.isArray(output.suggestions)
      ? output.suggestions.map((x) => String(x)).filter(Boolean).slice(0, 3)
      : [];
    return suggestions.length
      ? `${label} guidance is ready. Try: ${suggestions.join(" | ")}`
      : `${label} guidance is ready.`;
  }

  if (intent.action === "help") {
    const suggestions = Array.isArray(output.suggestions)
      ? output.suggestions.map((x) => String(x)).filter(Boolean).slice(0, 4)
      : [];
    return suggestions.length
      ? `I can help with status, diagnostics, profiles, posts, ads, logs, and replay. Try: ${suggestions.join(" | ")}`
      : "I can help with status, diagnostics, profiles, posts, ads, logs, and replay.";
  }

  if (intent.action === "status" || intent.action === "get_status") {
    return "Status check complete. Runtime is responsive.";
  }

  if (intent.action === "doctor") {
    const ok = Boolean(output.ok);
    return ok ? "Diagnostics complete. No major issues detected." : "Diagnostics found issues. Run `doctor` details in verbose mode.";
  }

  if (intent.action === "logs") {
    const count = Number(output.count || 0);
    return `Fetched logs. Entries available: ${Number.isFinite(count) ? count : 0}.`;
  }

  if (intent.action === "create_post") {
    return "Post action completed.";
  }

  if (intent.action === "get_profile") {
    return "Profile lookup completed.";
  }

  if (intent.action === "list_ads") {
    return "Ad listing completed.";
  }

  return "Done. Action completed successfully.";
}

function explainPlan(intent: ParsedIntent | null, risk: string | null): string {
  if (!intent) return "No active plan yet. Send a request first.";
  const actionReason: Record<string, string> = {
    guide: "You asked for guided setup or next steps in a specific domain.",
    doctor: "You asked for health/setup validation.",
    status: "You asked for a quick account/system status snapshot.",
    config: "You asked to inspect current non-sensitive config.",
    logs: "You asked to inspect recent execution logs.",
    replay: "You asked to re-run a previous action.",
    get_profile: "You asked for profile/account identity data.",
    list_ads: "You asked for ads listing/visibility.",
    create_post: "You asked to publish content."
  };
  return [
    `Why this plan: ${actionReason[intent.action] || "Closest deterministic action was selected for your request."}`,
    `Risk rationale: ${risk || "UNKNOWN"}${risk === "HIGH" ? " actions need elevated approval with reason." : risk === "MEDIUM" ? " actions require explicit confirm." : " actions auto-run."}`,
    `Parameters: ${Object.entries(intent.params).filter(([, v]) => String(v || "").trim()).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`
  ].join(" ");
}

const AUTO_EXECUTE_CONFIDENCE_THRESHOLD = Math.min(
  0.98,
  Math.max(0.5, Number.parseFloat(process.env.SOCIAL_TUI_AUTO_EXECUTE_CONFIDENCE || "0.82") || 0.82)
);

function formatConfidence(confidence: number | null | undefined): string {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "--";
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

function shouldRequireIntentConfirmation(confidence: number | undefined, action: ParsedIntent["action"]): boolean {
  if (action === "unknown") return true;
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return true;
  return confidence < AUTO_EXECUTE_CONFIDENCE_THRESHOLD;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function RunTui(): JSX.Element {
  return (
    <ThemeProvider>
      <HatchRuntime />
    </ThemeProvider>
  );
}

function HatchRuntime(): JSX.Element {
  const theme = useTheme();
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([
    newTurn("system", "Hatch online. Ask naturally, or use /help for commands.")
  ]);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("default");
  const [replaySuggestionIndex, setReplaySuggestionIndex] = useState(0);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");

  const [configState, setConfigState] = useState<LoadState<ConfigSnapshot | null>>({
    loading: true,
    error: null,
    data: null
  });
  const [logsState, setLogsState] = useState<LoadState<PersistedLog[]>>({
    loading: true,
    error: null,
    data: []
  });

  const addTurn = useCallback((role: ChatTurn["role"], text: string) => {
    setChatTurns((prev) => [...prev.slice(-79), newTurn(role, text)]);
  }, []);

  const streamAssistantTurn = useCallback(async (text: string) => {
    const full = String(text || "");
    const turn = newTurn("assistant", "");
    setChatTurns((prev) => [...prev.slice(-79), turn]);
    for (let i = 1; i <= full.length; i += 1) {
      // Fast streaming simulation for agentic feel.
      // eslint-disable-next-line no-await-in-loop
      await sleep(6);
      setChatTurns((prev) => prev.map((x) => (x.id === turn.id ? { ...x, text: full.slice(0, i) } : x)));
    }
  }, []);

  const streamPhase = useCallback(async (label: string, detail?: string) => {
    await streamAssistantTurn(`${label}${detail ? `: ${detail}` : ""}`);
  }, [streamAssistantTurn]);

  const refreshConfig = useCallback(async () => {
    setConfigState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const cfg = await loadConfigSnapshot();
      setConfigState({ loading: false, error: null, data: cfg });
      const options = accountOptionsFromConfig(cfg);
      if (!options.some((x) => x.value === selectedAccount)) {
        setSelectedAccount(options[0]?.value || "default");
      }
    } catch (err) {
      setConfigState({ loading: false, error: String((err as Error)?.message || err), data: null });
    }
  }, [selectedAccount]);

  const refreshLogs = useCallback(async () => {
    setLogsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const logs = await loadPersistedLogs();
      setLogsState({ loading: false, error: null, data: logs });
    } catch (err) {
      setLogsState({ loading: false, error: String((err as Error)?.message || err), data: [] });
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
    void refreshLogs();
  }, [refreshConfig, refreshLogs]);

  useEffect(() => {
    const id = setInterval(() => {
      void refreshLogs();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshLogs]);

  const runExecution = useCallback(async (intentOverride?: ParsedIntent): Promise<void> => {
    const intent = intentOverride || state.currentIntent;
    if (!intent) {
      // Defensive reset: avoid getting stuck in EXECUTING if state intent is stale.
      dispatch({ type: "LOG_ADD", entry: newLog("WARN", "Execution skipped: no active intent.") });
      dispatch({ type: "RESET_FLOW" });
      return;
    }

    const current = queueItem(intent.action, intent.params);
    dispatch({ type: "QUEUE_ADD", item: current });
    dispatch({ type: "QUEUE_UPDATE", id: current.id, status: "RUNNING" });
    dispatch({ type: "MARK_EXECUTING" });
    dispatch({ type: "LOG_ADD", entry: newLog("INFO", `Executing ${intent.action}`) });
    if (state.showDetails) await streamPhase("Executing", intent.action);

    try {
      const executor = getExecutor(intent.action);
      if (state.showDetails) await streamPhase("Validating", "risk gate and required fields");
      const res = await executor.execute(intent);
      dispatch({ type: "QUEUE_UPDATE", id: current.id, status: res.ok ? "DONE" : "FAILED" });
      dispatch({ type: "SET_RESULT", result: res.output });
      dispatch({
        type: "LOG_ADD",
        entry: newLog(res.ok ? "SUCCESS" : "ERROR", res.ok ? "Execution completed." : "Execution failed.")
      });
      if (state.showDetails) {
        await streamAssistantTurn(res.ok ? "Done. I executed that successfully." : "Execution failed. Check logs/results.");
        await streamAssistantTurn(`tool_result: ${intent.action} -> ${res.ok ? "ok" : "failed"}`);
        const summaryKeys = Object.keys(res.output || {}).slice(0, 5);
        await streamAssistantTurn(
          `Execution summary: queue=${current.id}, status=${res.ok ? "success" : "failed"}, output_keys=${summaryKeys.join(", ") || "none"}.`
        );
      } else {
        await streamAssistantTurn(summarizeExecutionForChat(intent, res));
      }
      if (res.rollback) {
        dispatch({
          type: "ROLLBACK_ADD",
          item: {
            at: new Date().toISOString(),
            action: intent.action,
            note: res.rollback.note,
            status: res.rollback.status
          }
        });
      }
      void refreshLogs();
      dispatch({ type: "RESET_FLOW" });
    } catch (error) {
      dispatch({ type: "QUEUE_UPDATE", id: current.id, status: "FAILED" });
      dispatch({ type: "SET_RESULT", result: { ok: false, error: String((error as Error)?.message || error) } });
      dispatch({ type: "LOG_ADD", entry: newLog("ERROR", `Execution error: ${String((error as Error)?.message || error)}`) });
      if (state.showDetails) {
        await streamAssistantTurn(`Execution error: ${String((error as Error)?.message || error)}`);
      } else {
        await streamAssistantTurn("I could not complete that action. Try /help or run in verbose mode for diagnostics.");
      }
      dispatch({ type: "RESET_FLOW" });
    }
  }, [refreshLogs, state.currentIntent, state.showDetails, streamAssistantTurn, streamPhase]);

  const parseAndQueueIntent = useCallback(async (raw: string): Promise<void> => {
    addTurn("user", raw);
    const slash = handleSlashCommand(raw);
    if (slash.consumed) {
      if (slash.systemMessage) addTurn("system", slash.systemMessage);
      if (!slash.inputToExecute) return;
      dispatch({ type: "SET_INPUT", value: slash.inputToExecute });
      return parseAndQueueIntent(slash.inputToExecute);
    }

    if (raw === "__why__") {
      await streamAssistantTurn(explainPlan(state.currentIntent, state.currentRisk));
      return;
    }

    if (state.showDetails) await streamPhase("Reading request");
    if (state.showDetails) await streamPhase("Parsing intent");
    const parsed = await parseNaturalLanguageWithOptionalAi(raw);
    const executor = getExecutor(parsed.intent.action);
    const parsedRisk = executor.risk;
    const intentConfidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const requiresConfirmation = shouldRequireIntentConfirmation(intentConfidence, parsed.intent.action);
    const domainSkill = detectDomainSkill(raw, parsed.intent.action);
    if (state.showDetails) await streamPhase("Planning", parsed.intent.action);
    dispatch({
      type: "LOG_ADD",
      entry: newLog(
        "INFO",
        `${(parsed.source || "deterministic").toUpperCase()} parsed intent: ${JSON.stringify(parsed.intent)} (confidence=${formatConfidence(intentConfidence)})`
      )
    });
    dispatch({ type: "LOG_ADD", entry: newLog("INFO", `Skill route: ${domainSkill.id}`) });

    if (parsed.intent.action === "unknown") {
      dispatch({ type: "LOG_ADD", entry: newLog("WARN", "Intent unresolved. Waiting for clearer instruction.") });
      await streamAssistantTurn(
        `${domainSkill.purpose} Try: ${domainSkill.suggestions.map((x) => `\`${x}\``).join(" | ")}`
      );
      if (state.showDetails) {
        await streamAssistantTurn(`skill_route: ${domainSkill.id}`);
        await streamAssistantTurn("No tool call queued because intent was unresolved.");
      }
      return;
    }

    if (state.showDetails) {
      await streamAssistantTurn(`skill_route: ${domainSkill.id}`);
      await streamAssistantTurn(formatToolCall(parsed.intent));
      await streamAssistantTurn(`Understood. I can ${describeAction(parsed.intent.action)}.`);
      await streamAssistantTurn(summarizeIntent(parsed.intent, parsedRisk, parsed.missingSlots));
    }
    dispatch({
      type: "PARSE_READY",
      intent: parsed.intent,
      risk: parsedRisk,
      missingSlots: parsed.missingSlots,
      confidence: intentConfidence,
      requiresConfirmation
    });

    if (!parsed.valid) {
      dispatch({ type: "LOG_ADD", entry: newLog("WARN", parsed.errors.join("; ") || "Intent parsed with warnings.") });
    }
    if (parsed.missingSlots.length > 0) {
      await streamAssistantTurn(`I need these fields: ${parsed.missingSlots.join(", ")}. Press e to edit slots.`);
      return;
    }
    if (parsedRisk === "LOW" && !requiresConfirmation) {
      dispatch({ type: "APPROVED", auto: true });
      if (state.showDetails) await streamAssistantTurn("Low-risk action. Auto-executing.");
      await runExecution(parsed.intent);
      return;
    }
    if (parsedRisk === "LOW" && requiresConfirmation) {
      await streamAssistantTurn(
        `Intent confidence is ${formatConfidence(intentConfidence)}. Confirm with Enter/a, or rephrase to improve intent match.`
      );
      return;
    }
    await streamAssistantTurn(
      state.showDetails
        ? "Awaiting approval. Press Enter or a to continue."
        : `Ready to run ${parsed.intent.action} (${parsedRisk.toLowerCase()} risk). Press Enter to confirm, or e to edit.`
    );
  }, [addTurn, runExecution, state.currentIntent, state.currentRisk, state.showDetails, streamAssistantTurn, streamPhase]);

  const confirmOrExecute = useCallback(async (): Promise<void> => {
    if (state.phase === "INPUT") {
      const value = state.input.trim();
      if (!value) return;
      setInputHistory((prev) => {
        if (prev[prev.length - 1] === value) return prev;
        return [...prev.slice(-79), value];
      });
      setHistoryIndex(-1);
      setHistoryDraft("");
      dispatch({ type: "SET_INPUT", value: "" });
      await parseAndQueueIntent(value);
      return;
    }

    if (state.phase === "EDIT_SLOTS" && state.currentIntent) {
      const edited = applySlotEdits(state.currentIntent, state.editInput);
      const editedConfidence = typeof edited.confidence === "number" ? edited.confidence : 0.9;
      const editedRequiresConfirmation = shouldRequireIntentConfirmation(editedConfidence, edited.intent.action);
      dispatch({
        type: "PARSE_READY",
        intent: edited.intent,
        risk: getExecutor(edited.intent.action).risk,
        missingSlots: edited.missingSlots,
        confidence: editedConfidence,
        requiresConfirmation: editedRequiresConfirmation
      });
      dispatch({ type: "RETURN_TO_APPROVAL" });
      await streamAssistantTurn(edited.missingSlots.length > 0 ? `Still missing: ${edited.missingSlots.join(", ")}` : "Slots updated.");
      return;
    }

    if (state.phase === "APPROVAL") {
      if (!state.currentIntent || !state.currentRisk) return;
      if (state.missingSlots.length > 0) {
        await streamAssistantTurn("Missing required slots. Press e and provide key=value.");
        return;
      }
      if (state.currentRisk === "HIGH") {
        dispatch({ type: "HIGH_CONFIRM_STEP_1" });
        await streamAssistantTurn("High-risk action: provide approval reason, then press Enter.");
        return;
      }
      dispatch({ type: "APPROVED" });
      await runExecution(state.currentIntent || undefined);
      return;
    }

    if (state.phase === "HIGH_RISK_APPROVAL") {
      if (!state.approvalReason.trim()) {
        await streamAssistantTurn("Approval reason required for high-risk action.");
        return;
      }
      dispatch({ type: "APPROVED", reason: state.approvalReason.trim() });
      await runExecution(state.currentIntent || undefined);
      return;
    }

    if (state.phase === "RESULT" || state.phase === "REJECTED") {
      dispatch({ type: "RESET_FLOW" });
    }
  }, [parseAndQueueIntent, runExecution, state, streamAssistantTurn]);

  const replaySuggestions = useMemo(() => {
    if (state.phase !== "INPUT") return [] as PersistedLog[];
    const text = state.input.trim();
    if (!/^replay\b/i.test(text)) return [] as PersistedLog[];
    const query = text.replace(/^replay\s*/i, "").trim().toLowerCase();
    if (!query || query === "latest" || query === "last") return logsState.data.slice(0, 6);
    return logsState.data.filter((x) => x.id.toLowerCase().startsWith(query)).slice(0, 6);
  }, [logsState.data, state.input, state.phase]);

  useInput((input, key) => {
    const draftInput = state.phase === "EDIT_SLOTS"
      ? state.editInput
      : state.phase === "HIGH_RISK_APPROVAL"
        ? state.approvalReason
        : state.input;

    if (showPalette) {
      if (key.escape || input === "/" || input === "q") setShowPalette(false);
      return;
    }
    if (showHelp && (input === "?" || key.escape)) {
      setShowHelp(false);
      return;
    }

    if (state.phase === "INPUT" && replaySuggestions.length === 0 && key.upArrow) {
      if (!inputHistory.length) return;
      if (historyIndex === -1) {
        setHistoryDraft(state.input);
        const next = inputHistory.length - 1;
        setHistoryIndex(next);
        dispatch({ type: "SET_INPUT", value: inputHistory[next] || "" });
        return;
      }
      const next = Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      dispatch({ type: "SET_INPUT", value: inputHistory[next] || "" });
      return;
    }

    if (state.phase === "INPUT" && replaySuggestions.length === 0 && key.downArrow) {
      if (!inputHistory.length || historyIndex === -1) return;
      const next = historyIndex + 1;
      if (next >= inputHistory.length) {
        setHistoryIndex(-1);
        dispatch({ type: "SET_INPUT", value: historyDraft });
        return;
      }
      setHistoryIndex(next);
      dispatch({ type: "SET_INPUT", value: inputHistory[next] || "" });
      return;
    }

    const consumed = handleShortcut(input, key, replaySuggestions.length > 0, {
      onHelpToggle: () => setShowHelp((prev) => !prev),
      onRefresh: () => {
        void refreshConfig();
        void refreshLogs();
        addTurn("system", "Refreshed config/log state.");
      },
      onDetails: () => {
        const next = !state.showDetails;
        dispatch({ type: "TOGGLE_DETAILS" });
        addTurn("system", next ? "Verbose diagnostics enabled." : "Verbose diagnostics hidden.");
      },
      onEdit: () => {
        if (state.currentIntent) {
          dispatch({ type: "REQUEST_EDIT" });
          addTurn("assistant", "Edit mode: enter key=value and press Enter.");
        }
      },
      onApprove: () => void confirmOrExecute(),
      onReject: () => {
        if (!state.currentIntent) return;
        dispatch({ type: "REJECTED", reason: "Rejected by operator." });
        addTurn("assistant", "Rejected.");
      },
      onToggleRail: () => setRightRailCollapsed((prev) => !prev),
      onPaletteToggle: () => setShowPalette(true),
      onConfirm: () => void confirmOrExecute(),
      onReplayUp: () => setReplaySuggestionIndex((prev) => (prev === 0 ? replaySuggestions.length - 1 : prev - 1)),
      onReplayDown: () => setReplaySuggestionIndex((prev) => (prev + 1) % replaySuggestions.length),
      onQuit: () => exit()
    }, {
      phase: state.phase,
      hasDraftText: Boolean(String(draftInput || "").trim())
    });

    if (consumed) return;
  });

  const inputValue = state.phase === "EDIT_SLOTS" ? state.editInput : state.phase === "HIGH_RISK_APPROVAL" ? state.approvalReason : state.input;
  const inputLabel = state.phase === "EDIT_SLOTS" ? "edit_slots (key=value): " : state.phase === "HIGH_RISK_APPROVAL" ? "approval_reason: " : "chat: ";

  const setInputValue = (value: string): void => {
    if (state.phase === "EDIT_SLOTS") {
      dispatch({ type: "SET_EDIT_INPUT", value });
      return;
    }
    if (state.phase === "HIGH_RISK_APPROVAL") {
      dispatch({ type: "SET_APPROVAL_REASON", value });
      return;
    }
    dispatch({ type: "SET_INPUT", value });
  };

  const config = configState.data;
  const platformStatus = {
    instagram: !!config?.tokenMap.instagram || !!config?.scopes.find((x) => x.includes("instagram")),
    facebook: !!config?.tokenMap.facebook || !!config?.tokenSet,
    ads: !!config?.scopes.find((x) => x.includes("ads")) || !!config?.tokenMap.facebook
  };
  const connectedCount = [platformStatus.instagram, platformStatus.facebook, platformStatus.ads].filter(Boolean).length;
  const aiProvider = process.env.SOCIAL_TUI_AI_VENDOR || process.env.SOCIAL_TUI_AI_PROVIDER || "deterministic";
  const aiModel = process.env.SOCIAL_TUI_AI_MODEL || (
    aiProvider === "openai"
      ? "gpt-4o-mini"
      : aiProvider === "openrouter"
        ? "openai/gpt-4o-mini"
        : aiProvider === "xai"
          ? "grok-2-latest"
          : aiProvider === "ollama"
            ? "qwen2.5:7b"
            : "n/a"
  );
  const aiLabel = `${aiProvider}/${aiModel}`;
  const industryMode = String(config?.industry?.mode || "hybrid");
  const industrySelected = String(config?.industry?.selected || "").trim();
  const industryLabel = industrySelected || `${industryMode} (auto)`;
  const riskTone = state.currentRisk === "HIGH" ? theme.error : state.currentRisk === "MEDIUM" ? theme.warning : theme.success;
  const phaseTone = state.phase === "EXECUTING" ? theme.accent : state.phase === "REJECTED" ? theme.warning : theme.text;
  const topActivity = state.liveLogs[state.liveLogs.length - 1];
  const confidenceLabel = formatConfidence(state.currentConfidence);

  const accountOptions = accountOptionsFromConfig(config || {
    tokenSet: false,
    graphVersion: "v20.0",
    scopes: [],
    tokenMap: { facebook: false, instagram: false, whatsapp: false }
  });
  const verboseMode = state.showDetails;
  const runtimeLabel = state.phase === "EXECUTING" ? "executing" : "ready";
  const actionHint = buildActionBarHint({
    phase: state.phase,
    hasIntent: Boolean(state.currentIntent),
    hasReplaySuggestions: replaySuggestions.length > 0,
    verboseMode
  });

  const recentQueue = state.actionQueue.slice(-5);
  const recentLogs = state.liveLogs.slice(-10);
  const recentRollbacks = state.rollbackHistory.slice(-5);
  const resultPreview = state.results ? JSON.stringify(state.results, null, 2) : "";

  return (
    <Box flexDirection="column">
      <Text color={theme.accent}>
        Social Flow Hatch | runtime {runtimeLabel} | phase {state.phase.toLowerCase()} | risk {(state.currentRisk || "LOW").toLowerCase()} | confidence {confidenceLabel} | account {selectedAccount} | industry {industryLabel} | ai {aiLabel} | connected {connectedCount}/3
      </Text>
      <Text color={theme.muted}>
        latest: {topActivity ? `${shortTime(topActivity.at)} ${topActivity.message.slice(0, 72)}` : "idle"}
      </Text>
      <Text color={theme.muted}>Type naturally. Press ? for help, / for command palette, q to quit.</Text>

      <Box marginTop={1} flexDirection="column">
        {chatTurns.slice(-20).map((turn) => (
          <Text key={turn.id} color={turn.role === "user" ? theme.accent : turn.role === "assistant" ? theme.text : theme.muted}>
            [{shortTime(turn.at)}] {roleGlyph(turn.role)}: {turn.text || "..."}
          </Text>
        ))}
      </Box>

      {verboseMode ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent}>diagnostics</Text>
          <Text color={phaseTone}>phase={state.phase} risk={state.currentRisk || "LOW"} confidence={confidenceLabel} action={state.currentIntent?.action || "none"} missing={state.missingSlots.join(", ") || "none"}</Text>
          {configState.loading ? <Text color={theme.muted}>config: loading...</Text> : null}
          {configState.error ? <Text color={theme.error}>config error: {configState.error}</Text> : null}
          <Text color={theme.muted}>graph={config?.graphVersion || "v20.0"} account={selectedAccount}</Text>
          <Select options={accountOptions} onChange={(value) => setSelectedAccount(value)} />
          {rightRailCollapsed ? (
            <Text color={theme.muted}>details collapsed (press x to expand queue/log/result view)</Text>
          ) : (
            <>
              <Text color={theme.muted}>queue:</Text>
              {recentQueue.length ? recentQueue.map((x) => (
                <Text key={x.id} color={x.status === "FAILED" ? theme.error : x.status === "RUNNING" ? theme.accent : theme.text}>
                  [{shortTime(x.createdAt)}] {x.action} {x.status}
                </Text>
              )) : <Text color={theme.muted}>no queued actions</Text>}
              <Text color={theme.muted}>logs:</Text>
              {recentLogs.length ? recentLogs.map((x, idx) => (
                <Text key={`l-${idx}`} color={logLevelColor(x.level)}>
                  [{shortTime(x.at)}] {logLevelGlyph(x.level)} {x.message}
                </Text>
              )) : <Text color={theme.muted}>no runtime logs</Text>}
              <Text color={theme.muted}>rollback:</Text>
              {recentRollbacks.length ? recentRollbacks.map((x) => (
                <Text key={`${x.at}_${x.action}`} color={theme.text}>
                  [{shortTime(x.at)}] {x.action} {x.status}
                </Text>
              )) : <Text color={theme.muted}>no rollback entries</Text>}
              <Text color={theme.muted}>result:</Text>
              <Text color={resultPreview ? theme.text : theme.muted}>{resultPreview || "no results yet"}</Text>
            </>
          )}
        </Box>
      ) : null}

      {replaySuggestions.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.muted}>replay suggestions (up/down):</Text>
          {replaySuggestions.map((item, idx) => (
            <Text key={item.id} color={idx === replaySuggestionIndex ? theme.accent : theme.text}>
              {idx === replaySuggestionIndex ? ">" : " "} {item.id} {item.action}
            </Text>
          ))}
        </Box>
      ) : null}

      {showPalette ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent}>command palette</Text>
          <Select
            options={[
              { label: "Doctor", value: "doctor" },
              { label: "Status", value: "status" },
              { label: "WABA setup guide", value: "waba setup" },
              { label: "Config", value: "config" },
              { label: "Logs", value: "logs limit 20" },
              { label: "Replay latest", value: "replay latest" },
              { label: "Get profile", value: "get my facebook profile" },
              { label: "List ads", value: "list ads account act_123" },
              { label: "Create post", value: "create post \"Launch update\" page 12345" },
              { label: "AI parse", value: "/ai show my facebook pages" }
            ]}
            onChange={(value) => {
              setShowPalette(false);
              dispatch({ type: "SET_INPUT", value });
              void parseAndQueueIntent(value);
            }}
          />
        </Box>
      ) : null}

      {showHelp ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent}>help</Text>
          <Text color={theme.text}>Workflow: describe, plan, approve, execute, review.</Text>
          <Text color={theme.text}>Commands: /help /doctor /status /config /logs /replay /why /ai ...</Text>
          <Text color={theme.text}>Keys: Enter send/confirm, a approve, r reject, e edit slots, d diagnostics.</Text>
          <Text color={theme.muted}>UI: / palette, x collapse/expand diagnostics (verbose), up/down history, q quit.</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={theme.accent}>{inputLabel}</Text>
        <TextInput value={inputValue} onChange={setInputValue} focus />
      </Box>
      <Text color={state.currentRisk === "HIGH" ? riskTone : theme.muted}>{actionHint}</Text>
    </Box>
  );
}

import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Select, StatusMessage } from "@inkjs/ui";
import TextInput from "ink-text-input";

import { getExecutor } from "../executors/registry.js";
import { applySlotEdits, parseNaturalLanguageWithOptionalAi } from "../parser/intent-parser.js";
import { INITIAL_STATE, reducer } from "../state/machine.js";
import type { ActionQueueItem, LogEntry, ParsedIntent } from "../types.js";
import { FooterBar } from "../ui/components/FooterBar.js";
import { HeaderBar } from "../ui/components/HeaderBar.js";
import { Panel } from "../ui/components/Panel.js";
import { ThemeProvider, useTheme } from "../ui/theme.js";
import { handleSlashCommand } from "./tui-command-handlers.js";
import { handleShortcut } from "./tui-event-handlers.js";
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

function explainPlan(intent: ParsedIntent | null, risk: string | null): string {
  if (!intent) return "No active plan yet. Send a request first.";
  const actionReason: Record<string, string> = {
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

  const runExecution = useCallback(async (): Promise<void> => {
    if (!state.currentIntent) return;
    const current = queueItem(state.currentIntent.action, state.currentIntent.params);
    dispatch({ type: "QUEUE_ADD", item: current });
    dispatch({ type: "QUEUE_UPDATE", id: current.id, status: "RUNNING" });
    dispatch({ type: "MARK_EXECUTING" });
    dispatch({ type: "LOG_ADD", entry: newLog("INFO", `Executing ${state.currentIntent.action}`) });
    await streamPhase("Executing", state.currentIntent.action);

    try {
      const executor = getExecutor(state.currentIntent.action);
      await streamPhase("Validating", "risk gate and required fields");
      const res = await executor.execute(state.currentIntent);
      dispatch({ type: "QUEUE_UPDATE", id: current.id, status: res.ok ? "DONE" : "FAILED" });
      dispatch({ type: "SET_RESULT", result: res.output });
      dispatch({
        type: "LOG_ADD",
        entry: newLog(res.ok ? "SUCCESS" : "ERROR", res.ok ? "Execution completed." : "Execution failed.")
      });
      await streamAssistantTurn(res.ok ? "Done. I executed that successfully." : "Execution failed. Check logs/results.");
      await streamAssistantTurn(`tool_result: ${state.currentIntent.action} -> ${res.ok ? "ok" : "failed"}`);
      const summaryKeys = Object.keys(res.output || {}).slice(0, 5);
      await streamAssistantTurn(
        `Execution summary: queue=${current.id}, status=${res.ok ? "success" : "failed"}, output_keys=${summaryKeys.join(", ") || "none"}.`
      );
      if (res.rollback) {
        dispatch({
          type: "ROLLBACK_ADD",
          item: {
            at: new Date().toISOString(),
            action: state.currentIntent.action,
            note: res.rollback.note,
            status: res.rollback.status
          }
        });
      }
      void refreshLogs();
    } catch (error) {
      dispatch({ type: "QUEUE_UPDATE", id: current.id, status: "FAILED" });
      dispatch({ type: "SET_RESULT", result: { ok: false, error: String((error as Error)?.message || error) } });
      dispatch({ type: "LOG_ADD", entry: newLog("ERROR", `Execution error: ${String((error as Error)?.message || error)}`) });
      await streamAssistantTurn(`Execution error: ${String((error as Error)?.message || error)}`);
    }
  }, [refreshLogs, state.currentIntent, streamAssistantTurn]);

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

    await streamPhase("Reading request");
    await streamPhase("Parsing intent");
    const parsed = await parseNaturalLanguageWithOptionalAi(raw);
    await streamPhase("Planning", parsed.intent.action);
    await streamAssistantTurn(formatToolCall(parsed.intent));
    dispatch({
      type: "PARSE_READY",
      intent: parsed.intent,
      risk: getExecutor(parsed.intent.action).risk,
      missingSlots: parsed.missingSlots
    });
    dispatch({ type: "LOG_ADD", entry: newLog("INFO", `${(parsed.source || "deterministic").toUpperCase()} parsed intent: ${JSON.stringify(parsed.intent)}`) });
    await streamAssistantTurn(summarizeIntent(parsed.intent, getExecutor(parsed.intent.action).risk, parsed.missingSlots));

    if (!parsed.valid) {
      dispatch({ type: "LOG_ADD", entry: newLog("WARN", parsed.errors.join("; ") || "Intent parsed with warnings.") });
    }
    if (parsed.missingSlots.length > 0) {
      addTurn("assistant", `I need these fields: ${parsed.missingSlots.join(", ")}. Press e to edit slots.`);
      return;
    }
    if (getExecutor(parsed.intent.action).risk === "LOW") {
      dispatch({ type: "APPROVED", auto: true });
      await streamAssistantTurn("Low-risk action. Auto-executing.");
      await runExecution();
      return;
    }
    await streamAssistantTurn("Awaiting approval. Press Enter or a to continue.");
  }, [addTurn, runExecution, state.currentIntent, state.currentRisk, streamAssistantTurn, streamPhase]);

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
      dispatch({
        type: "PARSE_READY",
        intent: edited.intent,
        risk: getExecutor(edited.intent.action).risk,
        missingSlots: edited.missingSlots
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
      await runExecution();
      return;
    }

    if (state.phase === "HIGH_RISK_APPROVAL") {
      if (!state.approvalReason.trim()) {
        await streamAssistantTurn("Approval reason required for high-risk action.");
        return;
      }
      dispatch({ type: "APPROVED", reason: state.approvalReason.trim() });
      await runExecution();
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
      onDetails: () => dispatch({ type: "TOGGLE_DETAILS" }),
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
  const riskTone = state.currentRisk === "HIGH" ? theme.error : state.currentRisk === "MEDIUM" ? theme.warning : theme.success;
  const phaseTone = state.phase === "EXECUTING" ? theme.accent : state.phase === "REJECTED" ? theme.warning : theme.text;
  const topActivity = state.liveLogs[state.liveLogs.length - 1];

  const accountOptions = accountOptionsFromConfig(config || {
    tokenSet: false,
    graphVersion: "v20.0",
    scopes: [],
    tokenMap: { facebook: false, instagram: false, whatsapp: false }
  });

  const queueLines = state.actionQueue.length
    ? state.actionQueue.map((x) => (
      <Text key={x.id} color={x.status === "FAILED" ? theme.error : x.status === "RUNNING" ? theme.accent : theme.text}>
        {shortTime(x.createdAt)} {x.action} [{x.status}]
      </Text>
    ))
    : [<Text key="q0" color={theme.muted}>No queued actions.</Text>];
  const liveLogLines = state.liveLogs.length
    ? state.liveLogs.slice(-12).map((x, idx) => (
      <Text key={`l-${idx}`} color={logLevelColor(x.level)}>
        [{shortTime(x.at)}] {logLevelGlyph(x.level)} {x.message}
      </Text>
    ))
    : [<Text key="l0" color={theme.muted}>No runtime logs yet.</Text>];
  const resultLines = state.results
    ? [<Text key="r0" color={theme.text}>{JSON.stringify(state.results, null, 2)}</Text>]
    : [<Text key="r1" color={theme.muted}>No results yet.</Text>];

  return (
    <Box flexDirection="column" height={30}>
      <HeaderBar
        title="Social Flow Hatch"
        connected={connectedCount}
        total={3}
        phase={state.phase}
        risk={state.currentRisk || "LOW"}
        account={selectedAccount}
        ai={aiLabel}
      />
      <Box marginY={1} justifyContent="space-between">
        <Text color={phaseTone}>phase: {state.phase.toLowerCase()}</Text>
        <Text color={riskTone}>risk: {(state.currentRisk || "LOW").toLowerCase()}</Text>
        <Text color={theme.muted}>latest: {topActivity ? `${shortTime(topActivity.at)} ${topActivity.message.slice(0, 44)}` : "idle"}</Text>
      </Box>

      <Box flexGrow={1} flexDirection="row">
        <Box width={rightRailCollapsed ? "100%" : "68%"} marginRight={rightRailCollapsed ? 0 : 1} flexDirection="column">
          <Panel title="CHAT" subtitle="conversation stream" focused>
            {chatTurns.slice(-16).map((turn) => (
              <Text key={turn.id} color={turn.role === "user" ? theme.accent : turn.role === "assistant" ? theme.text : theme.muted}>
                [{shortTime(turn.at)}] {roleGlyph(turn.role)}: {turn.text || "..."}
              </Text>
            ))}
          </Panel>
          <Panel title="LIVE_LOGS" subtitle="runtime telemetry">{liveLogLines}</Panel>
          <Panel title="RESULTS" subtitle="last execution output">{resultLines}</Panel>
        </Box>

        {!rightRailCollapsed ? (
          <Box width="32%" flexDirection="column">
            <Panel title="PLAN" subtitle="intent + approval context">
              <Text color={theme.text}>Action: {state.currentIntent?.action || "none"}</Text>
              <Text color={riskTone}>Risk: {state.currentRisk || "none"}</Text>
              <Text color={theme.muted}>Missing: {state.missingSlots.join(", ") || "none"}</Text>
              <Text color={phaseTone}>Phase: {state.phase}</Text>
            </Panel>
            <Panel title="ACTIONS_QUEUE" subtitle="recent operations">{queueLines}</Panel>
            <Panel title="APPROVALS" subtitle="risk policy">
              <Text color={theme.muted}>LOW auto | MEDIUM confirm | HIGH reason + confirm</Text>
              <Text color={theme.muted}>Shortcuts: Enter/a/r/e/d</Text>
            </Panel>
            <Panel title="ROLLBACK" subtitle="safety trail">
              {state.rollbackHistory.length
                ? state.rollbackHistory.slice(-5).map((x) => <Text key={`${x.at}_${x.action}`} color={theme.text}>{x.action} {x.status}</Text>)
                : <Text color={theme.muted}>No rollback entries.</Text>}
            </Panel>
            <Panel title="SESSION" subtitle="workspace context">
              {configState.loading ? <StatusMessage variant="info">Loading config...</StatusMessage> : null}
              {configState.error ? <StatusMessage variant="error">{configState.error}</StatusMessage> : null}
              <Text color={theme.muted}>Graph: {config?.graphVersion || "v20.0"}</Text>
              <Text color={theme.muted}>Account: {selectedAccount}</Text>
              <Select options={accountOptions} onChange={(value) => setSelectedAccount(value)} />
            </Panel>
          </Box>
        ) : null}
      </Box>

      <Box borderStyle="round" borderColor={theme.accent} paddingX={1} marginBottom={1}>
        <Text color={theme.accent}>{inputLabel}</Text>
        <TextInput value={inputValue} onChange={setInputValue} focus />
      </Box>

      {replaySuggestions.length > 0 ? (
        <Box marginBottom={1} borderStyle="single" borderColor={theme.muted} paddingX={1} flexDirection="column">
          <Text color={theme.muted}>replay suggestions (up/down):</Text>
          {replaySuggestions.map((item, idx) => (
            <Text key={item.id} color={idx === replaySuggestionIndex ? theme.accent : theme.text}>
              {idx === replaySuggestionIndex ? ">" : " "} {item.id} {item.action}
            </Text>
          ))}
        </Box>
      ) : null}

      {showPalette ? (
        <Panel title="COMMAND_PALETTE" subtitle="quick actions" focused>
          <Select
            options={[
              { label: "Doctor", value: "doctor" },
              { label: "Status", value: "status" },
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
        </Panel>
      ) : null}

      {showHelp ? (
        <Panel title="HELP" subtitle="keyboard map" focused>
          <Text color={theme.text}>Workflow: describe, plan, approve, execute, and review.</Text>
          <Text color={theme.text}>Commands: /help /doctor /status /config /logs /replay /why /ai ...</Text>
          <Text color={theme.text}>Keys: Enter send/confirm, a approve, r reject, e edit slots, d details.</Text>
          <Text color={theme.muted}>UI: / palette, x toggle right rail, up/down history or replay suggestions, q quit.</Text>
        </Panel>
      ) : null}

      <FooterBar hint="enter send/confirm | / palette | a approve | r reject | e edit | d details | x rail | q quit" />
    </Box>
  );
}

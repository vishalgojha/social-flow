import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Badge, Select, StatusMessage } from "@inkjs/ui";
import TextInput from "ink-text-input";
import chalk from "chalk";

import { getExecutor } from "../executors/registry.js";
import { applySlotEdits, parseNaturalLanguageWithOptionalAi } from "../parser/intent-parser.js";
import { INITIAL_STATE, reducer } from "../state/machine.js";
import type { ActionQueueItem, LogEntry } from "../types.js";
import { FooterBar } from "./components/FooterBar.js";
import { HeaderBar } from "./components/HeaderBar.js";
import { Panel } from "./components/Panel.js";
import { ThemeProvider, useTheme } from "./theme.js";

const NAV_ITEMS = ["overview", "accounts", "posts_ads", "logs_replay"] as const;
type NavItem = (typeof NAV_ITEMS)[number];
const FOCUS_AREAS = ["input", "nav", "content"] as const;
type FocusArea = (typeof FOCUS_AREAS)[number];

interface ConfigSnapshot {
  tokenSet: boolean;
  graphVersion: string;
  scopes: string[];
  tokenMap: {
    facebook: boolean;
    instagram: boolean;
    whatsapp: boolean;
  };
  defaultPageId?: string;
  defaultAdAccountId?: string;
}

interface PersistedLog {
  id: string;
  timestamp: string;
  action: string;
  params: Record<string, string>;
  latency: number;
  success: boolean;
  rollback_plan: string;
  error?: string;
}

interface LoadState<T> {
  loading: boolean;
  error: string | null;
  data: T;
}

function newLog(level: LogEntry["level"], message: string): LogEntry {
  return { at: new Date().toISOString(), level, message };
}

function formatLiveLog(entry: LogEntry): string {
  const base = `${entry.at} ${entry.level} ${entry.message}`;
  if (entry.level === "ERROR") return chalk.red(base);
  if (entry.level === "WARN") return chalk.yellow(base);
  if (entry.level === "SUCCESS") return chalk.green(base);
  return chalk.cyan(base);
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

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLogDir(): Promise<string> {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "logs"),
    path.join(cwd, "..", "logs"),
    path.join(cwd, "..", "..", "logs")
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return candidates[0];
}

async function loadConfigSnapshot(): Promise<ConfigSnapshot> {
  const cfgPath = path.join(os.homedir(), ".social-cli", "config.json");
  const raw = await readFile(cfgPath, "utf8");
  const parsed = JSON.parse(raw) as {
    token?: string;
    tokens?: {
      facebook?: string;
      instagram?: string;
      whatsapp?: string;
    };
    graphVersion?: string;
    scopes?: string[];
    defaultPageId?: string;
    defaultAdAccountId?: string;
  };
  const tokenMap = {
    facebook: !!parsed?.tokens?.facebook || !!parsed?.token,
    instagram: !!parsed?.tokens?.instagram,
    whatsapp: !!parsed?.tokens?.whatsapp
  };
  return {
    tokenSet: tokenMap.facebook || tokenMap.instagram || tokenMap.whatsapp,
    graphVersion: parsed.graphVersion || "v20.0",
    scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map((x) => String(x)) : [],
    tokenMap,
    defaultPageId: parsed.defaultPageId,
    defaultAdAccountId: parsed.defaultAdAccountId
  };
}

async function loadPersistedLogs(): Promise<PersistedLog[]> {
  const logDir = await resolveLogDir();
  if (!(await exists(logDir))) return [];

  const files = (await readdir(logDir)).filter((x) => x.endsWith(".json"));
  const logs: PersistedLog[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(path.join(logDir, file), "utf8");
      const parsed = JSON.parse(raw) as PersistedLog;
      if (parsed && parsed.id && parsed.timestamp) logs.push(parsed);
    } catch {}
  }
  logs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return logs.slice(0, 20);
}

function accountOptionsFromConfig(config: ConfigSnapshot): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [{ label: "default", value: "default" }];
  if (config.defaultPageId) out.push({ label: `page:${config.defaultPageId}`, value: `page:${config.defaultPageId}` });
  if (config.defaultAdAccountId) out.push({ label: `ad:${config.defaultAdAccountId}`, value: `ad:${config.defaultAdAccountId}` });
  return out;
}

function replayInputFromLog(log: PersistedLog): string | null {
  const action = String(log.action || "");
  if (action === "get:profile") {
    return "get my facebook profile";
  }
  if (action === "list:ads") {
    const adAccount = log.params?.adAccountId || "";
    return adAccount ? `list ads account ${adAccount}` : "list ads";
  }
  if (action === "create:post") {
    const message = log.params?.message || "";
    if (!message) return null;
    const pageId = log.params?.pageId || "";
    return pageId ? `create post "${message}" page ${pageId}` : `create post "${message}"`;
  }
  return null;
}

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>
  );
}

function Dashboard(): JSX.Element {
  const theme = useTheme();
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [activeNav, setActiveNav] = useState<NavItem>("overview");
  const [focusArea, setFocusArea] = useState<FocusArea>("input");
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [selectedAccount, setSelectedAccount] = useState<string>("default");
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
  const [selectedQuickAction, setSelectedQuickAction] = useState<string>("doctor");
  const [selectedReplayId, setSelectedReplayId] = useState<string>("");
  const [replaySuggestionIndex, setReplaySuggestionIndex] = useState<number>(0);
  const [rightRailCollapsed, setRightRailCollapsed] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);

  const cycleNav = (delta: 1 | -1): void => {
    const idx = NAV_ITEMS.indexOf(activeNav);
    const next = (idx + delta + NAV_ITEMS.length) % NAV_ITEMS.length;
    setActiveNav(NAV_ITEMS[next]);
  };

  const cycleFocus = (): void => {
    const idx = FOCUS_AREAS.indexOf(focusArea);
    const next = (idx + 1) % FOCUS_AREAS.length;
    setFocusArea(FOCUS_AREAS[next]);
  };

  const refreshConfig = useCallback(async () => {
    setConfigState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const cfg = await loadConfigSnapshot();
      setConfigState({ loading: false, error: null, data: cfg });
      if (selectedAccount === "default") {
        const options = accountOptionsFromConfig(cfg);
        if (options.length > 0) setSelectedAccount(options[0].value);
      }
    } catch (err) {
      setConfigState({
        loading: false,
        error: String((err as Error)?.message || err),
        data: null
      });
    }
  }, [selectedAccount]);

  const refreshLogs = useCallback(async () => {
    setLogsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const logs = await loadPersistedLogs();
      setLogsState({ loading: false, error: null, data: logs });
    } catch (err) {
      setLogsState({
        loading: false,
        error: String((err as Error)?.message || err),
        data: []
      });
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

  const runExecution = async (): Promise<void> => {
    if (!state.currentIntent) return;
    const current = queueItem(state.currentIntent.action, state.currentIntent.params);
    dispatch({ type: "QUEUE_ADD", item: current });
    dispatch({ type: "QUEUE_UPDATE", id: current.id, status: "RUNNING" });
    dispatch({ type: "MARK_EXECUTING" });
    dispatch({ type: "LOG_ADD", entry: newLog("INFO", `Executing ${state.currentIntent.action}`) });

    try {
      const executor = getExecutor(state.currentIntent.action);
      const res = await executor.execute(state.currentIntent);
      dispatch({ type: "QUEUE_UPDATE", id: current.id, status: res.ok ? "DONE" : "FAILED" });
      dispatch({ type: "SET_RESULT", result: res.output });
      dispatch({
        type: "LOG_ADD",
        entry: newLog(res.ok ? "SUCCESS" : "ERROR", res.ok ? "Execution completed." : "Execution failed.")
      });
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
      dispatch({
        type: "SET_RESULT",
        result: { ok: false, error: String((error as Error)?.message || error) }
      });
      dispatch({
        type: "LOG_ADD",
        entry: newLog("ERROR", `Execution error: ${String((error as Error)?.message || error)}`)
      });
    }
  };

  const parseAndQueueIntent = async (raw: string): Promise<void> => {
    const parsed = await parseNaturalLanguageWithOptionalAi(raw);
    dispatch({
      type: "PARSE_READY",
      intent: parsed.intent,
      risk: getExecutor(parsed.intent.action).risk,
      missingSlots: parsed.missingSlots
    });
    if (!parsed.valid) {
      dispatch({
        type: "LOG_ADD",
        entry: newLog("WARN", parsed.errors.join("; ") || "Intent parsed with warnings.")
      });
    }
    dispatch({
      type: "LOG_ADD",
      entry: newLog("INFO", `${(parsed.source || "deterministic").toUpperCase()} parsed intent: ${JSON.stringify(parsed.intent)}`)
    });
    if (parsed.missingSlots.length > 0) {
      dispatch({
        type: "LOG_ADD",
        entry: newLog("WARN", `Missing fields: ${parsed.missingSlots.join(", ")} (press e to edit)`)
      });
      return;
    }
    if (getExecutor(parsed.intent.action).risk === "LOW") {
      dispatch({ type: "APPROVED", auto: true });
      await runExecution();
    }
  };

  const confirmOrExecute = async (): Promise<void> => {
    if (state.phase === "INPUT") {
      await parseAndQueueIntent(state.input);
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
      dispatch({
        type: "LOG_ADD",
        entry: newLog(
          edited.missingSlots.length > 0 ? "WARN" : "SUCCESS",
          edited.missingSlots.length > 0 ? `Still missing: ${edited.missingSlots.join(", ")}` : "Slots updated."
        )
      });
      return;
    }

    if (state.phase === "APPROVAL") {
      if (!state.currentIntent || !state.currentRisk) return;
      if (state.missingSlots.length > 0) {
        dispatch({ type: "LOG_ADD", entry: newLog("WARN", "Missing required slots. Press e to edit.") });
        return;
      }
      if (state.currentRisk === "HIGH") {
        dispatch({ type: "HIGH_CONFIRM_STEP_1" });
        if (state.currentIntent.action === "replay") {
          const replayId = state.currentIntent.params.id || "";
          const preview = replayId === "latest" || replayId === "last"
            ? logsState.data[0]
            : logsState.data.find((x) => x.id === replayId);
          dispatch({
            type: "LOG_ADD",
            entry: newLog("WARN", preview
              ? `Replay dry-run: ${preview.id} ${preview.action} ${preview.timestamp}. Add reason then confirm.`
              : `Replay dry-run: log ${replayId || "(missing)"} not found in cached logs. Add reason then confirm.`)
          });
        }
        dispatch({
          type: "LOG_ADD",
          entry: newLog("WARN", "HIGH risk requires elevated approval. Add reason and confirm.")
        });
        return;
      }
      dispatch({ type: "APPROVED" });
      await runExecution();
      return;
    }

    if (state.phase === "HIGH_RISK_APPROVAL") {
      if (!state.approvalReason.trim()) {
        dispatch({
          type: "LOG_ADD",
          entry: newLog("WARN", "Approval reason required for HIGH risk action.")
        });
        return;
      }
      dispatch({ type: "APPROVED", reason: state.approvalReason.trim() });
      await runExecution();
      return;
    }

    if (state.phase === "RESULT" || state.phase === "REJECTED") {
      dispatch({ type: "RESET_FLOW" });
    }
  };

  const approveAction = async (): Promise<void> => {
    if (state.phase !== "APPROVAL" && state.phase !== "HIGH_RISK_APPROVAL") return;
    await confirmOrExecute();
  };

  const rejectAction = (): void => {
    if (!state.currentIntent) return;
    dispatch({ type: "REJECTED", reason: "Rejected by operator." });
    dispatch({ type: "LOG_ADD", entry: newLog("WARN", "Action rejected.") });
    const rejected = queueItem(state.currentIntent.action, state.currentIntent.params);
    rejected.status = "REJECTED";
    dispatch({ type: "QUEUE_ADD", item: rejected });
    dispatch({ type: "SET_RESULT", result: { ok: false, reason: "Rejected by operator." } });
  };

  const executeQuickAction = async (value: string): Promise<void> => {
    setSelectedQuickAction(value);
    dispatch({ type: "SET_INPUT", value });
    await parseAndQueueIntent(value);
  };

  const executeReplayFromLog = async (id: string): Promise<void> => {
    setSelectedReplayId(id);
    const target = logsState.data.find((x) => x.id === id);
    if (!target) {
      dispatch({ type: "LOG_ADD", entry: newLog("ERROR", `Replay log not found: ${id}`) });
      return;
    }
    const replayInput = replayInputFromLog(target);
    if (!replayInput) {
      dispatch({ type: "LOG_ADD", entry: newLog("WARN", `Replay unsupported for action ${target.action}`) });
      return;
    }
    dispatch({ type: "LOG_ADD", entry: newLog("INFO", `Replaying ${target.id} as "${replayInput}"`) });
    await executeQuickAction(replayInput);
  };

  const replaySuggestions = useMemo(() => {
    if (state.phase !== "INPUT") return [] as PersistedLog[];
    const text = state.input.trim();
    if (!/^replay\b/i.test(text)) return [] as PersistedLog[];
    const query = text.replace(/^replay\s*/i, "").trim().toLowerCase();
    if (!query || query === "latest" || query === "last") return logsState.data.slice(0, 6);
    return logsState.data.filter((x) => x.id.toLowerCase().startsWith(query)).slice(0, 6);
  }, [logsState.data, state.input, state.phase]);

  useEffect(() => {
    if (!replaySuggestions.length) {
      setReplaySuggestionIndex(0);
      return;
    }
    if (replaySuggestionIndex >= replaySuggestions.length) {
      setReplaySuggestionIndex(0);
    }
  }, [replaySuggestionIndex, replaySuggestions]);

  const maybeAutocompleteReplayInput = (): boolean => {
    if (state.phase !== "INPUT") return false;
    const text = state.input.trim();
    if (!/^replay\b/i.test(text) || !replaySuggestions.length) return false;
    const query = text.replace(/^replay\s*/i, "").trim().toLowerCase();
    const selected = replaySuggestions[replaySuggestionIndex] || replaySuggestions[0];
    const isCompleteId = !!query && logsState.data.some((x) => x.id.toLowerCase() === query);
    if (isCompleteId) return false;
    dispatch({ type: "SET_INPUT", value: `replay ${selected.id}` });
    dispatch({
      type: "LOG_ADD",
      entry: newLog("INFO", `Autocomplete selected replay id ${selected.id}. Press Enter again to confirm.`)
    });
    return true;
  };

  useInput((input, key) => {
    if (commandPaletteOpen) {
      if (key.escape || input === "/" || input === "q") {
        setCommandPaletteOpen(false);
      }
      return;
    }

    if (showHelp) {
      if (input === "?" || key.escape || input === "q") setShowHelp(false);
      return;
    }

    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (input === "?") {
      setShowHelp(true);
      return;
    }
    if (input === "u") {
      void refreshConfig();
      void refreshLogs();
      dispatch({ type: "LOG_ADD", entry: newLog("INFO", "Dashboard data refreshed.") });
      return;
    }
    if (input === "/") {
      setCommandPaletteOpen(true);
      return;
    }
    if (input === "x") {
      setRightRailCollapsed((prev) => !prev);
      return;
    }
    if (key.tab) {
      cycleFocus();
      return;
    }
    if (focusArea === "nav" && (key.upArrow || key.leftArrow)) {
      cycleNav(-1);
      return;
    }
    if (focusArea === "nav" && (key.downArrow || key.rightArrow)) {
      cycleNav(1);
      return;
    }
    if (focusArea === "input" && replaySuggestions.length && key.upArrow) {
      setReplaySuggestionIndex((prev) => {
        if (prev === 0) return replaySuggestions.length - 1;
        return prev - 1;
      });
      return;
    }
    if (focusArea === "input" && replaySuggestions.length && key.downArrow) {
      setReplaySuggestionIndex((prev) => (prev + 1) % replaySuggestions.length);
      return;
    }
    if (focusArea === "content" && (activeNav === "accounts" || activeNav === "posts_ads" || activeNav === "logs_replay") && (key.upArrow || key.downArrow || key.return)) {
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (input === "d") {
      dispatch({ type: "TOGGLE_DETAILS" });
      return;
    }
    if (input === "e") {
      if (state.currentIntent) {
        dispatch({ type: "REQUEST_EDIT" });
        dispatch({ type: "LOG_ADD", entry: newLog("INFO", "Edit mode enabled. Type key=value and press Enter.") });
      }
      return;
    }
    if (input === "a") {
      void approveAction();
      return;
    }
    if (input === "r") {
      rejectAction();
      return;
    }
    if (key.return && focusArea !== "content") {
      if (focusArea === "input" && maybeAutocompleteReplayInput()) return;
      void confirmOrExecute();
    }
  });

  const planLines = useMemo(() => {
    if (!state.currentIntent) return [<Text key="p0" color={theme.muted}>No plan yet.</Text>];
    const lines: React.ReactNode[] = [
      <Text key="p1" color={theme.text}>Action: {state.currentIntent.action}</Text>,
      <Text key="p2" color={theme.text}>Risk: {state.currentRisk}</Text>,
      <Text key="p3" color={theme.text}>Missing: {state.missingSlots.join(", ") || "none"}</Text>
    ];
    if (state.showDetails) lines.push(<Text key="p4" color={theme.muted}>{JSON.stringify(state.currentIntent.params, null, 2)}</Text>);
    return lines;
  }, [state.currentIntent, state.currentRisk, state.missingSlots, state.showDetails, theme.muted, theme.text]);

  const queueLines = state.actionQueue.length
    ? state.actionQueue.map((x) => <Text key={x.id} color={theme.text}>{x.id} {x.action} {x.status}</Text>)
    : [<Text key="q0" color={theme.muted}>No queued actions.</Text>];

  const liveLogLines = state.liveLogs.length
    ? state.liveLogs.map((x, idx) => <Text key={`l-${idx}`} color={theme.text}>{formatLiveLog(x)}</Text>)
    : [<Text key="l0" color={theme.muted}>No runtime logs yet.</Text>];

  const persistedLogLines = logsState.data.length
    ? logsState.data.slice(0, 8).map((x) => (
      <Text key={x.id} color={x.success ? theme.text : theme.warning}>
        {x.timestamp} {x.action} {x.success ? "ok" : "fail"} {x.latency}ms
      </Text>
    ))
    : [<Text key="pl0" color={theme.muted}>No persisted logs in ./logs.</Text>];

  const approvalLines = [
    <Text key="a0" color={theme.text}>Phase: {state.phase}</Text>,
    <Text key="a1" color={theme.muted}>Risk policy: LOW auto, MEDIUM confirm, HIGH elevated approval</Text>,
    <Text key="a2" color={theme.muted}>Use `/ai ...` to parse with Ollama/OpenAI-compatible models.</Text>,
    state.currentIntent?.action === "replay"
      ? <Text key="a4" color={theme.warning}>
        Replay dry-run: {(() => {
          const rawId = state.currentIntent?.params?.id || "";
          const preview = rawId === "latest" || rawId === "last"
            ? logsState.data[0]
            : logsState.data.find((x) => x.id === rawId);
          if (!preview) return `log id ${rawId || "(missing)"} not in current cache`;
          return `${preview.id} ${preview.action} ${preview.timestamp} ${preview.success ? "ok" : "fail"}`;
        })()}
      </Text>
      : null,
    state.phase === "HIGH_RISK_APPROVAL" ? <Text key="a3" color={theme.warning}>Reason: {state.approvalReason || "(required)"}</Text> : null
  ].filter(Boolean) as React.ReactNode[];

  const resultLines = state.results
    ? [<Text key="r0" color={theme.text}>{JSON.stringify(state.results, null, 2)}</Text>]
    : [<Text key="r1" color={theme.muted}>No results yet.</Text>];

  const rollbackLines: React.ReactNode[] = [];
  for (const item of state.rollbackHistory.slice(-5)) {
    rollbackLines.push(<Text key={`${item.at}-${item.action}`} color={theme.text}>{item.at} {item.action} {item.status} {item.note}</Text>);
  }
  for (const item of logsState.data.slice(0, 5)) {
    rollbackLines.push(<Text key={`p-${item.id}`} color={theme.muted}>{item.timestamp} {item.action} rollback: {item.rollback_plan}</Text>);
  }
  if (!rollbackLines.length) rollbackLines.push(<Text key="rb0" color={theme.muted}>No rollback history yet.</Text>);

  const inputValue = state.phase === "EDIT_SLOTS" ? state.editInput : state.phase === "HIGH_RISK_APPROVAL" ? state.approvalReason : state.input;

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

  const inputLabel = state.phase === "EDIT_SLOTS"
    ? "edit_slots (key=value): "
    : state.phase === "HIGH_RISK_APPROVAL"
      ? "elevated_approval_reason: "
      : "intent: ";

  const config = configState.data;
  const platformStatus = {
    instagram: !!config?.tokenMap.instagram || !!config?.scopes.find((x) => x.includes("instagram")),
    facebook: !!config?.tokenMap.facebook || !!config?.tokenSet,
    ads: !!config?.scopes.find((x) => x.includes("ads")) || !!config?.tokenMap.facebook
  };
  const connectedCount = [platformStatus.instagram, platformStatus.facebook, platformStatus.ads].filter(Boolean).length;

  const navLines = NAV_ITEMS.map((item) => (
    <Text key={item} color={activeNav === item ? theme.accent : theme.text}>
      {activeNav === item ? ">" : " "} {item.replace("_", " ")}
    </Text>
  ));

  const helpLines: React.ReactNode[] = [
    <Text key="h1" color={theme.text}>Focus areas: input | nav | content (Tab cycles)</Text>,
    <Text key="h2" color={theme.text}>Enter: execute_or_confirm (except content selectors)</Text>,
    <Text key="h3" color={theme.text}>a: approve | r: reject | e: edit_slots | d: details | u: refresh</Text>,
    <Text key="h4" color={theme.text}>Arrow keys move nav when nav focus is active</Text>,
    <Text key="h5" color={theme.text}>Try: doctor | status | config | logs limit 10 | replay &lt;id&gt; | /ai ...</Text>,
    <Text key="h6" color={theme.muted}>Press ? or Esc to close help</Text>
  ];

  const accountOptions = accountOptionsFromConfig(config || {
    tokenSet: false,
    graphVersion: "v20.0",
    scopes: [],
    tokenMap: {
      facebook: false,
      instagram: false,
      whatsapp: false
    }
  });

  return (
    <Box flexDirection="column" height={28}>
      <HeaderBar title="Social CLI Agent Console" connected={connectedCount} total={3} />

      <Box flexGrow={1} flexDirection="row">
        <Box width={rightRailCollapsed ? "100%" : "67%"} marginRight={rightRailCollapsed ? 0 : 1} flexDirection="column">
          <Panel title="LIVE_LOGS" focused>
            {logsState.loading ? <StatusMessage variant="info">Loading logs...</StatusMessage> : null}
            {logsState.error ? <StatusMessage variant="error">{logsState.error}</StatusMessage> : null}
            {liveLogLines}
          </Panel>
          <Panel title="RESULTS">{resultLines}</Panel>
          <Panel title="RECENT_LOGS">{persistedLogLines}</Panel>
        </Box>

        {!rightRailCollapsed ? (
          <Box width="33%" flexDirection="column">
            <Panel title="PLAN" focused>{planLines}</Panel>
            <Panel title="ACTIONS_QUEUE">{queueLines}</Panel>
            <Panel title="APPROVALS">{approvalLines}</Panel>
            <Panel title="ROLLBACK">{rollbackLines}</Panel>
          </Box>
        ) : null}
      </Box>

      <Box borderStyle="round" borderColor={theme.accent} paddingX={1} marginBottom={1}>
        <Text color={theme.accent}>{inputLabel}</Text>
        <TextInput value={inputValue} onChange={setInputValue} focus />
      </Box>

      {replaySuggestions.length > 0 ? (
        <Box marginBottom={1} borderStyle="single" borderColor={theme.muted} paddingX={1}>
          <Text color={theme.muted}>replay suggestions (up/down): </Text>
          {replaySuggestions.map((item, idx) => (
            <Text key={item.id} color={idx === replaySuggestionIndex ? theme.accent : theme.text}>
              {idx === replaySuggestionIndex ? ">" : " "} {item.id} {item.action}
            </Text>
          ))}
        </Box>
      ) : null}

      {showHelp ? <Panel title="HELP" focused>{helpLines}</Panel> : null}
      {commandPaletteOpen ? (
        <Panel title="COMMAND_PALETTE" focused>
          <Select
            options={[
              { label: "Doctor", value: "doctor" },
              { label: "Status", value: "status" },
              { label: "Config", value: "config" },
              { label: "Logs limit 10", value: "logs limit 10" },
              { label: "Replay latest", value: "replay latest" },
              { label: "Get profile", value: "get my facebook profile" },
              { label: "List ads", value: "list ads account act_123" },
              { label: "Create post", value: "create post \"Launch update\" page 12345" },
              { label: "AI parse", value: "/ai show status and doctor checks" }
            ]}
            onChange={(value) => {
              setCommandPaletteOpen(false);
              void executeQuickAction(value);
            }}
          />
        </Panel>
      ) : null}

      <FooterBar hint={`chat mode | enter: confirm | /:palette | x:toggle rail | a/r/e/d | up/down:replay suggestion | /ai ... | u:refresh | ?:help | q:quit`} />
    </Box>
  );
}

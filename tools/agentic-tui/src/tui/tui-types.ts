export interface ChatTurn {
  id: string;
  at: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface MemoryIntentRecord {
  at: string;
  text: string;
  action: string;
}

export interface MemoryUnresolvedRecord {
  at: string;
  text: string;
  reason: string;
}

export interface HatchMemorySnapshot {
  sessionId: string;
  updatedAt: string;
  profileName: string;
  lastIntents: MemoryIntentRecord[];
  unresolved: MemoryUnresolvedRecord[];
  turns: ChatTurn[];
}

export interface ConfigSnapshot {
  activeProfile?: string;
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
  industry?: {
    mode: string;
    selected: string;
    source: string;
    confidence: number;
    manualLocked: boolean;
  };
}

export interface PersistedLog {
  id: string;
  timestamp: string;
  action: string;
  params: Record<string, string>;
  latency: number;
  success: boolean;
  rollback_plan: string;
  error?: string;
}

export interface LoadState<T> {
  loading: boolean;
  error: string | null;
  data: T;
}


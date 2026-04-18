import type { MemoryMode, Locale } from "../config/schema.js";

export interface RunnerSessionContext {
  sessionId: string;
  workspaceId: string;
  userId: string;
  cwd: string;
  memoryMode: MemoryMode;
  locale: Locale;
}

export interface TurnContext {
  turnId: string;
  taskId?: string;
  traceId?: string | null;
}

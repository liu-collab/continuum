import type { Locale, MemoryMode } from "../config/schema.js";

export interface Session {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string | null;
  memory_mode: MemoryMode;
  locale: Locale;
  created_at: string;
  last_active_at: string;
  closed_at: string | null;
}

export interface SessionSummary extends Session {
  latest_turn_id: string | null;
}

export interface Turn {
  id: string;
  session_id: string;
  turn_index: number;
  task_id: string | null;
  trace_id: string | null;
  created_at: string;
  finish_reason: string | null;
}

export interface Message {
  id: string;
  session_id: string;
  turn_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id: string | null;
  token_in: number | null;
  token_out: number | null;
  created_at: string;
}

export interface ToolInvocation {
  call_id: string;
  session_id: string;
  turn_id: string;
  tool_name: string;
  args_hash: string;
  args_preview: string | null;
  permission_decision: string;
  exit_code: number | null;
  ok: boolean;
  error_code: string | null;
  artifact_ref: string | null;
  duration_ms: number;
  created_at: string;
}

export interface DispatchedMessagesPayload {
  messages_json: string;
  tools_json: string;
  provider_id: string;
  model: string;
  round: number;
  created_at?: string;
}

export interface CreateSessionInput {
  id: string;
  workspace_id: string;
  user_id: string;
  memory_mode: MemoryMode;
  locale: Locale;
  title?: string;
  created_at?: string;
}

export interface AppendMessageInput {
  id: string;
  session_id: string;
  turn_id: string;
  role: Message["role"];
  content: string;
  tool_call_id?: string | null;
  token_in?: number | null;
  token_out?: number | null;
  created_at?: string;
}

export interface OpenTurnInput {
  id: string;
  session_id: string;
  task_id?: string | null;
  created_at?: string;
}

export interface ToolInvocationInput {
  call_id: string;
  session_id: string;
  turn_id: string;
  tool_name: string;
  args_hash: string;
  args_preview?: string | null;
  permission_decision: string;
  exit_code?: number | null;
  ok: boolean;
  error_code?: string | null;
  artifact_ref?: string | null;
  duration_ms: number;
  created_at?: string;
}

export interface SessionListFilter {
  workspace_id?: string;
  limit?: number;
  cursor?: string;
}

export interface SessionStore {
  createSession(input: CreateSessionInput): Session;
  getSession(id: string): Session | null;
  listSessions(filter?: SessionListFilter): { items: SessionSummary[]; next_cursor: string | null };
  updateSession(id: string, patch: Partial<Pick<Session, "title" | "memory_mode" | "closed_at">>): void;
  deleteSession(id: string, opts: { purgeArtifacts: boolean }): void;

  openTurn(input: OpenTurnInput): Turn;
  appendMessage(input: AppendMessageInput): void;
  closeTurn(turn_id: string, finish_reason: string, trace_id?: string): void;
  getTurn(turn_id: string): { turn: Turn; messages: Message[]; tool_invocations: ToolInvocation[] } | null;
  getMessages(session_id: string, opts?: { before_turn_index?: number; limit?: number }): Message[];

  recordToolInvocation(input: ToolInvocationInput): void;

  saveDispatchedMessages(turn_id: string, payload: DispatchedMessagesPayload): void;
  getDispatchedMessages(turn_id: string): DispatchedMessagesPayload | null;

  markInterruptedTurnsAsCrashed(): number;
  close(): void;
}

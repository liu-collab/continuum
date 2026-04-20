export type AgentLocale = "zh-CN" | "en-US";
export type AgentMemoryMode = "workspace_only" | "workspace_plus_global";
export type AgentConnectionState = "connecting" | "open" | "reconnecting" | "closed";
export type AgentToolTrustLevel = "builtin_read" | "builtin_write" | "shell" | `mcp:${string}`;

export type MnaApiError = {
  error: {
    code: string;
    message: string;
  };
};

export type MnaSessionSummary = {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string | null;
  memory_mode: AgentMemoryMode;
  locale: AgentLocale;
  created_at: string;
  last_active_at: string;
  closed_at: string | null;
  latest_turn_id: string | null;
};

export type MnaSessionListResponse = {
  items: MnaSessionSummary[];
  next_cursor: string | null;
};

export type MnaSessionMessage = {
  id: string;
  session_id: string;
  turn_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id: string | null;
  token_in: number | null;
  token_out: number | null;
  created_at: string;
};

export type MnaSessionDetail = Omit<MnaSessionSummary, "latest_turn_id">;

export type MnaSessionDetailResponse = {
  session: MnaSessionDetail;
  messages: MnaSessionMessage[];
  latest_event_id: number | null;
};

export type MnaCreateSessionRequest = {
  workspace_id?: string;
  memory_mode?: AgentMemoryMode;
  locale?: AgentLocale;
};

export type MnaCreateSessionResponse = {
  session_id: string;
  ws_url: string;
  memory_mode: AgentMemoryMode;
  workspace_id: string;
  locale: AgentLocale;
};

export type MnaPromptInspectorResponse = {
  turn_id: string;
  provider_id: string;
  model: string;
  round: number;
  messages: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
};

export type MnaFileTreeEntry = {
  name: string;
  type: "directory" | "file" | "other";
};

export type MnaFileTreeResponse = {
  path: string;
  entries: MnaFileTreeEntry[];
};

export type MnaFileResponse = {
  path: string;
  content: string;
};

export type MnaMetricsResponse = {
  uptime_s: number;
  turns_total: number;
  turns_by_finish_reason: Record<string, number>;
  provider_calls_total: Record<string, number>;
  provider_errors_total: Record<string, number>;
  tool_invocations_total: Record<string, number>;
  tool_denials_total: Record<string, number>;
  stream_flushed_events_total: number;
  stream_dropped_after_abort_total: number;
  runtime_errors_total: Record<string, number>;
};

export type MnaMcpServerStatus = {
  name: string;
  transport: "stdio" | "http";
  state: "ok" | "unavailable" | "dead" | "disabled";
  last_error?: string;
  connected_at?: string;
  tool_count: number;
};

export type MnaMcpTool = {
  server: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type MnaMcpServersResponse = {
  servers: MnaMcpServerStatus[];
  tools: MnaMcpTool[];
};

export type MnaDependencyStatusResponse = {
  runtime: Record<string, unknown> & {
    status?: string;
    base_url?: string;
  };
  provider: {
    id: string;
    model: string;
    status: string;
  };
  mcp: MnaMcpServerStatus[];
  provider_key: string;
};

export type MnaWsSessionStartedEvent = {
  kind: "session_started";
  session_id: string;
  memory_mode: AgentMemoryMode;
  workspace_id: string;
  locale: AgentLocale;
};

export type MnaWsAssistantDeltaEvent = {
  kind: "assistant_delta";
  turn_id: string;
  text: string;
};

export type MnaWsToolCallStartEvent = {
  kind: "tool_call_start";
  turn_id: string;
  call_id: string;
  name: string;
  args_preview: string;
};

export type MnaWsToolCallResultEvent = {
  kind: "tool_call_result";
  call_id: string;
  ok: boolean;
  output_preview: string;
  artifact_ref?: string;
  trust_level: AgentToolTrustLevel;
};

export type MnaInjectionRecord = {
  id: string;
  memory_type: string;
  scope: string;
  summary: string;
  importance: number;
  confidence: number;
};

export type MnaInjectionBlock = {
  phase: string;
  injection_reason: string;
  memory_summary: string;
  memory_records: MnaInjectionRecord[];
};

export type MnaWsInjectionBannerEvent = {
  kind: "injection_banner";
  turn_id: string;
  injection: MnaInjectionBlock | null;
  degraded: boolean;
};

export type MnaWsPhaseResultEvent = {
  kind: "phase_result";
  turn_id: string;
  phase: string;
  trace_id: string | null;
  degraded: boolean;
  injection_summary?: string;
};

export type MnaWsTaskChangeEvent = {
  kind: "task_change";
  turn_id: string;
  change: "start" | "switch" | "resume";
  task_id: string | null;
  label: string;
  previous_task_id?: string | null;
};

export type MnaWsTurnEndEvent = {
  kind: "turn_end";
  turn_id: string;
  finish_reason: string;
};

export type MnaWsErrorEvent = {
  kind: "error";
  scope: "turn" | "session";
  code: string;
  message: string;
};

export type MnaWsToolConfirmEvent = {
  kind: "tool_confirm_needed";
  confirm_id: string;
  call_id: string;
  tool: string;
  params_preview: string;
  risk_hint?: "write" | "shell" | "mcp";
};

export type MnaWsReplayGapEvent = {
  kind: "replay_gap";
  last_event_id: number;
};

export type MnaWsPongEvent = {
  kind: "pong";
};

export type MnaServerEvent =
  | MnaWsSessionStartedEvent
  | MnaWsAssistantDeltaEvent
  | MnaWsToolCallStartEvent
  | MnaWsToolCallResultEvent
  | MnaWsInjectionBannerEvent
  | MnaWsPhaseResultEvent
  | MnaWsTaskChangeEvent
  | MnaWsTurnEndEvent
  | MnaWsErrorEvent
  | MnaWsToolConfirmEvent
  | MnaWsReplayGapEvent
  | MnaWsPongEvent;

export type MnaServerEventEnvelope = MnaServerEvent & {
  event_id?: number;
};

export type MnaClientEvent =
  | { kind: "user_input"; turn_id: string; text: string }
  | { kind: "abort"; turn_id: string }
  | { kind: "tool_confirm"; confirm_id: string; decision: "allow" | "deny" | "allow_session" }
  | { kind: "ping" };

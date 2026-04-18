export type HostKind = "claude_code_plugin" | "codex_app_server" | "custom_agent";

export type RuntimePhase =
  | "session_start"
  | "task_start"
  | "task_switch"
  | "before_plan"
  | "before_response"
  | "after_response";

export type MemoryType = "fact_preference" | "task_state" | "episodic";
export type MemoryMode = "workspace_only" | "workspace_plus_global";
export type ScopeType = "workspace" | "user" | "task" | "session";
export type RecordStatus = "active" | "pending_confirmation" | "superseded" | "archived" | "deleted";

export interface TriggerContext {
  host: HostKind;
  workspace_id: string;
  user_id: string;
  session_id: string;
  phase: RuntimePhase;
  current_input: string;
  task_id?: string;
  thread_id?: string;
  turn_id?: string;
  cwd?: string;
  source?: string;
  recent_context_summary?: string;
  memory_mode?: MemoryMode;
}

export interface RetrievalQuery {
  workspace_id: string;
  user_id: string;
  session_id: string;
  phase: RuntimePhase;
  task_id?: string;
  memory_mode: MemoryMode;
  scope_filter: ScopeType[];
  memory_type_filter: MemoryType[];
  status_filter: RecordStatus[];
  importance_threshold: number;
  semantic_query_text: string;
  candidate_limit: number;
}

export interface CandidateMemory {
  id: string;
  workspace_id: string;
  user_id: string;
  session_id?: string | null;
  task_id?: string | null;
  memory_type: MemoryType;
  scope: ScopeType;
  summary: string;
  details?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  importance: number;
  confidence: number;
  status: RecordStatus;
  updated_at: string;
  last_confirmed_at?: string | null;
  summary_embedding?: number[];
  semantic_score?: number;
  rerank_score?: number;
}

export interface TriggerDecision {
  hit: boolean;
  trigger_type: "phase" | "history_reference" | "semantic_fallback" | "cooldown_skip" | "no_trigger";
  trigger_reason: string;
  requested_memory_types: MemoryType[];
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  scope_reason: string;
  importance_threshold: number;
  cooldown_applied: boolean;
  semantic_score?: number;
  degraded?: boolean;
  degradation_reason?: string;
}

export interface MemoryPacket {
  packet_id: string;
  trigger: string;
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  selected_scopes: ScopeType[];
  scope_reason: string;
  query_scope: string;
  records: CandidateMemory[];
  packet_summary: string;
  injection_hint: string;
  ttl_ms: number;
  priority_breakdown: Record<MemoryType, number>;
  empty_reason?: string;
}

export interface InjectionRecord {
  id: string;
  memory_type: MemoryType;
  scope: ScopeType;
  summary: string;
  importance: number;
  confidence: number;
  source?: Record<string, unknown> | null;
}

export interface InjectionBlock {
  injection_reason: string;
  memory_summary: string;
  memory_records: InjectionRecord[];
  token_estimate: number;
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  selected_scopes: ScopeType[];
  trimmed_record_ids: string[];
  trim_reasons: string[];
}

export interface WriteBackCandidate {
  workspace_id: string;
  user_id: string | null;
  task_id: string | null;
  session_id: string | null;
  candidate_type: MemoryType;
  scope: ScopeType;
  summary: string;
  details: Record<string, unknown>;
  importance: number;
  confidence: number;
  write_reason: string;
  source: {
    source_type: string;
    source_ref: string;
    service_name: string;
    confirmed_by_user?: boolean;
  };
  idempotency_key: string;
}

export interface SubmittedWriteBackJob {
  candidate_summary: string;
  job_id?: string;
  status: "accepted" | "accepted_async" | "merged" | "rejected" | "dependency_unavailable";
  reason?: string;
}

export type DependencyState = "healthy" | "degraded" | "unavailable" | "unknown";

export interface DependencyStatus {
  name: "read_model" | "embeddings" | "storage_writeback";
  status: DependencyState;
  detail: string;
  last_checked_at: string;
}

export interface DependencyStatusSnapshot {
  read_model: DependencyStatus;
  embeddings: DependencyStatus;
  storage_writeback: DependencyStatus;
}

export interface PrepareContextResponse {
  trace_id: string;
  trigger: boolean;
  trigger_reason: string;
  memory_packet: MemoryPacket | null;
  injection_block: InjectionBlock | null;
  degraded: boolean;
  dependency_status: DependencyStatusSnapshot;
  budget_used: number;
  memory_packet_ids: string[];
}

export interface SessionStartResponse {
  trace_id: string;
  additional_context: string;
  active_task_summary: string | null;
  injection_block: InjectionBlock | null;
  memory_mode: MemoryMode;
  dependency_status: DependencyStatusSnapshot;
  degraded: boolean;
}

export interface FinalizeTurnInput {
  host: HostKind;
  workspace_id: string;
  user_id: string;
  session_id: string;
  current_input: string;
  assistant_output: string;
  task_id?: string;
  thread_id?: string;
  turn_id?: string;
  tool_results_summary?: string;
  memory_mode?: MemoryMode;
}

export interface FinalizeTurnResponse {
  trace_id: string;
  write_back_candidates: WriteBackCandidate[];
  submitted_jobs: SubmittedWriteBackJob[];
  memory_mode: MemoryMode;
  candidate_count: number;
  filtered_count: number;
  filtered_reasons: string[];
  writeback_submitted: boolean;
  degraded: boolean;
  dependency_status: DependencyStatusSnapshot;
}

export interface RuntimeTurnRecord {
  trace_id: string;
  host: HostKind;
  workspace_id: string;
  user_id: string;
  session_id: string;
  phase: RuntimePhase;
  task_id?: string;
  thread_id?: string;
  turn_id?: string;
  current_input: string;
  assistant_output?: string;
  created_at: string;
}

export interface RecallRunRecord {
  trace_id: string;
  phase: RuntimePhase;
  trigger_hit: boolean;
  trigger_type: TriggerDecision["trigger_type"];
  trigger_reason: string;
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  matched_scopes: ScopeType[];
  scope_hit_counts: Partial<Record<ScopeType, number>>;
  scope_reason: string;
  query_scope: string;
  requested_memory_types: MemoryType[];
  candidate_count: number;
  selected_count: number;
  result_state: "not_triggered" | "dependency_unavailable" | "empty" | "matched";
  degraded: boolean;
  degradation_reason?: string;
  duration_ms: number;
  created_at: string;
}

export interface TriggerRunRecord {
  trace_id: string;
  phase: RuntimePhase;
  trigger_hit: boolean;
  trigger_type: TriggerDecision["trigger_type"];
  trigger_reason: string;
  requested_memory_types: MemoryType[];
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  scope_reason: string;
  importance_threshold: number;
  cooldown_applied: boolean;
  semantic_score?: number;
  degraded?: boolean;
  degradation_reason?: string;
  duration_ms: number;
  created_at: string;
}

export interface InjectionRunRecord {
  trace_id: string;
  phase: RuntimePhase;
  injected: boolean;
  injected_count: number;
  token_estimate: number;
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  selected_scopes: ScopeType[];
  trimmed_record_ids: string[];
  trim_reasons: string[];
  result_state: "not_triggered" | "no_records" | "trimmed_to_zero" | "injected";
  duration_ms: number;
  created_at: string;
}

export interface WritebackSubmissionRecord {
  trace_id: string;
  phase: RuntimePhase;
  candidate_count: number;
  submitted_count: number;
  memory_mode: MemoryMode;
  final_scopes: ScopeType[];
  filtered_count: number;
  filtered_reasons: string[];
  scope_reasons: string[];
  result_state: "no_candidates" | "submitted" | "failed";
  degraded: boolean;
  degradation_reason?: string;
  duration_ms: number;
  created_at: string;
}

export interface ObserveRunsFilters {
  session_id?: string;
  turn_id?: string;
  trace_id?: string;
  page?: number;
  page_size?: number;
}

export interface ObserveRunsResponse {
  turns: RuntimeTurnRecord[];
  trigger_runs: TriggerRunRecord[];
  recall_runs: RecallRunRecord[];
  injection_runs: InjectionRunRecord[];
  writeback_submissions: WritebackSubmissionRecord[];
  total: number;
  page: number;
  page_size: number;
  dependency_status: DependencyStatusSnapshot;
}

export interface ObserveMetricsResponse {
  trigger_rate: number;
  recall_hit_rate: number;
  empty_recall_rate: number;
  injection_rate: number;
  injection_trim_rate: number;
  writeback_submission_rate: number;
  query_p95_ms: number;
  injection_p95_ms: number;
}

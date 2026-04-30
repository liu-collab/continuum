CREATE SCHEMA IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__;

CREATE TABLE IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__.runtime_turns (
  trace_id TEXT NOT NULL,
  host TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  task_id TEXT NULL,
  thread_id TEXT NULL,
  turn_id TEXT NULL,
  current_input TEXT NOT NULL,
  assistant_output TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trace_id, phase)
);

CREATE TABLE IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__.runtime_trigger_runs (
  trace_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  trigger_hit BOOLEAN NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  requested_memory_types JSONB NOT NULL,
  memory_mode TEXT NOT NULL,
  requested_scopes JSONB NOT NULL,
  scope_reason TEXT NOT NULL,
  importance_threshold INTEGER NOT NULL,
  cooldown_applied BOOLEAN NOT NULL,
  semantic_score DOUBLE PRECISION NULL,
  degraded BOOLEAN NULL,
  degradation_reason TEXT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trace_id, phase)
);

CREATE TABLE IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__.runtime_recall_runs (
  trace_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  trigger_hit BOOLEAN NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  memory_mode TEXT NOT NULL,
  requested_scopes JSONB NOT NULL,
  matched_scopes JSONB NOT NULL,
  scope_hit_counts JSONB NOT NULL,
  scope_reason TEXT NOT NULL,
  query_scope TEXT NOT NULL,
  requested_memory_types JSONB NOT NULL,
  candidate_count INTEGER NOT NULL,
  selected_count INTEGER NOT NULL,
  recently_filtered_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  recently_filtered_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  recently_soft_marked_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  replay_escape_reason TEXT NULL,
  result_state TEXT NOT NULL,
  degraded BOOLEAN NOT NULL,
  degradation_reason TEXT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trace_id, phase)
);

CREATE TABLE IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__.runtime_injection_runs (
  trace_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  injected BOOLEAN NOT NULL,
  injected_count INTEGER NOT NULL,
  token_estimate INTEGER NOT NULL,
  memory_mode TEXT NOT NULL,
  requested_scopes JSONB NOT NULL,
  selected_scopes JSONB NOT NULL,
  trimmed_record_ids JSONB NOT NULL,
  trim_reasons JSONB NOT NULL,
  recently_filtered_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  recently_filtered_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  recently_soft_marked_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  replay_escape_reason TEXT NULL,
  result_state TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trace_id, phase)
);

CREATE TABLE IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__.runtime_writeback_submissions (
  trace_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  candidate_count INTEGER NOT NULL,
  submitted_count INTEGER NOT NULL,
  memory_mode TEXT NOT NULL,
  final_scopes JSONB NOT NULL,
  filtered_count INTEGER NOT NULL,
  filtered_reasons JSONB NOT NULL,
  scope_reasons JSONB NOT NULL,
  result_state TEXT NOT NULL,
  degraded BOOLEAN NOT NULL,
  degradation_reason TEXT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trace_id, phase)
);

CREATE TABLE IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__.runtime_dependency_status (
  name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  last_checked_at TIMESTAMPTZ NOT NULL
);

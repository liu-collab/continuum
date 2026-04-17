CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__;
CREATE SCHEMA IF NOT EXISTS __SHARED_SCHEMA_IDENT__;

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NULL,
  task_id UUID NULL,
  session_id UUID NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('fact_preference', 'task_state', 'episodic')),
  scope TEXT NOT NULL CHECK (scope IN ('session', 'task', 'user', 'workspace')),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived', 'pending_confirmation', 'deleted')),
  summary TEXT NOT NULL,
  details_json JSONB NOT NULL,
  importance SMALLINT NOT NULL CHECK (importance BETWEEN 1 AND 5),
  confidence NUMERIC(3, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  dedupe_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  created_by_service TEXT NOT NULL,
  last_confirmed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS memory_records_scope_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_records (workspace_id, user_id, scope, memory_type, status);
CREATE INDEX IF NOT EXISTS memory_records_task_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_records (task_id, status);
CREATE INDEX IF NOT EXISTS memory_records_dedupe_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_records (dedupe_key);
CREATE INDEX IF NOT EXISTS memory_records_updated_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_records (updated_at DESC);

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_record_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_records(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  snapshot_json JSONB NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('create', 'update', 'merge', 'archive', 'delete', 'restore', 'supersede')),
  change_reason TEXT NOT NULL,
  changed_by_type TEXT NOT NULL CHECK (changed_by_type IN ('system', 'user', 'operator')),
  changed_by_id TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memory_record_versions_record_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_record_versions (record_id, version_no DESC);
CREATE INDEX IF NOT EXISTS memory_record_versions_changed_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_record_versions (changed_at DESC);

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_write_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  workspace_id UUID NOT NULL,
  user_id UUID NULL,
  candidate_json JSONB NOT NULL,
  candidate_hash TEXT NOT NULL,
  source_service TEXT NOT NULL,
  job_status TEXT NOT NULL CHECK (job_status IN ('queued', 'processing', 'succeeded', 'failed', 'dead_letter')),
  result_record_id UUID NULL,
  result_status TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS memory_write_jobs_status_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_write_jobs (job_status, received_at);
CREATE INDEX IF NOT EXISTS memory_write_jobs_workspace_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_write_jobs (workspace_id, user_id, received_at DESC);

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NULL,
  record_id UUID NOT NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_records(id) ON DELETE CASCADE,
  conflict_with_record_id UUID NOT NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_records(id) ON DELETE CASCADE,
  pending_record_id UUID NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_records(id) ON DELETE CASCADE,
  existing_record_id UUID NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_records(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('fact_conflict', 'preference_conflict', 'scope_conflict')),
  conflict_summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'ignored')),
  resolution_type TEXT NULL CHECK (resolution_type IN ('manual_fix', 'auto_merge', 'dismissed')),
  resolved_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS memory_conflicts_status_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_conflicts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_conflicts_record_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_conflicts (record_id);
CREATE INDEX IF NOT EXISTS memory_conflicts_with_record_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_conflicts (conflict_with_record_id);
CREATE INDEX IF NOT EXISTS memory_conflicts_pending_record_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_conflicts (pending_record_id);

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_governance_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_records(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('edit', 'archive', 'delete', 'confirm', 'invalidate', 'restore_version')),
  action_payload JSONB NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'user', 'operator')),
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memory_governance_actions_record_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_actions (record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_governance_actions_type_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_actions (action_type, created_at DESC);

CREATE TABLE IF NOT EXISTS __SHARED_SCHEMA_IDENT__.memory_read_model_v1 (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  user_id UUID NULL,
  task_id UUID NULL,
  session_id UUID NULL,
  memory_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  details JSONB NULL,
  importance SMALLINT NOT NULL CHECK (importance BETWEEN 1 AND 5),
  confidence NUMERIC(3, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source JSONB NULL,
  last_confirmed_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  summary_embedding VECTOR(1536) NULL
);

CREATE INDEX IF NOT EXISTS memory_read_model_scope_idx
  ON __SHARED_SCHEMA_IDENT__.memory_read_model_v1 (workspace_id, user_id, scope, memory_type, status);
CREATE INDEX IF NOT EXISTS memory_read_model_task_idx
  ON __SHARED_SCHEMA_IDENT__.memory_read_model_v1 (task_id, status);
CREATE INDEX IF NOT EXISTS memory_read_model_updated_idx
  ON __SHARED_SCHEMA_IDENT__.memory_read_model_v1 (updated_at DESC);

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_read_model_refresh_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id UUID NOT NULL,
  refresh_type TEXT NOT NULL CHECK (refresh_type IN ('insert', 'update', 'delete')),
  job_status TEXT NOT NULL CHECK (job_status IN ('queued', 'processing', 'succeeded', 'failed', 'dead_letter')),
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  embedding_updated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS memory_read_model_refresh_jobs_status_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_read_model_refresh_jobs (job_status, created_at);

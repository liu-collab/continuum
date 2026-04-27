CREATE TABLE IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__.runtime_recent_injections (
  session_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  record_updated_at TEXT NULL,
  injected_at TIMESTAMPTZ NOT NULL,
  turn_index INTEGER NOT NULL,
  trace_id TEXT NULL,
  source_phase TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, record_id)
);

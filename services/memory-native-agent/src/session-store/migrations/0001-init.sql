CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT,
  memory_mode TEXT NOT NULL,
  locale TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_ws_active
  ON sessions(workspace_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  task_id TEXT,
  trace_id TEXT,
  created_at TEXT NOT NULL,
  finish_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_turns_session
  ON turns(session_id, turn_index);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  token_in INTEGER,
  token_out INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_turn
  ON messages(turn_id);

CREATE TABLE IF NOT EXISTS tool_invocations (
  call_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  args_preview TEXT,
  permission_decision TEXT NOT NULL,
  exit_code INTEGER,
  ok INTEGER NOT NULL,
  error_code TEXT,
  artifact_ref TEXT,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tools_session
  ON tool_invocations(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dispatched_messages (
  turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
  messages_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  prompt_segments_json TEXT,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

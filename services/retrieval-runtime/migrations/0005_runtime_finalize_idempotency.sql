CREATE TABLE IF NOT EXISTS __RUNTIME_SCHEMA_IDENT__.runtime_finalize_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

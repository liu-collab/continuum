ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_recall_runs
  ADD COLUMN IF NOT EXISTS recently_filtered_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recently_filtered_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recently_soft_marked_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS replay_escape_reason TEXT NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_injection_runs
  ADD COLUMN IF NOT EXISTS recently_filtered_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recently_filtered_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recently_soft_marked_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS replay_escape_reason TEXT NULL;

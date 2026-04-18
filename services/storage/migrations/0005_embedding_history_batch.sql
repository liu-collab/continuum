ALTER TABLE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
  ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
  ADD COLUMN IF NOT EXISTS embedding_attempted_at TIMESTAMPTZ NULL;

UPDATE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
SET embedding_status = CASE
  WHEN summary_embedding IS NULL THEN 'pending'
  ELSE 'ok'
END
WHERE embedding_status IS NULL OR embedding_status = '';

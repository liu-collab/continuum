ALTER TABLE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
  ADD COLUMN IF NOT EXISTS embedding_attempt_count INTEGER NOT NULL DEFAULT 0;

UPDATE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
SET embedding_attempt_count = CASE
  WHEN embedding_status = 'ok' AND summary_embedding IS NOT NULL THEN GREATEST(coalesce(embedding_attempt_count, 0), 1)
  WHEN embedding_status IN ('pending', 'failed') THEN GREATEST(coalesce(embedding_attempt_count, 0), 1)
  ELSE coalesce(embedding_attempt_count, 0)
END;

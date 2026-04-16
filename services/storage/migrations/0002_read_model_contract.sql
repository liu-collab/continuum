ALTER TABLE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
  ADD COLUMN IF NOT EXISTS details JSONB NULL;

ALTER TABLE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
  ADD COLUMN IF NOT EXISTS source JSONB NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = __SHARED_SCHEMA_LITERAL__
      AND table_name = 'memory_read_model_v1'
      AND column_name = 'details_preview_json'
  ) THEN
    EXECUTE format(
      'UPDATE %s.memory_read_model_v1 SET details = COALESCE(details, details_preview_json)',
      __SHARED_SCHEMA_LITERAL__
    );

    EXECUTE format(
      'ALTER TABLE %s.memory_read_model_v1 DROP COLUMN IF EXISTS details_preview_json',
      __SHARED_SCHEMA_LITERAL__
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = __SHARED_SCHEMA_LITERAL__
      AND table_name = 'memory_read_model_v1'
      AND column_name = 'source_type'
  ) THEN
    EXECUTE format(
      'UPDATE %s.memory_read_model_v1 SET source = COALESCE(source, jsonb_build_object(''source_type'', source_type, ''source_ref'', source_ref))',
      __SHARED_SCHEMA_LITERAL__
    );

    EXECUTE format(
      'ALTER TABLE %s.memory_read_model_v1 DROP COLUMN IF EXISTS source_type',
      __SHARED_SCHEMA_LITERAL__
    );

    EXECUTE format(
      'ALTER TABLE %s.memory_read_model_v1 DROP COLUMN IF EXISTS source_ref',
      __SHARED_SCHEMA_LITERAL__
    );
  END IF;
END $$;

ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_read_model_refresh_jobs
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ NULL;

ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_read_model_refresh_jobs
  DROP CONSTRAINT IF EXISTS memory_read_model_refresh_jobs_job_status_check;

ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_read_model_refresh_jobs
  ADD CONSTRAINT memory_read_model_refresh_jobs_job_status_check
  CHECK (job_status IN ('queued', 'processing', 'succeeded', 'failed', 'dead_letter'));

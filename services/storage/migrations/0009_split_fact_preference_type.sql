UPDATE __PRIVATE_SCHEMA_IDENT__.memory_records
SET memory_type = CASE
  WHEN scope = 'user'
    OR COALESCE(details_json, '{}'::jsonb) ? 'preference_axis'
    OR COALESCE(details_json, '{}'::jsonb) ? 'preference_value'
    OR COALESCE(details_json, '{}'::jsonb) ? 'preference_polarity'
    OR lower(summary) LIKE '%prefer%'
    OR summary LIKE '%偏好%'
    OR summary LIKE '%习惯%'
    OR summary LIKE '%默认%'
  THEN 'preference'
  ELSE 'fact'
END
WHERE memory_type = 'fact_preference';

UPDATE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
SET memory_type = CASE
  WHEN scope = 'user'
    OR COALESCE(details, '{}'::jsonb) ? 'preference_axis'
    OR COALESCE(details, '{}'::jsonb) ? 'preference_value'
    OR COALESCE(details, '{}'::jsonb) ? 'preference_polarity'
    OR lower(summary) LIKE '%prefer%'
    OR summary LIKE '%偏好%'
    OR summary LIKE '%习惯%'
    OR summary LIKE '%默认%'
  THEN 'preference'
  ELSE 'fact'
END
WHERE memory_type = 'fact_preference';

ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_records
  DROP CONSTRAINT IF EXISTS memory_records_memory_type_check;

ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_records
  ADD CONSTRAINT memory_records_memory_type_check
  CHECK (memory_type IN ('fact', 'preference', 'task_state', 'episodic'));

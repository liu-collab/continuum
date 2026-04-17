ALTER TABLE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;

UPDATE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
SET created_at = COALESCE(created_at, updated_at, NOW());

ALTER TABLE __SHARED_SCHEMA_IDENT__.memory_read_model_v1
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_governance_actions
  DROP CONSTRAINT IF EXISTS memory_governance_actions_action_type_check;

ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_governance_actions
  ADD CONSTRAINT memory_governance_actions_action_type_check
  CHECK (action_type IN ('edit', 'archive', 'delete', 'confirm', 'invalidate', 'restore_version'));

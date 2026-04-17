ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_conflicts
  ADD COLUMN IF NOT EXISTS pending_record_id UUID NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_records(id) ON DELETE CASCADE;

ALTER TABLE __PRIVATE_SCHEMA_IDENT__.memory_conflicts
  ADD COLUMN IF NOT EXISTS existing_record_id UUID NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_records(id) ON DELETE CASCADE;

UPDATE __PRIVATE_SCHEMA_IDENT__.memory_conflicts
SET pending_record_id = COALESCE(pending_record_id, conflict_with_record_id),
    existing_record_id = COALESCE(existing_record_id, record_id);

CREATE INDEX IF NOT EXISTS memory_conflicts_pending_record_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_conflicts (pending_record_id);

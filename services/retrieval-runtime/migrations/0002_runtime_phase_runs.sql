ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_trigger_runs
  ADD COLUMN IF NOT EXISTS phase TEXT;

UPDATE __RUNTIME_SCHEMA_IDENT__.runtime_trigger_runs trigger_runs
SET phase = turns.phase
FROM __RUNTIME_SCHEMA_IDENT__.runtime_turns turns
WHERE trigger_runs.trace_id = turns.trace_id
  AND trigger_runs.phase IS NULL;

UPDATE __RUNTIME_SCHEMA_IDENT__.runtime_trigger_runs
SET phase = 'before_response'
WHERE phase IS NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_trigger_runs
  ALTER COLUMN phase SET NOT NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_trigger_runs
  DROP CONSTRAINT IF EXISTS runtime_trigger_runs_pkey;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_trigger_runs
  ADD PRIMARY KEY (trace_id, phase);

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_recall_runs
  ADD COLUMN IF NOT EXISTS phase TEXT;

UPDATE __RUNTIME_SCHEMA_IDENT__.runtime_recall_runs recall_runs
SET phase = turns.phase
FROM __RUNTIME_SCHEMA_IDENT__.runtime_turns turns
WHERE recall_runs.trace_id = turns.trace_id
  AND recall_runs.phase IS NULL;

UPDATE __RUNTIME_SCHEMA_IDENT__.runtime_recall_runs
SET phase = 'before_response'
WHERE phase IS NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_recall_runs
  ALTER COLUMN phase SET NOT NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_recall_runs
  DROP CONSTRAINT IF EXISTS runtime_recall_runs_pkey;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_recall_runs
  ADD PRIMARY KEY (trace_id, phase);

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_injection_runs
  ADD COLUMN IF NOT EXISTS phase TEXT;

UPDATE __RUNTIME_SCHEMA_IDENT__.runtime_injection_runs injection_runs
SET phase = turns.phase
FROM __RUNTIME_SCHEMA_IDENT__.runtime_turns turns
WHERE injection_runs.trace_id = turns.trace_id
  AND injection_runs.phase IS NULL;

UPDATE __RUNTIME_SCHEMA_IDENT__.runtime_injection_runs
SET phase = 'before_response'
WHERE phase IS NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_injection_runs
  ALTER COLUMN phase SET NOT NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_injection_runs
  DROP CONSTRAINT IF EXISTS runtime_injection_runs_pkey;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_injection_runs
  ADD PRIMARY KEY (trace_id, phase);

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_writeback_submissions
  ADD COLUMN IF NOT EXISTS phase TEXT;

UPDATE __RUNTIME_SCHEMA_IDENT__.runtime_writeback_submissions
SET phase = 'after_response'
WHERE phase IS NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_writeback_submissions
  ALTER COLUMN phase SET NOT NULL;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_writeback_submissions
  DROP CONSTRAINT IF EXISTS runtime_writeback_submissions_pkey;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_writeback_submissions
  ADD PRIMARY KEY (trace_id, phase);

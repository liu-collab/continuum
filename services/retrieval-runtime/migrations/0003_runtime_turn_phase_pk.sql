ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_turns
  DROP CONSTRAINT IF EXISTS runtime_turns_pkey;

ALTER TABLE __RUNTIME_SCHEMA_IDENT__.runtime_turns
  ADD PRIMARY KEY (trace_id, phase);

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_governance_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  proposal_type TEXT NOT NULL,
  status TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  suggested_changes_json JSONB NOT NULL,
  evidence_json JSONB NOT NULL,
  planner_model TEXT NOT NULL,
  planner_confidence NUMERIC(3,2) NOT NULL,
  verifier_required BOOLEAN NOT NULL DEFAULT FALSE,
  verifier_model TEXT NULL,
  verifier_decision TEXT NULL,
  verifier_confidence NUMERIC(3,2) NULL,
  verifier_notes TEXT NULL,
  policy_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT memory_governance_proposals_confidence_check CHECK (planner_confidence BETWEEN 0 AND 1),
  CONSTRAINT memory_governance_proposals_verifier_confidence_check CHECK (verifier_confidence IS NULL OR verifier_confidence BETWEEN 0 AND 1),
  CONSTRAINT memory_governance_proposals_type_check CHECK (proposal_type IN ('merge','archive','downgrade','confirm','resolve_conflict','summarize','delete')),
  CONSTRAINT memory_governance_proposals_status_check CHECK (status IN ('proposed','verified','rejected_by_guard','executing','executed','failed','superseded','cancelled')),
  CONSTRAINT memory_governance_proposals_verifier_decision_check CHECK (verifier_decision IS NULL OR verifier_decision IN ('approve','reject'))
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_governance_proposals_idempotency_uidx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_proposals (idempotency_key);

CREATE INDEX IF NOT EXISTS memory_governance_proposals_workspace_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_proposals (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS memory_governance_proposals_type_status_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_proposals (proposal_type, status, created_at DESC);

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_governance_proposal_targets (
  proposal_id UUID NOT NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_governance_proposals(id) ON DELETE CASCADE,
  record_id UUID NULL,
  conflict_id UUID NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT memory_governance_proposal_targets_role_check CHECK (role IN ('target','winner','loser','seed','related'))
);

CREATE INDEX IF NOT EXISTS memory_governance_proposal_targets_proposal_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_proposal_targets (proposal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS memory_governance_proposal_targets_record_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_proposal_targets (record_id);

CREATE INDEX IF NOT EXISTS memory_governance_proposal_targets_conflict_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_proposal_targets (conflict_id);

CREATE TABLE IF NOT EXISTS __PRIVATE_SCHEMA_IDENT__.memory_governance_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  proposal_id UUID NOT NULL REFERENCES __PRIVATE_SCHEMA_IDENT__.memory_governance_proposals(id) ON DELETE CASCADE,
  proposal_type TEXT NOT NULL,
  execution_status TEXT NOT NULL,
  result_summary TEXT NULL,
  error_message TEXT NULL,
  source_service TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT memory_governance_executions_type_check CHECK (proposal_type IN ('merge','archive','downgrade','confirm','resolve_conflict','summarize','delete')),
  CONSTRAINT memory_governance_executions_status_check CHECK (execution_status IN ('proposed','verified','rejected_by_guard','executing','executed','failed','superseded','cancelled'))
);

CREATE INDEX IF NOT EXISTS memory_governance_executions_workspace_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_executions (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS memory_governance_executions_proposal_idx
  ON __PRIVATE_SCHEMA_IDENT__.memory_governance_executions (proposal_id, started_at DESC);

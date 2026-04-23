import { z } from "zod";

export const memoryTypeSchema = z.enum([
  "fact_preference",
  "task_state",
  "episodic",
]);

export const scopeSchema = z.enum(["session", "task", "user", "workspace"]);

export const memoryStatusSchema = z.enum([
  "active",
  "superseded",
  "archived",
  "pending_confirmation",
  "deleted",
]);

export const writeJobStatusSchema = z.enum([
  "queued",
  "processing",
  "succeeded",
  "failed",
  "dead_letter",
]);

export const refreshJobStatusSchema = z.enum([
  "queued",
  "processing",
  "succeeded",
  "failed",
  "dead_letter",
]);

export const conflictStatusSchema = z.enum(["open", "resolved", "ignored"]);

export const conflictTypeSchema = z.enum([
  "fact_conflict",
  "preference_conflict",
  "scope_conflict",
]);

export const governanceActionTypeSchema = z.enum([
  "edit",
  "archive",
  "delete",
  "confirm",
  "invalidate",
  "restore_version",
]);

export const governanceExecutionStatusSchema = z.enum([
  "proposed",
  "verified",
  "rejected_by_guard",
  "executing",
  "executed",
  "failed",
  "superseded",
  "cancelled",
]);

export const governanceProposalTypeSchema = z.enum([
  "merge",
  "archive",
  "downgrade",
  "confirm",
  "resolve_conflict",
  "summarize",
  "delete",
]);

const sourceSchema = z.object({
  source_type: z.string().trim().min(1),
  source_ref: z.string().trim().min(1),
  service_name: z.string().trim().min(1).default("retrieval-runtime"),
  origin_workspace_id: z.uuid().optional(),
  confirmed_by_user: z.boolean().optional(),
});

const governanceActorSchema = z.object({
  actor_type: z.enum(["system", "user", "operator"]),
  actor_id: z.string().trim().min(1),
});

const governanceActionRequestSchema = z.object({
  actor: governanceActorSchema,
  reason: z.string().trim().min(3).max(240),
});

const structuredDetailsSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => !containsTranscriptLikeContent(value), {
    message: "details must remain structured and cannot contain raw transcript payloads",
  });

const governanceExecutionTargetSchema = z.object({
  record_ids: z.array(z.uuid()).default([]),
  conflict_id: z.uuid().optional(),
  winner_record_id: z.uuid().optional(),
});

const governanceSuggestedChangesSchema = z
  .object({
    summary: z.string().trim().min(3).max(500).optional(),
    importance: z.number().int().min(1).max(5).optional(),
    status: memoryStatusSchema.optional(),
    delete_mode: z.literal("soft").optional(),
    candidate_type: memoryTypeSchema.optional(),
    scope: scopeSchema.optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.summary ??
          value.importance ??
          value.status ??
          value.delete_mode ??
          value.candidate_type ??
          value.scope,
      ),
    {
      message: "at least one suggested change must be provided",
      path: ["summary"],
    },
  );

const governancePlannerSchema = z.object({
  model: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
});

const governanceVerifierSchema = z.object({
  required: z.boolean(),
  model: z.string().trim().min(1).optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().trim().min(1).max(500).optional(),
});

export const governanceExecutionItemSchema = z
  .object({
    proposal_id: z.uuid(),
    proposal_type: governanceProposalTypeSchema,
    targets: governanceExecutionTargetSchema,
    suggested_changes: governanceSuggestedChangesSchema,
    reason_code: z.string().trim().min(1).max(120),
    reason_text: z.string().trim().min(3).max(240),
    evidence: structuredDetailsSchema,
    planner: governancePlannerSchema,
    verifier: governanceVerifierSchema,
    policy_version: z.string().trim().min(1).max(120),
    idempotency_key: z.string().trim().min(8).max(128),
  })
  .superRefine((value, ctx) => {
    const recordCount = value.targets.record_ids.length;
    const isDelete = value.proposal_type === "delete";
    const isMerge = value.proposal_type === "merge";
    const isSummarize = value.proposal_type === "summarize";
    const isResolveConflict = value.proposal_type === "resolve_conflict";
    const needsVerifier = isMerge || isSummarize || isResolveConflict || isDelete;

    if (needsVerifier && value.verifier.required !== true) {
      ctx.addIssue({
        code: "custom",
        message: "verifier.required must be true for high-impact actions",
        path: ["verifier", "required"],
      });
    }

    if (needsVerifier && value.verifier.decision !== "approve") {
      ctx.addIssue({
        code: "custom",
        message: "verifier must approve high-impact actions",
        path: ["verifier", "decision"],
      });
    }

    if (isDelete && value.suggested_changes.delete_mode !== "soft") {
      ctx.addIssue({
        code: "custom",
        message: "delete actions must use soft delete mode",
        path: ["suggested_changes", "delete_mode"],
      });
    }

    if (isDelete) {
      const deleteReason = value.evidence["delete_reason"];
      if (typeof deleteReason !== "string" || deleteReason.trim().length < 3) {
        ctx.addIssue({
          code: "custom",
          message: "delete_reason is required for delete actions",
          path: ["evidence", "delete_reason"],
        });
      }
    }

    if ((isMerge || isSummarize) && recordCount < 2) {
      ctx.addIssue({
        code: "custom",
        message: "merge and summarize actions require at least two target records",
        path: ["targets", "record_ids"],
      });
    }

    if (isResolveConflict && !value.targets.conflict_id) {
      ctx.addIssue({
        code: "custom",
        message: "conflict_id is required for resolve_conflict actions",
        path: ["targets", "conflict_id"],
      });
    }
  });

export const governanceExecutionBatchRequestSchema = z.object({
  workspace_id: z.uuid(),
  source_service: z.string().trim().min(1).default("retrieval-runtime"),
  items: z.array(governanceExecutionItemSchema).min(1).max(50),
});

export const writeBackCandidateSchema = z
  .object({
    workspace_id: z.uuid(),
    user_id: z.uuid().nullable().optional(),
    task_id: z.uuid().nullable().optional(),
    session_id: z.uuid().nullable().optional(),
    candidate_type: memoryTypeSchema,
    scope: scopeSchema,
    summary: z.string().trim().min(3).max(500),
    details: structuredDetailsSchema,
    importance: z.number().int().min(1).max(5).optional(),
    confidence: z.number().min(0).max(1).optional(),
    write_reason: z.string().trim().min(3).max(240),
    source: sourceSchema,
    idempotency_key: z.string().trim().min(8).max(128).optional(),
    suggested_status: z.enum(["active", "pending_confirmation"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "workspace" && value.user_id) {
      return;
    }

    if (value.scope !== "workspace" && !value.user_id) {
      ctx.addIssue({
        code: "custom",
        message: "user_id is required for non-workspace scopes",
        path: ["user_id"],
      });
    }

    if (value.scope === "task" && !value.task_id) {
      ctx.addIssue({
        code: "custom",
        message: "task_id is required for task scope",
        path: ["task_id"],
      });
    }

    if (value.scope === "session" && !value.session_id) {
      ctx.addIssue({
        code: "custom",
        message: "session_id is required for session scope",
        path: ["session_id"],
      });
    }
  });

export const writeJobEnvelopeSchema = z.object({
  candidate: writeBackCandidateSchema,
  source_service: z.string().trim().min(1).default("retrieval-runtime"),
});

export const writeBackBatchRequestSchema = z.object({
  candidates: z.array(writeBackCandidateSchema).min(1).max(50),
});

export const runtimeWriteBackCandidateSchema = writeBackCandidateSchema;

export const runtimeWriteBackBatchRequestSchema = writeBackBatchRequestSchema;

export const runtimeCompatibleWriteBackCandidateSchema = z.object({
  candidate_type: z.enum([
    "fact_preference",
    "task_state",
    "episodic",
    "commitment",
    "important_event",
  ]),
  scope: z.enum(["session", "task", "user"]),
  summary: z.string().trim().min(3).max(500),
  details: structuredDetailsSchema,
  importance: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  write_reason: z.string().trim().min(3).max(240),
  source: z.object({
    host: z.string().trim().min(1),
    session_id: z.uuid(),
    thread_id: z.string().trim().min(1).optional(),
    turn_id: z.string().trim().min(1).optional(),
    task_id: z.uuid().optional(),
  }),
  dedupe_key: z.string().trim().min(3).max(256),
});

export const runtimeCompatibleWriteBackBatchRequestSchema = z.object({
  workspace_id: z.uuid(),
  user_id: z.uuid(),
  session_id: z.uuid(),
  task_id: z.uuid().optional(),
  source_service: z.string().trim().min(1).default("retrieval-runtime"),
  candidates: z.array(runtimeCompatibleWriteBackCandidateSchema).min(1).max(50),
});

export const recordQuerySchema = z.object({
  workspace_id: z.uuid(),
  user_id: z.uuid().optional(),
  task_id: z.uuid().optional(),
  memory_type: memoryTypeSchema.optional(),
  scope: scopeSchema.optional(),
  status: memoryStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const recordPatchSchema = z
  .object({
    summary: z.string().trim().min(3).max(500).optional(),
    details_json: structuredDetailsSchema.optional(),
    scope: scopeSchema.optional(),
    status: memoryStatusSchema.exclude(["deleted"]).optional(),
    importance: z.number().int().min(1).max(5).optional(),
    confidence: z.number().min(0).max(1).optional(),
    actor: z.object({
      actor_type: z.enum(["system", "user", "operator"]),
      actor_id: z.string().trim().min(1),
    }),
    reason: z.string().trim().min(3).max(240),
  })
  .refine(
    (value) =>
      Boolean(
        value.summary ??
          value.details_json ??
          value.scope ??
          value.status ??
          value.importance ??
          value.confidence,
      ),
    {
      message: "at least one mutable field must be provided",
      path: ["summary"],
    },
  );

export const archiveRecordSchema = governanceActionRequestSchema;
export const confirmRecordSchema = governanceActionRequestSchema;
export const invalidateRecordSchema = governanceActionRequestSchema;
export const deleteRecordSchema = governanceActionRequestSchema;

export const restoreVersionSchema = z.object({
  version_no: z.number().int().min(1),
  actor: governanceActorSchema,
  reason: z.string().trim().min(3).max(240),
});

export const resolveConflictSchema = z.object({
  resolution_type: z.enum(["manual_fix", "auto_merge", "dismissed"]),
  resolved_by: z.string().trim().min(1),
  resolution_note: z.string().trim().min(3).max(240),
  activate_record_id: z.uuid().optional(),
});

export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export type WriteJobStatus = z.infer<typeof writeJobStatusSchema>;
export type RefreshJobStatus = z.infer<typeof refreshJobStatusSchema>;
export type ConflictStatus = z.infer<typeof conflictStatusSchema>;
export type ConflictType = z.infer<typeof conflictTypeSchema>;
export type GovernanceActionType = z.infer<typeof governanceActionTypeSchema>;
export type GovernanceExecutionStatus = z.infer<typeof governanceExecutionStatusSchema>;
export type GovernanceProposalType = z.infer<typeof governanceProposalTypeSchema>;
export type WriteBackCandidate = z.infer<typeof writeBackCandidateSchema>;
export type WriteJobEnvelope = z.infer<typeof writeJobEnvelopeSchema>;
export type WriteBackBatchRequest = z.infer<typeof writeBackBatchRequestSchema>;
export type RuntimeWriteBackCandidate = z.infer<typeof runtimeWriteBackCandidateSchema>;
export type RuntimeWriteBackBatchRequest = z.infer<typeof runtimeWriteBackBatchRequestSchema>;
export type RuntimeCompatibleWriteBackCandidate = z.infer<
  typeof runtimeCompatibleWriteBackCandidateSchema
>;
export type RuntimeCompatibleWriteBackBatchRequest = z.infer<
  typeof runtimeCompatibleWriteBackBatchRequestSchema
>;
export type RecordQuery = z.infer<typeof recordQuerySchema>;
export type RecordPatchInput = z.infer<typeof recordPatchSchema>;
export type ArchiveRecordInput = z.infer<typeof archiveRecordSchema>;
export type ConfirmRecordInput = z.infer<typeof confirmRecordSchema>;
export type InvalidateRecordInput = z.infer<typeof invalidateRecordSchema>;
export type DeleteRecordInput = z.infer<typeof deleteRecordSchema>;
export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>;
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;
export type GovernanceExecutionItem = z.infer<typeof governanceExecutionItemSchema>;
export type GovernanceExecutionBatchRequest = z.infer<typeof governanceExecutionBatchRequestSchema>;

export interface NormalizedMemory extends WriteBackCandidate {
  user_id: string | null;
  task_id: string | null;
  session_id: string | null;
  suggested_status?: "active" | "pending_confirmation";
  source: WriteBackCandidate["source"] & {
    confirmed_by_user: boolean;
  };
  importance: number;
  confidence: number;
  memory_type: MemoryType;
  dedupe_key: string;
  source_type: string;
  source_ref: string;
  source_service: string;
  candidate_hash: string;
}

export interface MemoryRecord {
  id: string;
  workspace_id: string;
  user_id: string | null;
  task_id: string | null;
  session_id: string | null;
  memory_type: MemoryType;
  scope: Scope;
  status: MemoryStatus;
  summary: string;
  details_json: Record<string, unknown>;
  importance: number;
  confidence: number;
  dedupe_key: string;
  source_type: string;
  source_ref: string;
  created_by_service: string;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  version: number;
}

export interface MemoryWriteJob {
  id: string;
  idempotency_key: string;
  workspace_id: string;
  user_id: string | null;
  candidate_json: WriteBackCandidate;
  candidate_hash: string;
  source_service: string;
  job_status: WriteJobStatus;
  result_record_id: string | null;
  result_status: string | null;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  received_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface MemoryConflict {
  id: string;
  workspace_id: string;
  user_id: string | null;
  record_id: string;
  conflict_with_record_id: string;
  pending_record_id: string | null;
  existing_record_id: string | null;
  conflict_type: ConflictType;
  conflict_summary: string;
  status: ConflictStatus;
  resolution_type: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface MemoryRecordVersion {
  id: string;
  record_id: string;
  version_no: number;
  snapshot_json: Record<string, unknown>;
  change_type: string;
  change_reason: string;
  changed_by_type: string;
  changed_by_id: string;
  changed_at: string;
}

export interface ReadModelEntry {
  id: string;
  workspace_id: string;
  user_id: string | null;
  task_id: string | null;
  session_id: string | null;
  memory_type: MemoryType;
  scope: Scope;
  status: MemoryStatus;
  summary: string;
  details: Record<string, unknown> | null;
  importance: number;
  confidence: number;
  source: Record<string, unknown> | null;
  last_confirmed_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  summary_embedding: number[] | null;
  embedding_status: "ok" | "pending" | "failed";
  embedding_attempted_at: string | null;
  embedding_attempt_count: number;
}

export interface StorageMetrics {
  write_jobs_total: number;
  queued_jobs: number;
  processing_jobs: number;
  succeeded_jobs: number;
  failed_jobs: number;
  dead_letter_jobs: number;
  active_records: number;
  pending_confirmation_records: number;
  archived_records: number;
  conflicts_open: number;
  duplicate_ignored_jobs: number;
  merged_jobs: number;
  updated_jobs: number;
  inserted_jobs: number;
  projector_failed_jobs: number;
  projector_dead_letter_jobs: number;
  projector_embedding_degraded_jobs: number;
  pending_embedding_records: number;
  new_pending_embedding_records: number;
  retry_pending_embedding_records: number;
  oldest_pending_embedding_age_seconds: number;
  governance_proposal_count: number;
  governance_verifier_required_count: number;
  governance_verifier_approved_count: number;
  governance_guard_rejected_count: number;
  governance_execution_count: number;
  governance_execution_success_count: number;
  governance_execution_failure_count: number;
  governance_soft_delete_count: number;
  governance_retry_count: number;
}

export const EXPECTED_SUMMARY_EMBEDDING_DIMENSION = 1536;

export interface GovernanceAction {
  record_id: string;
  action_type: GovernanceActionType;
  action_payload: Record<string, unknown>;
  actor_type: "system" | "user" | "operator";
  actor_id: string;
  created_at: string;
}

export interface GovernanceProposal {
  id: string;
  workspace_id: string;
  proposal_type: GovernanceProposalType;
  status: GovernanceExecutionStatus;
  reason_code: string;
  reason_text: string;
  suggested_changes_json: Record<string, unknown>;
  evidence_json: Record<string, unknown>;
  planner_model: string;
  planner_confidence: number;
  verifier_required: boolean;
  verifier_model: string | null;
  verifier_decision: "approve" | "reject" | null;
  verifier_confidence: number | null;
  verifier_notes: string | null;
  policy_version: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface GovernanceProposalTarget {
  proposal_id: string;
  record_id: string | null;
  conflict_id: string | null;
  role: "target" | "winner" | "loser" | "seed" | "related";
}

export interface GovernanceExecution {
  id: string;
  workspace_id: string;
  proposal_id: string;
  proposal_type: GovernanceProposalType;
  execution_status: GovernanceExecutionStatus;
  result_summary: string | null;
  error_message: string | null;
  source_service: string;
  started_at: string;
  finished_at: string | null;
}

export interface GovernanceExecutionDetail {
  proposal: GovernanceProposal;
  targets: GovernanceProposalTarget[];
  execution: GovernanceExecution;
}

export type MemoryRelationType =
  | "depends_on"
  | "conflicts_with"
  | "extends"
  | "supersedes"
  | "related_to";

export interface MemoryRelation {
  id: string;
  workspace_id: string;
  source_record_id: string;
  target_record_id: string;
  relation_type: MemoryRelationType;
  strength: number;
  bidirectional: boolean;
  reason: string;
  created_by_service: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryRelationUpsertInput {
  workspace_id: string;
  source_record_id: string;
  target_record_id: string;
  relation_type: MemoryRelationType;
  strength: number;
  bidirectional: boolean;
  reason: string;
  created_by_service: string;
}

export interface RecordHistoryEntry {
  entry_type: "governance_action" | "record_version";
  created_at: string;
  record_id: string;
  payload: GovernanceAction | MemoryRecordVersion;
}

export interface ReadModelRefreshJob {
  id: string;
  source_record_id: string;
  refresh_type: "insert" | "update" | "delete";
  job_status: RefreshJobStatus;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface WriteProjectionStatus {
  job_id: string;
  write_job_status: WriteJobStatus;
  result_record_id: string | null;
  result_status: string | null;
  latest_refresh_job: {
    job_id: string;
    source_record_id: string;
    refresh_type: ReadModelRefreshJob["refresh_type"];
    job_status: RefreshJobStatus;
    created_at: string;
    finished_at: string | null;
    error_message: string | null;
  } | null;
  projection_ready: boolean;
}

export interface SubmittedWriteBackJob {
  candidate_summary: string;
  job_id: string;
  status: "accepted_async" | "accepted";
  reason?: string;
}

export interface AcceptedWriteBackJob {
  job_id: string;
  status: "accepted_async";
  received_at: string;
  candidate_summary?: string;
}

export interface RecordListPage {
  items: MemoryRecord[];
  total: number;
  page: number;
  page_size: number;
}

function containsTranscriptLikeContent(value: Record<string, unknown>): boolean {
  const riskyKeys = new Set([
    "transcript",
    "messages",
    "conversation",
    "raw_transcript",
    "raw_messages",
    "dialogue",
  ]);

  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current) && current.length > 20) {
      return true;
    }

    if (!current || typeof current !== "object") {
      continue;
    }

    for (const [key, nested] of Object.entries(current)) {
      if (riskyKeys.has(key)) {
        return true;
      }

      if (typeof nested === "string" && nested.length > 4000) {
        return true;
      }

      queue.push(nested);
    }
  }

  return false;
}

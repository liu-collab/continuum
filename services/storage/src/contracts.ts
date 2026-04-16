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
  "restore_version",
]);

const sourceSchema = z.object({
  source_type: z.string().trim().min(1),
  source_ref: z.string().trim().min(1),
  service_name: z.string().trim().min(1).default("retrieval-runtime"),
  confirmed_by_user: z.boolean().optional(),
});

const structuredDetailsSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => !containsTranscriptLikeContent(value), {
    message: "details must remain structured and cannot contain raw transcript payloads",
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

export const runtimeWriteBackCandidateSchema = z.object({
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

export const runtimeWriteBackBatchRequestSchema = z.object({
  workspace_id: z.uuid(),
  user_id: z.uuid(),
  session_id: z.uuid(),
  task_id: z.uuid().optional(),
  source_service: z.string().trim().min(1).default("retrieval-runtime"),
  candidates: z.array(runtimeWriteBackCandidateSchema).min(1).max(50),
});

export const recordQuerySchema = z.object({
  workspace_id: z.uuid().optional(),
  user_id: z.uuid().optional(),
  task_id: z.uuid().optional(),
  memory_type: memoryTypeSchema.optional(),
  scope: scopeSchema.optional(),
  status: memoryStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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

export const archiveRecordSchema = z.object({
  actor: z.object({
    actor_type: z.enum(["system", "user", "operator"]),
    actor_id: z.string().trim().min(1),
  }),
  reason: z.string().trim().min(3).max(240),
});

export const restoreVersionSchema = z.object({
  version_no: z.number().int().min(1),
  actor: z.object({
    actor_type: z.enum(["system", "user", "operator"]),
    actor_id: z.string().trim().min(1),
  }),
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
export type WriteBackCandidate = z.infer<typeof writeBackCandidateSchema>;
export type WriteJobEnvelope = z.infer<typeof writeJobEnvelopeSchema>;
export type WriteBackBatchRequest = z.infer<typeof writeBackBatchRequestSchema>;
export type RuntimeWriteBackCandidate = z.infer<typeof runtimeWriteBackCandidateSchema>;
export type RuntimeWriteBackBatchRequest = z.infer<typeof runtimeWriteBackBatchRequestSchema>;
export type RecordQuery = z.infer<typeof recordQuerySchema>;
export type RecordPatchInput = z.infer<typeof recordPatchSchema>;
export type ArchiveRecordInput = z.infer<typeof archiveRecordSchema>;
export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>;
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;

export interface NormalizedMemory extends WriteBackCandidate {
  user_id: string | null;
  task_id: string | null;
  session_id: string | null;
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
  updated_at: string;
  summary_embedding: number[] | null;
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

export interface SubmittedWriteBackJob {
  candidate_summary: string;
  job_id: string;
  status: "accepted_async" | "accepted";
  reason?: string;
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

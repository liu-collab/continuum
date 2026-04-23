import { z } from "zod";

export const memoryModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);
export const runtimePhaseSchema = z.enum([
  "session_start",
  "task_start",
  "task_switch",
  "before_plan",
  "before_response",
  "after_response",
]);
export const memoryTypeSchema = z.enum(["fact_preference", "task_state", "episodic"]);
export const scopeTypeSchema = z.enum(["workspace", "user", "task", "session"]);
export const recordStatusSchema = z.enum(["active", "pending_confirmation", "superseded", "archived", "deleted"]);
export const dependencyStateSchema = z.enum(["healthy", "degraded", "unavailable", "unknown"]);

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)]),
);

const dependencyNameSchema = z.enum(["read_model", "embeddings", "storage_writeback", "memory_llm"]);

export const dependencyStatusSchema = z.object({
  name: dependencyNameSchema,
  status: dependencyStateSchema,
  detail: z.string(),
  last_checked_at: z.string(),
});

export const dependencyProbeResultSchema = dependencyStatusSchema;

export const dependencyStatusSnapshotSchema = z.object({
  read_model: dependencyStatusSchema,
  embeddings: dependencyStatusSchema,
  storage_writeback: dependencyStatusSchema,
  memory_llm: dependencyStatusSchema,
});

export const sessionStartRequestSchema = z.object({
  session_id: z.string().min(1),
  cwd: z.string().optional(),
  source: z.string().optional(),
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  task_id: z.string().uuid().optional(),
  recent_context_summary: z.string().optional(),
  memory_mode: memoryModeSchema.optional(),
});

export const prepareContextRequestSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  task_id: z.string().uuid().optional(),
  session_id: z.string().min(1),
  thread_id: z.string().min(1).optional(),
  turn_id: z.string().min(1).optional(),
  phase: runtimePhaseSchema,
  current_input: z.string().min(1),
  recent_context_summary: z.string().optional(),
  cwd: z.string().optional(),
  source: z.string().optional(),
  memory_mode: memoryModeSchema.optional(),
});

export const finalizeTurnRequestSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  task_id: z.string().uuid().optional(),
  session_id: z.string().min(1),
  thread_id: z.string().min(1).optional(),
  turn_id: z.string().min(1).optional(),
  current_input: z.string().min(1),
  assistant_output: z.string().min(1),
  tool_results_summary: z.string().optional(),
  memory_mode: memoryModeSchema.optional(),
});

export const writeProjectionStatusRequestSchema = z.object({
  job_ids: z.array(z.string().uuid()).min(1).max(100),
});

export const candidateMemorySchema = z.object({
  id: z.string(),
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  session_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  memory_type: memoryTypeSchema,
  scope: scopeTypeSchema,
  summary: z.string(),
  details: z.record(jsonValueSchema).nullable().optional(),
  source: z.record(jsonValueSchema).nullable().optional(),
  importance: z.number(),
  confidence: z.number(),
  status: recordStatusSchema,
  updated_at: z.string(),
  last_confirmed_at: z.string().nullable().optional(),
  summary_embedding: z.array(z.number()).optional(),
  semantic_score: z.number().optional(),
  rerank_score: z.number().optional(),
});

export const memoryPacketSchema = z.object({
  packet_id: z.string(),
  trigger: z.string(),
  memory_mode: memoryModeSchema,
  requested_scopes: z.array(scopeTypeSchema),
  selected_scopes: z.array(scopeTypeSchema),
  scope_reason: z.string(),
  query_scope: z.string(),
  records: z.array(candidateMemorySchema),
  packet_summary: z.string(),
  injection_hint: z.string(),
  ttl_ms: z.number(),
  priority_breakdown: z.record(z.string(), z.number()),
  empty_reason: z.string().optional(),
});

export const injectionRecordSchema = z.object({
  id: z.string(),
  memory_type: memoryTypeSchema,
  scope: scopeTypeSchema,
  summary: z.string(),
  importance: z.number(),
  confidence: z.number(),
  source: z.record(jsonValueSchema).nullable().optional(),
});

export const injectionBlockSchema = z.object({
  injection_reason: z.string(),
  memory_summary: z.string(),
  memory_records: z.array(injectionRecordSchema),
  token_estimate: z.number(),
  memory_mode: memoryModeSchema,
  requested_scopes: z.array(scopeTypeSchema),
  selected_scopes: z.array(scopeTypeSchema),
  trimmed_record_ids: z.array(z.string()),
  trim_reasons: z.array(z.string()),
});

export const writeBackCandidateSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  task_id: z.string().uuid().nullable(),
  session_id: z.string().nullable(),
  candidate_type: memoryTypeSchema,
  scope: scopeTypeSchema,
  summary: z.string(),
  details: z.record(jsonValueSchema),
  importance: z.number(),
  confidence: z.number(),
  write_reason: z.string(),
  source: z.object({
    source_type: z.string(),
    source_ref: z.string(),
    service_name: z.string(),
    confirmed_by_user: z.boolean().optional(),
    extraction_method: z.string().optional(),
  }),
  idempotency_key: z.string(),
});

export const submittedWriteBackJobSchema = z.object({
  candidate_summary: z.string(),
  job_id: z.string().optional(),
  status: z.enum(["accepted", "accepted_async", "merged", "rejected", "dependency_unavailable"]),
  reason: z.string().optional(),
});

export const writeProjectionStatusSchema = z.object({
  job_id: z.string().uuid(),
  write_job_status: z.enum(["queued", "processing", "succeeded", "failed", "dead_letter"]),
  result_record_id: z.string().uuid().nullable(),
  result_status: z.string().nullable(),
  latest_refresh_job: z.object({
    job_id: z.string().uuid(),
    source_record_id: z.string().uuid(),
    refresh_type: z.enum(["insert", "update", "delete"]),
    job_status: z.enum(["queued", "processing", "succeeded", "failed", "dead_letter"]),
    created_at: z.string(),
    finished_at: z.string().nullable(),
    error_message: z.string().nullable(),
  }).nullable(),
  projection_ready: z.boolean(),
});

export const writeProjectionStatusResultSchema = z.object({
  items: z.array(writeProjectionStatusSchema),
});

export const prepareContextResultSchema = z.object({
  trace_id: z.string(),
  trigger: z.boolean(),
  trigger_reason: z.string(),
  memory_packet: memoryPacketSchema.nullable(),
  injection_block: injectionBlockSchema.nullable(),
  degraded: z.boolean(),
  degraded_skip_reason: z.string().optional(),
  dependency_status: dependencyStatusSnapshotSchema,
  budget_used: z.number(),
  memory_packet_ids: z.array(z.string()),
});

export const sessionStartResultSchema = z.object({
  trace_id: z.string(),
  additional_context: z.string(),
  active_task_summary: z.string().nullable(),
  injection_block: injectionBlockSchema.nullable(),
  memory_mode: memoryModeSchema,
  dependency_status: dependencyStatusSnapshotSchema,
  degraded: z.boolean(),
});

export const finalizeTurnResultSchema = z.object({
  trace_id: z.string(),
  write_back_candidates: z.array(writeBackCandidateSchema),
  submitted_jobs: z.array(submittedWriteBackJobSchema),
  memory_mode: memoryModeSchema,
  candidate_count: z.number(),
  filtered_count: z.number(),
  filtered_reasons: z.array(z.string()),
  writeback_submitted: z.boolean(),
  degraded: z.boolean(),
  dependency_status: dependencyStatusSnapshotSchema,
});

export const healthEndpointSchema = z.object({
  version: z.string().optional(),
  api_version: z.string().optional(),
  liveness: z.object({
    status: z.enum(["alive"]),
  }),
  readiness: z.object({
    status: z.enum(["ready"]),
  }),
  dependencies: dependencyStatusSnapshotSchema,
});

export const runtimeErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type SessionStartRequest = z.infer<typeof sessionStartRequestSchema>;
export type PrepareContextRequest = z.infer<typeof prepareContextRequestSchema>;
export type FinalizeTurnRequest = z.infer<typeof finalizeTurnRequestSchema>;
export type WriteProjectionStatusRequest = z.infer<typeof writeProjectionStatusRequestSchema>;
export type SessionStartResult = z.infer<typeof sessionStartResultSchema>;
export type PrepareContextResult = z.infer<typeof prepareContextResultSchema>;
export type FinalizeTurnResult = z.infer<typeof finalizeTurnResultSchema>;
export type WriteProjectionStatusResult = z.infer<typeof writeProjectionStatusResultSchema>;
export type DependencyStatusSnapshot = z.infer<typeof dependencyStatusSnapshotSchema>;
export type DependencyProbeResult = z.infer<typeof dependencyProbeResultSchema>;
export type HealthEndpointResult = z.infer<typeof healthEndpointSchema>;

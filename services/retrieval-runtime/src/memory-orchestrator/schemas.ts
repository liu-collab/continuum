import { z } from "zod";

export const memoryScopeSchema = z.enum(["workspace", "user", "task", "session"]);
export const memoryTypeSchema = z.enum(["fact_preference", "task_state", "episodic"]);
export const memoryImportanceSchema = z.number().int().min(1).max(5);
export const memoryCandidateLimitSchema = z.number().int().min(1).max(50);

export const memoryRecallSearchSchema = z.object({
  should_search: z.boolean(),
  reason: z.string().min(1),
  requested_scopes: z.array(memoryScopeSchema).optional(),
  requested_memory_types: z.array(memoryTypeSchema).optional(),
  importance_threshold: memoryImportanceSchema.optional(),
  query_hint: z.string().min(1).optional(),
  candidate_limit: memoryCandidateLimitSchema.optional(),
});

export const memoryRecallInjectSchema = z.object({
  should_inject: z.literal(true),
  reason: z.string().min(1),
  selected_record_ids: z.array(z.string().min(1)).min(1),
  memory_summary: z.string().min(1),
  requested_scopes: z.array(memoryScopeSchema).optional(),
  requested_memory_types: z.array(memoryTypeSchema).optional(),
  importance_threshold: memoryImportanceSchema.optional(),
});

export const memoryRecallSkipSchema = z.object({
  should_inject: z.literal(false),
  reason: z.string().min(1),
  selected_record_ids: z.array(z.string().min(1)).optional(),
  memory_summary: z.string().optional(),
  requested_scopes: z.array(memoryScopeSchema).optional(),
  requested_memory_types: z.array(memoryTypeSchema).optional(),
  importance_threshold: memoryImportanceSchema.optional(),
});

export const memoryRecallInjectionSchema = z.discriminatedUnion("should_inject", [
  memoryRecallInjectSchema,
  memoryRecallSkipSchema,
]);

export const memoryWritebackCandidateSchema = z.object({
  candidate_type: memoryTypeSchema,
  scope: memoryScopeSchema,
  summary: z.string().min(1),
  importance: memoryImportanceSchema,
  confidence: z.number().min(0).max(1),
  write_reason: z.string().min(1),
});

export const memoryWritebackExtractionSchema = z.object({
  candidates: z.array(memoryWritebackCandidateSchema),
});

const ruleIndexPattern = /^rule_index:\d+$/;

export const memoryWritebackRefineItemSchema = z.object({
  source: z.union([z.literal("llm_new"), z.string().regex(ruleIndexPattern)]),
  action: z.enum(["keep", "drop", "merge", "new"]),
  summary: z.string().min(1).optional(),
  importance: memoryImportanceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  scope: memoryScopeSchema.optional(),
  candidate_type: memoryTypeSchema.optional(),
  merge_with: z.array(z.string().regex(ruleIndexPattern)).optional(),
  reason: z.string().min(1),
});

export const memoryWritebackRefineSchema = z.object({
  refined_candidates: z.array(memoryWritebackRefineItemSchema),
});

export const memoryGovernanceMergeActionSchema = z.object({
  type: z.literal("merge"),
  target_record_ids: z.array(z.string().min(1)).min(2),
  merged_summary: z.string().min(1),
  merged_importance: memoryImportanceSchema.optional(),
  reason: z.string().min(1),
});

export const memoryGovernanceArchiveActionSchema = z.object({
  type: z.literal("archive"),
  record_id: z.string().min(1),
  reason: z.string().min(1),
});

export const memoryGovernanceDowngradeActionSchema = z.object({
  type: z.literal("downgrade"),
  record_id: z.string().min(1),
  new_importance: memoryImportanceSchema,
  reason: z.string().min(1),
});

export const memoryGovernanceSummarizeActionSchema = z.object({
  type: z.literal("summarize"),
  source_record_ids: z.array(z.string().min(1)).min(1),
  new_summary: z.string().min(1),
  new_importance: memoryImportanceSchema,
  scope: memoryScopeSchema,
  candidate_type: memoryTypeSchema,
  reason: z.string().min(1),
});

export const memoryGovernanceDeleteActionSchema = z.object({
  type: z.literal("delete"),
  record_id: z.string().min(1),
  reason: z.string().min(1),
  delete_reason: z.string().min(3),
});

export const memoryGovernanceResolveConflictActionSchema = z.object({
  type: z.literal("resolve_conflict"),
  conflict_id: z.string().min(1),
  resolution_type: z.enum(["auto_merge", "manual_fix", "dismissed"]),
  activate_record_id: z.string().min(1).optional(),
  resolution_note: z.string().min(1),
});

export const memoryGovernanceActionSchema = z.discriminatedUnion("type", [
  memoryGovernanceMergeActionSchema,
  memoryGovernanceArchiveActionSchema,
  memoryGovernanceDowngradeActionSchema,
  memoryGovernanceSummarizeActionSchema,
  memoryGovernanceDeleteActionSchema,
  memoryGovernanceResolveConflictActionSchema,
]);

export const memoryGovernancePlanSchema = z.object({
  actions: z.array(memoryGovernanceActionSchema),
  notes: z.string().optional(),
});

export const memoryGovernanceVerificationSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  confidence: z.number().min(0).max(1),
  notes: z.string().min(1),
});

export type MemoryRecallSearchSchema = z.infer<typeof memoryRecallSearchSchema>;
export type MemoryRecallInjectionSchema = z.infer<typeof memoryRecallInjectionSchema>;
export type MemoryWritebackCandidateSchema = z.infer<typeof memoryWritebackCandidateSchema>;
export type MemoryWritebackExtractionSchema = z.infer<typeof memoryWritebackExtractionSchema>;
export type MemoryWritebackRefineItemSchema = z.infer<typeof memoryWritebackRefineItemSchema>;
export type MemoryWritebackRefineSchema = z.infer<typeof memoryWritebackRefineSchema>;
export type MemoryGovernanceActionSchema = z.infer<typeof memoryGovernanceActionSchema>;
export type MemoryGovernancePlanSchema = z.infer<typeof memoryGovernancePlanSchema>;
export type MemoryGovernanceVerificationSchema = z.infer<typeof memoryGovernanceVerificationSchema>;

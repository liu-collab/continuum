import { z } from "zod";

export const memoryScopeSchema = z.enum(["workspace", "user", "task", "session"]);
export const memoryTypeSchema = z.enum(["fact_preference", "task_state", "episodic"]);
export const memoryImportanceSchema = z.number().int().min(1).max(5);
export const memoryCandidateLimitSchema = z.number().int().min(1).max(50);
export const memoryConfidenceSchema = z.number().min(0).max(1);

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

export const memoryIntentAnalyzerInputSchema = z.object({
  current_input: z.string().min(1),
  session_context: z.object({
    session_id: z.string().min(1),
    workspace_id: z.string().min(1),
    recent_turns: z.array(
      z.object({
        user_input: z.string(),
        assistant_output: z.string(),
      }),
    ),
  }),
});

export const memoryIntentAnalyzerSchema = z.object({
  needs_memory: z.boolean(),
  memory_types: z.array(memoryTypeSchema),
  urgency: z.enum(["immediate", "deferred", "optional"]),
  confidence: memoryConfidenceSchema,
  reason: z.string().min(1),
  suggested_scopes: z.array(memoryScopeSchema).optional(),
});

export const memoryWritebackCandidateSchema = z.object({
  candidate_type: memoryTypeSchema,
  scope: memoryScopeSchema,
  summary: z.string().min(1),
  importance: memoryImportanceSchema,
  confidence: memoryConfidenceSchema,
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
  confidence: memoryConfidenceSchema.optional(),
  scope: memoryScopeSchema.optional(),
  candidate_type: memoryTypeSchema.optional(),
  merge_with: z.array(z.string().regex(ruleIndexPattern)).optional(),
  reason: z.string().min(1),
});

export const memoryWritebackRefineSchema = z.object({
  refined_candidates: z.array(memoryWritebackRefineItemSchema),
});

export const memoryQualityIssueSchema = z.object({
  type: z.enum(["duplicate", "low_quality", "conflict", "vague"]),
  severity: z.enum(["high", "medium", "low"]),
  description: z.string().min(1),
});

export const memoryQualityAssessmentSchema = z.object({
  candidate_id: z.string().min(1),
  quality_score: memoryConfidenceSchema,
  confidence: memoryConfidenceSchema,
  potential_conflicts: z.array(z.string().min(1)),
  suggested_importance: memoryImportanceSchema,
  suggested_status: z.enum(["active", "pending_confirmation"]),
  issues: z.array(memoryQualityIssueSchema),
  reason: z.string().min(1),
});

export const memoryQualityAssessmentResultSchema = z.object({
  assessments: z.array(memoryQualityAssessmentSchema),
});

export const memoryEffectivenessEvaluationSchema = z.object({
  record_id: z.string().min(1),
  was_used: z.boolean(),
  usage_confidence: memoryConfidenceSchema,
  effectiveness_score: memoryConfidenceSchema,
  suggested_importance_adjustment: z.number().int().min(-2).max(2),
  usage_evidence: z.string().min(1).optional(),
  reason: z.string().min(1),
});

export const memoryEffectivenessEvaluationResultSchema = z.object({
  evaluations: z.array(memoryEffectivenessEvaluationSchema),
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
  confidence: memoryConfidenceSchema,
  notes: z.string().min(1),
});

export const memoryRelationTypeSchema = z.enum([
  "depends_on",
  "conflicts_with",
  "extends",
  "supersedes",
  "related_to",
]);

export const memoryRelationDiscoveryItemSchema = z.object({
  target_record_id: z.string().min(1),
  relation_type: memoryRelationTypeSchema,
  strength: memoryConfidenceSchema,
  bidirectional: z.boolean(),
  reason: z.string().min(1),
});

export const memoryRelationDiscoverySchema = z.object({
  source_record_id: z.string().min(1),
  relations: z.array(memoryRelationDiscoveryItemSchema),
});

export const memoryRecommendationTriggerReasonSchema = z.enum([
  "task_similarity",
  "forgotten_context",
  "related_decision",
  "conflict_warning",
]);

export const memoryProactiveRecommendationItemSchema = z.object({
  record_id: z.string().min(1),
  relevance_score: memoryConfidenceSchema,
  trigger_reason: memoryRecommendationTriggerReasonSchema,
  suggestion: z.string().min(1),
  auto_inject: z.boolean(),
});

export const memoryProactiveRecommendationSchema = z.object({
  recommendations: z.array(memoryProactiveRecommendationItemSchema),
});

export const memoryEvolutionTypeSchema = z.enum([
  "knowledge_extraction",
  "pattern_discovery",
  "summarization",
]);

export const memoryEvolutionPlanSchema = z.object({
  evolution_type: memoryEvolutionTypeSchema,
  source_records: z.array(z.string().min(1)).min(1),
  extracted_knowledge: z.object({
    pattern: z.string().min(1),
    confidence: memoryConfidenceSchema,
    evidence_count: z.number().int().min(1),
    suggested_scope: z.enum(["user", "workspace"]),
    suggested_importance: memoryImportanceSchema,
  }).optional(),
  consolidation_plan: z.object({
    new_summary: z.string().min(1),
    records_to_archive: z.array(z.string().min(1)).min(1),
  }).optional(),
});

export type MemoryRecallSearchSchema = z.infer<typeof memoryRecallSearchSchema>;
export type MemoryRecallInjectionSchema = z.infer<typeof memoryRecallInjectionSchema>;
export type MemoryIntentAnalyzerSchema = z.infer<typeof memoryIntentAnalyzerSchema>;
export type MemoryWritebackCandidateSchema = z.infer<typeof memoryWritebackCandidateSchema>;
export type MemoryWritebackExtractionSchema = z.infer<typeof memoryWritebackExtractionSchema>;
export type MemoryWritebackRefineItemSchema = z.infer<typeof memoryWritebackRefineItemSchema>;
export type MemoryWritebackRefineSchema = z.infer<typeof memoryWritebackRefineSchema>;
export type MemoryQualityAssessmentSchema = z.infer<typeof memoryQualityAssessmentSchema>;
export type MemoryQualityAssessmentResultSchema = z.infer<typeof memoryQualityAssessmentResultSchema>;
export type MemoryEffectivenessEvaluationSchema = z.infer<typeof memoryEffectivenessEvaluationSchema>;
export type MemoryEffectivenessEvaluationResultSchema = z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
export type MemoryGovernanceActionSchema = z.infer<typeof memoryGovernanceActionSchema>;
export type MemoryGovernancePlanSchema = z.infer<typeof memoryGovernancePlanSchema>;
export type MemoryGovernanceVerificationSchema = z.infer<typeof memoryGovernanceVerificationSchema>;
export type MemoryRelationDiscoverySchema = z.infer<typeof memoryRelationDiscoverySchema>;
export type MemoryProactiveRecommendationSchema = z.infer<typeof memoryProactiveRecommendationSchema>;
export type MemoryEvolutionPlanSchema = z.infer<typeof memoryEvolutionPlanSchema>;

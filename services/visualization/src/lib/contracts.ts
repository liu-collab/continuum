import { z } from "zod";

export const MemoryTypeSchema = z.enum(["fact_preference", "task_state", "episodic"]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const ScopeSchema = z.enum(["session", "task", "user", "workspace"]);
export type Scope = z.infer<typeof ScopeSchema>;

export const MemoryViewModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);
export type MemoryViewMode = z.infer<typeof MemoryViewModeSchema>;

export const MemoryStatusSchema = z.enum([
  "active",
  "superseded",
  "archived",
  "pending_confirmation",
  "deleted"
]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const SourceHealthStatusSchema = z.enum([
  "healthy",
  "unavailable",
  "timeout",
  "misconfigured",
  "partial"
]);
export type SourceHealthStatus = z.infer<typeof SourceHealthStatusSchema>;

export const SourceStatusSchema = z.object({
  name: z.string(),
  label: z.string(),
  kind: z.enum(["service", "dependency"]),
  status: SourceHealthStatusSchema,
  checkedAt: z.string(),
  lastCheckedAt: z.string().default(""),
  lastOkAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  responseTimeMs: z.number().nullable().default(null),
  detail: z.string().nullable().default(null),
  activeConnections: z.number().int().nonnegative().nullable().default(null),
  connectionLimit: z.number().int().positive().nullable().default(null)
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const MemoryCatalogFiltersSchema = z.object({
  workspaceId: z.string().trim().optional(),
  taskId: z.string().trim().optional(),
  sessionId: z.string().trim().optional(),
  sourceRef: z.string().trim().optional(),
  memoryViewMode: MemoryViewModeSchema.default("workspace_plus_global"),
  memoryType: MemoryTypeSchema.optional(),
  scope: ScopeSchema.optional(),
  status: MemoryStatusSchema.optional(),
  updatedFrom: z.string().trim().optional(),
  updatedTo: z.string().trim().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20)
});
export type MemoryCatalogFilters = z.infer<typeof MemoryCatalogFiltersSchema>;

export const MemoryCatalogItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  taskId: z.string().nullable(),
  sessionId: z.string().nullable(),
  memoryType: MemoryTypeSchema,
  memoryTypeLabel: z.string(),
  scope: ScopeSchema,
  scopeLabel: z.string(),
  scopeExplanation: z.string(),
  status: MemoryStatusSchema,
  statusLabel: z.string(),
  statusExplanation: z.string(),
  summary: z.string(),
  importance: z.number().nullable(),
  confidence: z.number().nullable(),
  originWorkspaceId: z.string().nullable(),
  originWorkspaceLabel: z.string(),
  visibilitySummary: z.string(),
  sourceType: z.string().nullable(),
  sourceRef: z.string().nullable(),
  sourceServiceName: z.string().nullable(),
  sourceSummary: z.string(),
  lastConfirmedAt: z.string().nullable(),
  updatedAt: z.string().nullable()
});
export type MemoryCatalogItem = z.infer<typeof MemoryCatalogItemSchema>;

export const MemoryCatalogDetailSchema = MemoryCatalogItemSchema.extend({
  details: z.record(z.string(), z.unknown()).nullable(),
  detailsFormatted: z.string(),
  sourceFormatted: z.string(),
  createdAt: z.string().nullable(),
  governanceHistory: z.array(z.object({
    executionId: z.string(),
    proposalId: z.string(),
    proposalType: z.string(),
    proposalTypeLabel: z.string(),
    executionStatus: z.string(),
    executionStatusLabel: z.string(),
    reasonCode: z.string(),
    reasonText: z.string(),
    resultSummary: z.string().nullable(),
    errorMessage: z.string().nullable(),
    deleteReason: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    plannerModel: z.string(),
    plannerConfidence: z.number().nullable(),
    verifierRequired: z.boolean(),
    verifierDecision: z.string().nullable(),
    verifierConfidence: z.number().nullable(),
    verifierNotes: z.string().nullable(),
    targetSummary: z.string(),
  })),
  governanceSummary: z.string()
});
export type MemoryCatalogDetail = z.infer<typeof MemoryCatalogDetailSchema>;

export const GovernanceExecutionListItemSchema = z.object({
  executionId: z.string(),
  proposalId: z.string(),
  workspaceId: z.string(),
  proposalType: z.string(),
  proposalTypeLabel: z.string(),
  executionStatus: z.string(),
  executionStatusLabel: z.string(),
  reasonCode: z.string(),
  reasonText: z.string(),
  deleteReason: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  sourceService: z.string(),
  plannerModel: z.string(),
  plannerConfidence: z.number().nullable(),
  verifierRequired: z.boolean(),
  verifierModel: z.string().nullable(),
  verifierDecision: z.string().nullable(),
  verifierConfidence: z.number().nullable(),
  verifierNotes: z.string().nullable(),
  targetSummary: z.string(),
  targetRecordIds: z.array(z.string()),
  resultSummary: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type GovernanceExecutionListItem = z.infer<typeof GovernanceExecutionListItemSchema>;

export const GovernanceExecutionDetailSchema = GovernanceExecutionListItemSchema.extend({
  policyVersion: z.string(),
  verifierModel: z.string().nullable(),
  verifierNotes: z.string().nullable(),
  suggestedChanges: z.record(z.string(), z.unknown()),
  evidence: z.record(z.string(), z.unknown()),
  targets: z.array(
    z.object({
      recordId: z.string().nullable(),
      conflictId: z.string().nullable(),
      role: z.string(),
    }),
  ),
});
export type GovernanceExecutionDetail = z.infer<typeof GovernanceExecutionDetailSchema>;

export const GovernanceExecutionFiltersSchema = z.object({
  workspaceId: z.string().trim().optional(),
  proposalType: z.string().trim().optional(),
  executionStatus: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type GovernanceExecutionFilters = z.infer<typeof GovernanceExecutionFiltersSchema>;

export const GovernanceExecutionResponseSchema = z.object({
  items: z.array(GovernanceExecutionListItemSchema),
  appliedFilters: GovernanceExecutionFiltersSchema,
  sourceStatus: SourceStatusSchema,
});
export type GovernanceExecutionResponse = z.infer<typeof GovernanceExecutionResponseSchema>;

export const MemoryCatalogResponseSchema = z.object({
  items: z.array(MemoryCatalogItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  appliedFilters: MemoryCatalogFiltersSchema,
  viewSummary: z.string(),
  viewWarnings: z.array(z.string()),
  sourceStatus: SourceStatusSchema
});
export type MemoryCatalogResponse = z.infer<typeof MemoryCatalogResponseSchema>;

export const RunTraceFiltersSchema = z.object({
  turnId: z.string().trim().optional(),
  sessionId: z.string().trim().optional(),
  traceId: z.string().trim().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20)
});
export type RunTraceFilters = z.infer<typeof RunTraceFiltersSchema>;

export const ScopeCountSchema = z.object({
  scope: ScopeSchema,
  scopeLabel: z.string(),
  count: z.number().int().nonnegative()
});
export type ScopeCount = z.infer<typeof ScopeCountSchema>;

export const RunTraceListItemSchema = z.object({
  turnId: z.string(),
  traceId: z.string(),
  phase: z.string().nullable(),
  createdAt: z.string().nullable(),
  memoryMode: MemoryViewModeSchema.nullable(),
  scopeSummary: z.string(),
  triggerLabel: z.string(),
  recallOutcome: z.string(),
  injectedCount: z.number().int().nonnegative(),
  writeBackStatus: z.string(),
  degraded: z.boolean(),
  summary: z.string()
});
export type RunTraceListItem = z.infer<typeof RunTraceListItemSchema>;

export const RunTurnSchema = z.object({
  traceId: z.string(),
  turnId: z.string(),
  workspaceId: z.string().nullable(),
  taskId: z.string().nullable(),
  sessionId: z.string().nullable(),
  threadId: z.string().nullable(),
  host: z.string().nullable(),
  phase: z.string().nullable(),
  inputSummary: z.string().nullable(),
  assistantOutputSummary: z.string().nullable(),
  turnStatus: z.string().nullable(),
  createdAt: z.string().nullable(),
  completedAt: z.string().nullable()
});
export type RunTurn = z.infer<typeof RunTurnSchema>;

export const TriggerRunSchema = z.object({
  traceId: z.string(),
  triggerHit: z.boolean(),
  triggerType: z.string().nullable(),
  triggerReason: z.string().nullable(),
  memoryMode: MemoryViewModeSchema.nullable(),
  requestedTypes: z.array(MemoryTypeSchema),
  requestedScopes: z.array(ScopeSchema),
  selectedScopes: z.array(ScopeSchema),
  scopeDecision: z.string(),
  scopeLimit: z.array(z.string()),
  importanceThreshold: z.number().nullable(),
  cooldownApplied: z.boolean(),
  semanticScore: z.number().nullable(),
  latencyMs: z.number().nullable(),
  createdAt: z.string().nullable()
});
export type TriggerRun = z.infer<typeof TriggerRunSchema>;

export const RecallRunSchema = z.object({
  traceId: z.string(),
  triggerType: z.string().nullable(),
  triggerHit: z.boolean(),
  triggerReason: z.string().nullable(),
  memoryMode: MemoryViewModeSchema.nullable(),
  requestedTypes: z.array(MemoryTypeSchema),
  requestedScopes: z.array(ScopeSchema),
  selectedScopes: z.array(ScopeSchema),
  scopeHitCounts: z.array(ScopeCountSchema),
  selectedRecordIds: z.array(z.string()),
  queryScope: z.string().nullable(),
  candidateCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().nonnegative(),
  resultState: z.string(),
  emptyReason: z.string().nullable(),
  latencyMs: z.number().nullable(),
  degraded: z.boolean(),
  degradationReason: z.string().nullable(),
  createdAt: z.string().nullable()
});
export type RecallRun = z.infer<typeof RecallRunSchema>;

export const InjectionRunSchema = z.object({
  traceId: z.string(),
  injected: z.boolean(),
  injectedCount: z.number().int().nonnegative(),
  memoryMode: MemoryViewModeSchema.nullable(),
  requestedScopes: z.array(ScopeSchema),
  selectedScopes: z.array(ScopeSchema),
  keptRecordIds: z.array(z.string()),
  injectionReason: z.string().nullable(),
  memorySummary: z.string().nullable(),
  resultState: z.string(),
  dropReasons: z.array(z.string()),
  tokenEstimate: z.number().nullable(),
  droppedRecordIds: z.array(z.string()),
  latencyMs: z.number().nullable(),
  createdAt: z.string().nullable()
});
export type InjectionRun = z.infer<typeof InjectionRunSchema>;

export const WriteBackScopeDecisionSchema = z.object({
  scope: ScopeSchema,
  scopeLabel: z.string(),
  count: z.number().int().nonnegative(),
  reason: z.string()
});
export type WriteBackScopeDecision = z.infer<typeof WriteBackScopeDecisionSchema>;

export const WriteBackRunSchema = z.object({
  traceId: z.string(),
  memoryMode: MemoryViewModeSchema.nullable(),
  resultState: z.string(),
  candidateCount: z.number().int().nonnegative(),
  submittedCount: z.number().int().nonnegative(),
  filteredCount: z.number().int().nonnegative(),
  submittedJobIds: z.array(z.string()),
  candidateSummaries: z.array(z.string()),
  scopeDecisions: z.array(WriteBackScopeDecisionSchema),
  filteredReasons: z.array(z.string()),
  degraded: z.boolean(),
  degradationReason: z.string().nullable(),
  latencyMs: z.number().nullable(),
  createdAt: z.string().nullable()
});
export type WriteBackRun = z.infer<typeof WriteBackRunSchema>;

export const RunNarrativeSchema = z.object({
  outcomeCode: z.string(),
  outcomeLabel: z.string(),
  explanation: z.string(),
  incomplete: z.boolean()
});
export type RunNarrative = z.infer<typeof RunNarrativeSchema>;

export const RunTracePhaseNarrativeSchema = z.object({
  key: z.enum(["turn", "trigger", "recall", "injection", "plan", "writeback"]),
  title: z.string(),
  summary: z.string(),
  details: z.array(z.string())
});
export type RunTracePhaseNarrative = z.infer<typeof RunTracePhaseNarrativeSchema>;

export const MemoryPlanRunSchema = z.object({
  traceId: z.string(),
  phase: z.string().nullable(),
  planKind: z.enum([
    "memory_search_plan",
    "memory_injection_plan",
    "memory_writeback_plan",
    "memory_governance_plan"
  ]),
  inputSummary: z.string().nullable(),
  outputSummary: z.string().nullable(),
  promptVersion: z.string().nullable(),
  schemaVersion: z.string().nullable(),
  degraded: z.boolean(),
  degradationReason: z.string().nullable(),
  resultState: z.string(),
  latencyMs: z.number().nullable(),
  createdAt: z.string().nullable()
});
export type MemoryPlanRun = z.infer<typeof MemoryPlanRunSchema>;

export const RuntimeDependencySchema = z.object({
  name: z.string(),
  label: z.string(),
  status: z.string(),
  detail: z.string(),
  checkedAt: z.string()
});
export type RuntimeDependency = z.infer<typeof RuntimeDependencySchema>;

export const RunTraceDetailSchema = z.object({
  turn: RunTurnSchema,
  turns: z.array(RunTurnSchema),
  triggerRuns: z.array(TriggerRunSchema),
  recallRuns: z.array(RecallRunSchema),
  injectionRuns: z.array(InjectionRunSchema),
  memoryPlanRuns: z.array(MemoryPlanRunSchema),
  writeBackRuns: z.array(WriteBackRunSchema),
  dependencyStatus: z.array(RuntimeDependencySchema),
  phaseNarratives: z.array(RunTracePhaseNarrativeSchema),
  narrative: RunNarrativeSchema
});
export type RunTraceDetail = z.infer<typeof RunTraceDetailSchema>;

export const RunTraceResponseSchema = z.object({
  items: z.array(RunTraceListItemSchema),
  total: z.number().int().nonnegative(),
  selectedTurn: RunTraceDetailSchema.nullable(),
  appliedFilters: RunTraceFiltersSchema,
  sourceStatus: SourceStatusSchema
});
export type RunTraceResponse = z.infer<typeof RunTraceResponseSchema>;

export const DashboardMetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.enum(["percent", "ms", "count"]),
  description: z.string(),
  source: z.enum(["runtime", "storage"]),
  severity: z.enum(["normal", "warning", "danger", "unknown"]),
  formattedValue: z.string()
});
export type DashboardMetric = z.infer<typeof DashboardMetricSchema>;

export const DashboardDiagnosisSchema = z.object({
  title: z.string(),
  summary: z.string(),
  severity: z.enum(["info", "warning", "danger"])
});
export type DashboardDiagnosis = z.infer<typeof DashboardDiagnosisSchema>;

export const DashboardDiagnosisCardSchema = z.object({
  key: z.string(),
  source: z.enum(["runtime", "storage", "cross"]),
  title: z.string(),
  summary: z.string(),
  severity: z.enum(["info", "warning", "danger"])
});
export type DashboardDiagnosisCard = z.infer<typeof DashboardDiagnosisCardSchema>;

export const DashboardTrendPointSchema = z.object({
  label: z.string(),
  value: z.number().nullable()
});
export type DashboardTrendPoint = z.infer<typeof DashboardTrendPointSchema>;

export const DashboardTrendSchema = z.object({
  key: z.string(),
  title: z.string(),
  summary: z.string(),
  source: z.enum(["runtime", "storage"]),
  unit: z.enum(["percent", "ms", "count"]),
  currentValue: z.number().nullable(),
  previousValue: z.number().nullable(),
  currentFormatted: z.string(),
  previousFormatted: z.string(),
  deltaFormatted: z.string(),
  severity: z.enum(["normal", "warning", "danger", "unknown"]),
  points: z.array(DashboardTrendPointSchema)
});
export type DashboardTrend = z.infer<typeof DashboardTrendSchema>;

export const DashboardResponseSchema = z.object({
  retrievalMetrics: z.array(DashboardMetricSchema),
  storageMetrics: z.array(DashboardMetricSchema),
  trendWindow: z.string(),
  diagnosis: DashboardDiagnosisSchema,
  diagnosisCards: z.array(DashboardDiagnosisCardSchema),
  trends: z.array(DashboardTrendSchema),
  sourceStatus: z.array(SourceStatusSchema)
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

export const MemoryGovernanceActionSchema = z.enum([
  "confirm",
  "edit",
  "invalidate",
  "archive",
  "delete",
  "restore_version"
]);

export const AgentTokenBootstrapResponseSchema = z.object({
  status: z.enum(["ok", "mna_not_running", "token_missing", "token_invalid"]),
  token: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  mnaBaseUrl: z.string().nullable().default(null)
});
export type AgentTokenBootstrapResponse = z.infer<typeof AgentTokenBootstrapResponseSchema>;
export type MemoryGovernanceAction = z.infer<typeof MemoryGovernanceActionSchema>;

export const MemoryGovernanceActionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500)
});
export type MemoryGovernanceActionRequest = z.infer<typeof MemoryGovernanceActionRequestSchema>;

export const MemoryEditRequestSchema = MemoryGovernanceActionRequestSchema.extend({
  summary: z.string().trim().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  status: MemoryStatusSchema.exclude(["deleted"]).optional(),
  scope: ScopeSchema.optional()
});
export type MemoryEditRequest = z.infer<typeof MemoryEditRequestSchema>;

export const MemoryRestoreVersionRequestSchema = MemoryGovernanceActionRequestSchema.extend({
  versionId: z.string().trim().regex(/^\d+$/, "Version number must be an integer.")
});
export type MemoryRestoreVersionRequest = z.infer<typeof MemoryRestoreVersionRequestSchema>;

export const MemoryGovernanceResponseSchema = z.object({
  ok: z.boolean(),
  action: MemoryGovernanceActionSchema,
  memoryId: z.string(),
  message: z.string(),
  upstreamStatus: z.number().int().nullable(),
  sourceStatus: SourceStatusSchema
});
export type MemoryGovernanceResponse = z.infer<typeof MemoryGovernanceResponseSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const ServiceHealthResponseSchema = z.object({
  liveness: z.object({
    status: z.literal("ok"),
    checkedAt: z.string()
  }),
  readiness: z.object({
    status: z.enum(["ready", "degraded"]),
    checkedAt: z.string(),
    summary: z.string()
  }),
  service: z.object({
    name: z.string(),
    summary: z.string()
  }),
  dependencies: z.array(SourceStatusSchema)
});
export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponseSchema>;

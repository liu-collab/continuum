import { z } from "zod";

export const MemoryTypeSchema = z.enum(["fact_preference", "task_state", "episodic"]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const ScopeSchema = z.enum(["session", "task", "user", "workspace"]);
export type Scope = z.infer<typeof ScopeSchema>;

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
  detail: z.string().nullable().default(null)
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const MemoryCatalogFiltersSchema = z.object({
  workspaceId: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  taskId: z.string().trim().optional(),
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
  userId: z.string().nullable(),
  taskId: z.string().nullable(),
  sessionId: z.string().nullable(),
  memoryType: MemoryTypeSchema,
  memoryTypeLabel: z.string(),
  scope: ScopeSchema,
  scopeLabel: z.string(),
  status: MemoryStatusSchema,
  statusLabel: z.string(),
  statusExplanation: z.string(),
  summary: z.string(),
  importance: z.number().nullable(),
  confidence: z.number().nullable(),
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
  createdAt: z.string().nullable()
});
export type MemoryCatalogDetail = z.infer<typeof MemoryCatalogDetailSchema>;

export const MemoryCatalogResponseSchema = z.object({
  items: z.array(MemoryCatalogItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  appliedFilters: MemoryCatalogFiltersSchema,
  sourceStatus: SourceStatusSchema
});
export type MemoryCatalogResponse = z.infer<typeof MemoryCatalogResponseSchema>;

export const RunTraceFiltersSchema = z.object({
  turnId: z.string().trim().optional(),
  sessionId: z.string().trim().optional(),
  threadId: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
  taskId: z.string().trim().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20)
});
export type RunTraceFilters = z.infer<typeof RunTraceFiltersSchema>;

export const RunTraceListItemSchema = z.object({
  turnId: z.string(),
  phase: z.string().nullable(),
  createdAt: z.string().nullable(),
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
  userId: z.string().nullable(),
  taskId: z.string().nullable(),
  sessionId: z.string().nullable(),
  threadId: z.string().nullable(),
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
  requestedTypes: z.array(MemoryTypeSchema),
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
  requestedTypes: z.array(MemoryTypeSchema),
  queryScope: z.string().nullable(),
  candidateCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().nonnegative(),
  resultState: z.string(),
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
  resultState: z.string(),
  dropReasons: z.array(z.string()),
  tokenEstimate: z.number().nullable(),
  droppedRecordIds: z.array(z.string()),
  latencyMs: z.number().nullable(),
  createdAt: z.string().nullable()
});
export type InjectionRun = z.infer<typeof InjectionRunSchema>;

export const WriteBackRunSchema = z.object({
  traceId: z.string(),
  resultState: z.string(),
  candidateCount: z.number().int().nonnegative(),
  submittedCount: z.number().int().nonnegative(),
  filteredCount: z.number().int().nonnegative(),
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
  writeBackRuns: z.array(WriteBackRunSchema),
  dependencyStatus: z.array(RuntimeDependencySchema),
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
  trends: z.array(DashboardTrendSchema),
  sourceStatus: z.array(SourceStatusSchema)
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

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

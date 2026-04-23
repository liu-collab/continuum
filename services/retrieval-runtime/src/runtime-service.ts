import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { AppConfig } from "./config.js";
import type { DependencyGuard } from "./dependency/dependency-guard.js";
import { buildMemoryPacket } from "./injection/packet-builder.js";
import type {
  MemoryOrchestrator,
  RecallEffectivenessInputMemory,
  RecallInjectionPlanner,
  WritebackPlanner,
} from "./memory-orchestrator/index.js";
import type { RuntimeRepository } from "./observability/runtime-repository.js";
import { nowIso } from "./shared/utils.js";
import { matchesHistoryReference } from "./shared/utils.js";
import type {
  CandidateMemory,
  DependencyStatus,
  DependencyStatusSnapshot,
  FinalizeIdempotencyRecord,
  FinalizeTurnInput,
  FinalizeTurnResponse,
  MaintenanceRunSummary,
  MemoryPacket,
  MemoryRelationSnapshot,
  MemoryMode,
  MemoryType,
  ObserveRunsFilters,
  ProactiveRecommendation,
  PrepareContextResponse,
  RetrievalQuery,
  SessionStartResponse,
  ScopeType,
  TriggerDecision,
  TriggerContext,
} from "./shared/types.js";
import type { EmbeddingsClient } from "./query/embeddings-client.js";
import type { QueryEngine } from "./query/query-engine.js";
import type { TriggerEngine } from "./trigger/trigger-engine.js";
import type { WritebackEngine } from "./writeback/writeback-engine.js";
import type { InjectionEngine } from "./injection/injection-engine.js";
import type { FinalizeIdempotencyCache } from "./writeback/finalize-idempotency-cache.js";
import type { WritebackMaintenanceWorker } from "./writeback/maintenance-worker.js";
import type { StorageWritebackClient } from "./writeback/storage-client.js";

const MEMORY_SEARCH_PROMPT_VERSION = "memory-recall-search-v1";
const MEMORY_INTENT_PROMPT_VERSION = "memory-intent-plan-v1";
const MEMORY_INJECTION_PROMPT_VERSION = "memory-recall-injection-v1";
const MEMORY_EFFECTIVENESS_PROMPT_VERSION = "memory-recall-effectiveness-v1";
const MEMORY_RELATION_PROMPT_VERSION = "memory-relation-plan-v1";
const MEMORY_RECOMMENDATION_PROMPT_VERSION = "memory-recommendation-plan-v1";
const MEMORY_PLAN_SCHEMA_VERSION = "memory-plan-schema-v1";
const MEMORY_SEARCH_RULES_VERSION = "runtime-trigger-rules-v1";
const INJECTION_EVALUATION_TTL_MS = 30 * 60 * 1000;

type RecentInjectionRuntimeConfig = Pick<
  AppConfig,
  | "INJECTION_DEDUP_ENABLED"
  | "INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE"
  | "INJECTION_HARD_WINDOW_TURNS_TASK_STATE"
  | "INJECTION_HARD_WINDOW_TURNS_EPISODIC"
  | "INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE"
  | "INJECTION_HARD_WINDOW_MS_TASK_STATE"
  | "INJECTION_HARD_WINDOW_MS_EPISODIC"
  | "INJECTION_SOFT_WINDOW_MS_TASK_STATE"
  | "INJECTION_SOFT_WINDOW_MS_EPISODIC"
  | "INJECTION_RECENT_STATE_TTL_MS"
  | "INJECTION_RECENT_STATE_MAX_SESSIONS"
>;

const DEFAULT_RECENT_INJECTION_CONFIG: RecentInjectionRuntimeConfig = {
  INJECTION_DEDUP_ENABLED: true,
  INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 5,
  INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
  INJECTION_HARD_WINDOW_TURNS_EPISODIC: 2,
  INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 30 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_TASK_STATE: 10 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_EPISODIC: 5 * 60 * 1000,
  INJECTION_SOFT_WINDOW_MS_TASK_STATE: 30 * 60 * 1000,
  INJECTION_SOFT_WINDOW_MS_EPISODIC: 15 * 60 * 1000,
  INJECTION_RECENT_STATE_TTL_MS: 60 * 60 * 1000,
  INJECTION_RECENT_STATE_MAX_SESSIONS: 500,
};

type RecentInjectionRecord = {
  record_id: string;
  memory_type: MemoryType;
  record_updated_at?: string;
  injected_at: number;
  turn_index: number;
  trace_id?: string;
  source_phase: TriggerContext["phase"];
};

type RecentInjectionDecision = {
  hardFiltered: CandidateMemory[];
  softMarked: CandidateMemory[];
  remaining: CandidateMemory[];
  replayEscapeReason?: string;
};

function resolveMemoryMode(memoryMode?: MemoryMode): MemoryMode {
  return memoryMode ?? "workspace_plus_global";
}

function isWritebackAccepted(status: FinalizeTurnResponse["submitted_jobs"][number]["status"]): boolean {
  return status === "accepted" || status === "accepted_async" || status === "merged";
}

function buildFinalizeCacheKey(input: Pick<FinalizeTurnInput, "session_id" | "turn_id" | "current_input">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        session_id: input.session_id,
        turn_id: input.turn_id ?? null,
        current_input: input.current_input,
      }),
    )
    .digest("hex");
}

function buildFinalizeIdempotencyRecord(
  key: string,
  response: FinalizeTurnResponse,
  ttlMs: number,
): FinalizeIdempotencyRecord {
  const createdAt = nowIso();
  return {
    idempotency_key: key,
    response,
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + ttlMs).toISOString(),
  };
}

function summarizeText(value: string | undefined, maxLength = 220) {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function summarizeCandidateIds(candidates: CandidateMemory[], selectedIds?: string[]) {
  if (selectedIds && selectedIds.length > 0) {
    return `selected=${selectedIds.join(",")}`;
  }
  return `candidate_count=${candidates.length}`;
}

function dedupeCandidates(candidates: CandidateMemory[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) {
      return false;
    }
    seen.add(candidate.id);
    return true;
  });
}

function mergeTriggerReason(primary: string, secondary?: string) {
  if (!secondary || secondary.trim().length === 0 || secondary === primary) {
    return primary;
  }
  return `${primary}; ${secondary}`;
}

async function resolveTraceId(
  repository: RuntimeRepository,
  input: {
    session_id: string;
    turn_id?: string;
    phase: TriggerContext["phase"] | "after_response";
  },
) {
  if (input.turn_id) {
    return (
      (await repository.findTraceIdByTurn({
        session_id: input.session_id,
        turn_id: input.turn_id,
      })) ?? randomUUID()
    );
  }

  if (input.phase === "session_start") {
    return (
      (await repository.findLatestTraceIdBySession({
        session_id: input.session_id,
      })) ?? randomUUID()
    );
  }

  return randomUUID();
}

export class RetrievalRuntimeService {
  private readonly config: RecentInjectionRuntimeConfig;
  private readonly triggerEngine: TriggerEngine;
  private readonly queryEngine: QueryEngine;
  private readonly embeddingsClient: EmbeddingsClient;
  private readonly injectionEngine: InjectionEngine;
  private readonly writebackEngine: WritebackEngine;
  private readonly repository: RuntimeRepository;
  private readonly dependencyGuard: DependencyGuard;
  private readonly logger: Logger;
  private readonly finalizeIdempotencyCache?: FinalizeIdempotencyCache;
  private readonly embeddingTimeoutMs: number;
  private readonly memoryOrchestrator?: MemoryOrchestrator;
  private readonly maintenanceWorker?: WritebackMaintenanceWorker;
  private readonly storageClient?: StorageWritebackClient;
  private readonly sessionPrepareQueues = new Map<string, Promise<void>>();
  private readonly inflightPrepareContexts = new Map<string, Promise<PrepareContextResponse>>();
  private readonly recentInjectionContexts = new Map<string, {
    memories: RecallEffectivenessInputMemory[];
    created_at: number;
  }>();
  private readonly recentInjections = new Map<string, Map<string, RecentInjectionRecord>>();
  private readonly sessionTurnCounters = new Map<string, number>();
  private readonly relatedMemoryCache = new Map<string, {
    relations: MemoryRelationSnapshot[];
    created_at: number;
  }>();

  constructor(
    config: AppConfig,
    triggerEngine: TriggerEngine,
    queryEngine: QueryEngine,
    embeddingsClient: EmbeddingsClient,
    injectionEngine: InjectionEngine,
    writebackEngine: WritebackEngine,
    repository: RuntimeRepository,
    dependencyGuard: DependencyGuard,
    logger: Logger,
    finalizeIdempotencyCache?: FinalizeIdempotencyCache,
    embeddingTimeoutMs?: number,
    memoryOrchestrator?: MemoryOrchestrator,
    maintenanceWorker?: WritebackMaintenanceWorker,
    storageClient?: StorageWritebackClient,
  );
  constructor(
    triggerEngine: TriggerEngine,
    queryEngine: QueryEngine,
    embeddingsClient: EmbeddingsClient,
    injectionEngine: InjectionEngine,
    writebackEngine: WritebackEngine,
    repository: RuntimeRepository,
    dependencyGuard: DependencyGuard,
    logger: Logger,
    finalizeIdempotencyCache?: FinalizeIdempotencyCache,
    embeddingTimeoutMs?: number,
    memoryOrchestrator?: MemoryOrchestrator,
    maintenanceWorker?: WritebackMaintenanceWorker,
    storageClient?: StorageWritebackClient,
  );
  constructor(
    configOrTriggerEngine: AppConfig | TriggerEngine,
    triggerEngineOrQueryEngine: TriggerEngine | QueryEngine,
    queryEngineOrEmbeddingsClient: QueryEngine | EmbeddingsClient,
    embeddingsClientOrInjectionEngine: EmbeddingsClient | InjectionEngine,
    injectionEngineOrWritebackEngine: InjectionEngine | WritebackEngine,
    writebackEngineOrRepository: WritebackEngine | RuntimeRepository,
    repositoryOrDependencyGuard: RuntimeRepository | DependencyGuard,
    dependencyGuardOrLogger: DependencyGuard | Logger,
    loggerOrFinalizeIdempotencyCache: Logger | FinalizeIdempotencyCache | undefined,
    finalizeIdempotencyCacheOrEmbeddingTimeoutMs?: FinalizeIdempotencyCache | number,
    embeddingTimeoutMsOrMemoryOrchestrator?: number | MemoryOrchestrator,
    memoryOrchestratorOrMaintenanceWorker?: MemoryOrchestrator | WritebackMaintenanceWorker,
    maintenanceWorkerOrStorageClient?: WritebackMaintenanceWorker | StorageWritebackClient,
    storageClient?: StorageWritebackClient,
  ) {
    if (isAppConfig(configOrTriggerEngine)) {
      this.config = pickRecentInjectionConfig(configOrTriggerEngine);
      this.triggerEngine = triggerEngineOrQueryEngine as TriggerEngine;
      this.queryEngine = queryEngineOrEmbeddingsClient as QueryEngine;
      this.embeddingsClient = embeddingsClientOrInjectionEngine as EmbeddingsClient;
      this.injectionEngine = injectionEngineOrWritebackEngine as InjectionEngine;
      this.writebackEngine = writebackEngineOrRepository as WritebackEngine;
      this.repository = repositoryOrDependencyGuard as RuntimeRepository;
      this.dependencyGuard = dependencyGuardOrLogger as DependencyGuard;
      this.logger = loggerOrFinalizeIdempotencyCache as Logger;
      this.finalizeIdempotencyCache = finalizeIdempotencyCacheOrEmbeddingTimeoutMs as
        | FinalizeIdempotencyCache
        | undefined;
      this.embeddingTimeoutMs =
        typeof embeddingTimeoutMsOrMemoryOrchestrator === "number" ? embeddingTimeoutMsOrMemoryOrchestrator : 800;
      this.memoryOrchestrator =
        typeof embeddingTimeoutMsOrMemoryOrchestrator === "number"
          ? memoryOrchestratorOrMaintenanceWorker as MemoryOrchestrator | undefined
          : embeddingTimeoutMsOrMemoryOrchestrator;
      this.maintenanceWorker =
        typeof embeddingTimeoutMsOrMemoryOrchestrator === "number"
          ? maintenanceWorkerOrStorageClient as WritebackMaintenanceWorker | undefined
          : memoryOrchestratorOrMaintenanceWorker as WritebackMaintenanceWorker | undefined;
      this.storageClient =
        typeof embeddingTimeoutMsOrMemoryOrchestrator === "number"
          ? storageClient
          : maintenanceWorkerOrStorageClient as StorageWritebackClient | undefined;
      return;
    }

    this.config = DEFAULT_RECENT_INJECTION_CONFIG;
    this.triggerEngine = configOrTriggerEngine;
    this.queryEngine = triggerEngineOrQueryEngine as QueryEngine;
    this.embeddingsClient = queryEngineOrEmbeddingsClient as EmbeddingsClient;
    this.injectionEngine = embeddingsClientOrInjectionEngine as InjectionEngine;
    this.writebackEngine = injectionEngineOrWritebackEngine as WritebackEngine;
    this.repository = writebackEngineOrRepository as RuntimeRepository;
    this.dependencyGuard = repositoryOrDependencyGuard as DependencyGuard;
    this.logger = dependencyGuardOrLogger as Logger;
    this.finalizeIdempotencyCache = loggerOrFinalizeIdempotencyCache as FinalizeIdempotencyCache | undefined;
    this.embeddingTimeoutMs =
      typeof finalizeIdempotencyCacheOrEmbeddingTimeoutMs === "number"
        ? finalizeIdempotencyCacheOrEmbeddingTimeoutMs
        : 800;
    this.memoryOrchestrator =
      typeof finalizeIdempotencyCacheOrEmbeddingTimeoutMs === "number"
        ? embeddingTimeoutMsOrMemoryOrchestrator as MemoryOrchestrator | undefined
        : finalizeIdempotencyCacheOrEmbeddingTimeoutMs as MemoryOrchestrator | undefined;
    this.maintenanceWorker =
      typeof finalizeIdempotencyCacheOrEmbeddingTimeoutMs === "number"
        ? memoryOrchestratorOrMaintenanceWorker as WritebackMaintenanceWorker | undefined
        : embeddingTimeoutMsOrMemoryOrchestrator as WritebackMaintenanceWorker | undefined;
    this.storageClient =
      typeof finalizeIdempotencyCacheOrEmbeddingTimeoutMs === "number"
        ? maintenanceWorkerOrStorageClient as StorageWritebackClient | undefined
        : memoryOrchestratorOrMaintenanceWorker as StorageWritebackClient | undefined;
  }

  async runMaintenance(input?: { workspace_id?: string; force?: boolean }): Promise<MaintenanceRunSummary> {
    if (!this.maintenanceWorker) {
      const fallback: MaintenanceRunSummary = {
        workspace_ids_scanned: [],
        seeds_inspected: 0,
        related_fetched: 0,
        actions_proposed: 0,
        actions_applied: 0,
        actions_skipped: 0,
        conflicts_resolved: 0,
        degraded: true,
        degradation_reason: "maintenance_worker_disabled",
        next_checkpoint: nowIso(),
      };
      return fallback;
    }
    return this.maintenanceWorker.runOnce({
      workspaceId: input?.workspace_id,
      forced: input?.force ?? false,
    });
  }

  async prepareContext(context: TriggerContext): Promise<PrepareContextResponse> {
    const normalizedContext = {
      ...context,
      memory_mode: resolveMemoryMode(context.memory_mode),
    };
    const idempotencyKey = normalizedContext.turn_id
      ? `${normalizedContext.session_id}:${normalizedContext.turn_id}`
      : undefined;
    const existing = idempotencyKey
      ? this.inflightPrepareContexts.get(idempotencyKey)
      : undefined;

    if (existing) {
      return existing;
    }

    const execution = this.runSerializedPrepare(
      normalizedContext.session_id,
      () => this.prepareContextInternal(normalizedContext),
    );

    if (!idempotencyKey) {
      return execution;
    }

    this.inflightPrepareContexts.set(idempotencyKey, execution);
    execution.finally(() => {
      if (this.inflightPrepareContexts.get(idempotencyKey) === execution) {
        this.inflightPrepareContexts.delete(idempotencyKey);
      }
    });

    return execution;
  }

  private async prepareContextInternal(
    normalizedContext: TriggerContext & { memory_mode: MemoryMode },
  ): Promise<PrepareContextResponse> {
    this.cleanupExpiredRecentInjections();
    const turnIndex = this.nextTurnIndex(normalizedContext.session_id, normalizedContext.turn_id);
    const traceId = await resolveTraceId(this.repository, {
      session_id: normalizedContext.session_id,
      turn_id: normalizedContext.turn_id,
      phase: normalizedContext.phase,
    });
    const turnStartedAt = Date.now();
    await this.repository.recordTurn({
      trace_id: traceId,
      host: normalizedContext.host,
      workspace_id: normalizedContext.workspace_id,
      user_id: normalizedContext.user_id,
      session_id: normalizedContext.session_id,
      phase: normalizedContext.phase,
      task_id: normalizedContext.task_id,
      thread_id: normalizedContext.thread_id,
      turn_id: normalizedContext.turn_id,
      current_input: normalizedContext.current_input,
      created_at: nowIso(),
    });

    const triggerStartedAt = Date.now();
    const decision = await this.triggerEngine.decide(normalizedContext);
    if (normalizedContext.phase === "before_response") {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: normalizedContext.phase,
        plan_kind: "memory_search_plan",
        input_summary: summarizeText(
          `input=${normalizedContext.current_input}; scopes=${(decision.requested_scopes ?? []).join(",")}; types=${(
            decision.requested_memory_types ?? []
          ).join(",")}`,
        ),
        output_summary: summarizeText(
          `hit=${decision.hit}; reason=${decision.llm_decision_reason ?? decision.trigger_reason}; query_hint=${decision.query_hint ?? ""}; candidate_limit=${decision.candidate_limit ?? ""}`,
        ),
        prompt_version: decision.search_plan_attempted ? MEMORY_SEARCH_PROMPT_VERSION : MEMORY_SEARCH_RULES_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: Boolean(decision.search_plan_degraded),
        degradation_reason: decision.search_plan_degradation_reason,
        result_state: decision.search_plan_degraded ? "fallback" : decision.hit ? "planned" : "skipped",
        duration_ms: Date.now() - triggerStartedAt,
        created_at: nowIso(),
      });
    }
    await this.repository.recordTriggerRun({
      trace_id: traceId,
      phase: normalizedContext.phase,
      trigger_hit: decision.hit,
      trigger_type: decision.trigger_type,
      trigger_reason: decision.trigger_reason,
      requested_memory_types: decision.requested_memory_types,
      memory_mode: decision.memory_mode,
      requested_scopes: decision.requested_scopes,
      scope_reason: decision.scope_reason,
      importance_threshold: decision.importance_threshold,
      cooldown_applied: decision.cooldown_applied,
      semantic_score: decision.semantic_score,
      degraded: decision.degraded,
      degradation_reason: decision.degradation_reason,
      duration_ms: Date.now() - triggerStartedAt,
      created_at: nowIso(),
    });

    if (normalizedContext.phase === "before_response" && decision.intent_plan_attempted) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: normalizedContext.phase,
        plan_kind: "memory_intent_plan",
        input_summary: summarizeText(`input=${normalizedContext.current_input}`),
        output_summary: summarizeText(
          `needs_memory=${decision.intent_needs_memory ?? decision.hit}; reason=${decision.intent_reason ?? ""}; confidence=${decision.intent_confidence ?? ""}; scopes=${(decision.intent_scopes ?? []).join(",")}; types=${(decision.intent_memory_types ?? []).join(",")}`,
        ),
        prompt_version: MEMORY_INTENT_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: Boolean(decision.intent_plan_degraded),
        degradation_reason: decision.intent_plan_degradation_reason,
        result_state: decision.intent_needs_memory === false ? "skipped" : decision.intent_plan_degraded ? "fallback" : "planned",
        duration_ms: Date.now() - triggerStartedAt,
        created_at: nowIso(),
      });
    }

    if (!decision.hit) {
      await this.repository.recordRecallRun({
        trace_id: traceId,
        phase: normalizedContext.phase,
        trigger_hit: false,
        trigger_type: decision.trigger_type,
        trigger_reason: decision.trigger_reason,
        memory_mode: decision.memory_mode,
        requested_scopes: decision.requested_scopes,
        matched_scopes: [],
        scope_hit_counts: {},
        scope_reason: decision.scope_reason,
        query_scope: "not_triggered",
        requested_memory_types: [],
        candidate_count: 0,
        selected_count: 0,
        result_state: decision.degraded ? "dependency_unavailable" : "not_triggered",
        degraded: Boolean(decision.degraded),
        degradation_reason: decision.degradation_reason,
        duration_ms: Date.now() - turnStartedAt,
        created_at: nowIso(),
      });

      await this.repository.recordInjectionRun({
        trace_id: traceId,
        phase: normalizedContext.phase,
        injected: false,
        injected_count: 0,
        token_estimate: 0,
        memory_mode: decision.memory_mode,
        requested_scopes: decision.requested_scopes,
        selected_scopes: [],
        trimmed_record_ids: [],
        trim_reasons: [],
        result_state: "not_triggered",
        duration_ms: 0,
        created_at: nowIso(),
      });

      return {
        trace_id: traceId,
        trigger: false,
        trigger_reason: decision.trigger_reason,
        memory_packet: null,
        injection_block: null,
        proactive_recommendations: [],
        degraded: Boolean(decision.degraded),
        dependency_status: await this.dependencyGuard.snapshot(),
        budget_used: 0,
        memory_packet_ids: [],
      };
    }

    const recallStartedAt = Date.now();
    const queryResult = await this.queryEngine.query(normalizedContext, decision);
    let selectedCandidates = queryResult.candidates;
    let plannedCandidates = queryResult.candidates;
    let finalTriggerReason = mergeTriggerReason(decision.trigger_reason, decision.intent_reason);
    let forceNoInjection = false;
    let degraded = queryResult.degraded;
    let degradationReason = queryResult.degradation_reason;
    let recentlyFilteredCandidates: CandidateMemory[] = [];
    let recentlySoftMarkedCandidates: CandidateMemory[] = [];
    let replayEscapeReason: string | undefined;
    const proactiveRecommendations = normalizedContext.phase === "session_start"
      ? await this.collectProactiveRecommendations(normalizedContext, traceId)
      : [];

    const relationCandidates = await this.expandCandidatesWithRelations(
      normalizedContext,
      selectedCandidates,
      traceId,
    );
    if (relationCandidates.length > 0) {
      selectedCandidates = dedupeCandidates([...selectedCandidates, ...relationCandidates]);
      plannedCandidates = selectedCandidates;
      finalTriggerReason = mergeTriggerReason(finalTriggerReason, "包含关联记忆补充");
    }

    const recentInjectionDecision = this.applyRecentInjectionPolicy({
      context: normalizedContext,
      traceId,
      turnIndex,
      candidates: plannedCandidates,
    });
    recentlyFilteredCandidates = recentInjectionDecision.hardFiltered;
    recentlySoftMarkedCandidates = recentInjectionDecision.softMarked;
    replayEscapeReason = recentInjectionDecision.replayEscapeReason;
    plannedCandidates = recentInjectionDecision.remaining;
    selectedCandidates = plannedCandidates;

    if (
      normalizedContext.phase === "before_response"
      && this.memoryOrchestrator?.recall?.injection
      && this.queryResultCanBePlanned(plannedCandidates)
    ) {
      const recallInjectionPlanner = this.memoryOrchestrator.recall.injection;
      const injectionPlanStartedAt = Date.now();
      const planResult = await this.dependencyGuard.run(
        "memory_llm",
        this.embeddingTimeoutMs,
        () =>
          recallInjectionPlanner.plan({
            context: normalizedContext,
            memory_mode: decision.memory_mode,
            requested_scopes: decision.requested_scopes,
            requested_memory_types: decision.requested_memory_types,
            candidates: plannedCandidates,
            search_reason: decision.llm_decision_reason,
            semantic_score: decision.semantic_score,
            semantic_threshold: undefined,
            allow_recent_replay: Boolean(replayEscapeReason),
          }),
      );

      if (planResult.ok && planResult.value) {
        await this.repository.recordMemoryPlanRun({
          trace_id: traceId,
          phase: normalizedContext.phase,
          plan_kind: "memory_injection_plan",
          input_summary: summarizeText(
            `input=${normalizedContext.current_input}; ${summarizeCandidateIds(plannedCandidates)}`,
          ),
          output_summary: summarizeText(
            `should_inject=${planResult.value.should_inject}; reason=${planResult.value.reason}; ${summarizeCandidateIds(
              plannedCandidates,
              planResult.value.selected_record_ids,
            )}; summary=${planResult.value.memory_summary ?? ""}`,
          ),
          prompt_version: MEMORY_INJECTION_PROMPT_VERSION,
          schema_version: MEMORY_PLAN_SCHEMA_VERSION,
          degraded: false,
          result_state: planResult.value.should_inject ? "planned" : "skipped",
          duration_ms: Date.now() - injectionPlanStartedAt,
          created_at: nowIso(),
        });

        finalTriggerReason = mergeTriggerReason(finalTriggerReason, planResult.value.reason);
        if (!planResult.value.should_inject) {
          selectedCandidates = [];
          forceNoInjection = true;
        } else {
          selectedCandidates = reorderSelectedCandidates(
            plannedCandidates,
            planResult.value.selected_record_ids ?? [],
          );
        }

        const plannedMemorySummary = planResult.value.memory_summary?.trim() ?? "";
        if (planResult.value.should_inject && plannedMemorySummary.length > 0) {
          const packet = buildMemoryPacket(queryResult.query, decision, selectedCandidates);
          packet.packet_summary = plannedMemorySummary;
          return this.finalizePreparedContextResponse({
            traceId,
            sessionId: normalizedContext.session_id,
            turnId: normalizedContext.turn_id,
            decision,
            triggerReason: finalTriggerReason,
            queryResult: {
              ...queryResult,
              candidates: selectedCandidates,
              degraded,
              degradation_reason: degradationReason,
            },
            packet,
            recallStartedAt,
            injectionStartedAt: Date.now(),
            dependencyStatus: await this.dependencyGuard.snapshot(),
            proactiveRecommendations,
            turnIndex,
            recentlyFilteredCandidates,
            recentlySoftMarkedCandidates,
            replayEscapeReason,
          });
        }
      } else {
        await this.repository.recordMemoryPlanRun({
          trace_id: traceId,
          phase: normalizedContext.phase,
          plan_kind: "memory_injection_plan",
          input_summary: summarizeText(
            `input=${normalizedContext.current_input}; ${summarizeCandidateIds(plannedCandidates)}`,
          ),
          output_summary: summarizeText(`fallback=${planResult.error?.code ?? "memory_llm_unavailable"}`),
          prompt_version: MEMORY_INJECTION_PROMPT_VERSION,
          schema_version: MEMORY_PLAN_SCHEMA_VERSION,
          degraded: true,
          degradation_reason: planResult.error?.code ?? "memory_llm_unavailable",
          result_state: "fallback",
          duration_ms: Date.now() - injectionPlanStartedAt,
          created_at: nowIso(),
        });
        degraded = true;
        degradationReason = degradationReason ?? planResult.error?.code ?? "memory_llm_unavailable";
      }
    }

    const packet = buildMemoryPacket(queryResult.query, decision, selectedCandidates);
    if (forceNoInjection) {
      packet.packet_summary = finalTriggerReason;
    }
    const scopeHitCounts = queryResult.candidates.reduce<Partial<Record<typeof packet.selected_scopes[number], number>>>((acc, candidate) => {
      acc[candidate.scope] = (acc[candidate.scope] ?? 0) + 1;
      return acc;
    }, {});

    await this.repository.recordRecallRun({
      trace_id: traceId,
      phase: normalizedContext.phase,
      trigger_hit: true,
      trigger_type: decision.trigger_type,
      trigger_reason: finalTriggerReason,
      memory_mode: decision.memory_mode,
      requested_scopes: decision.requested_scopes,
      matched_scopes: packet.selected_scopes,
      scope_hit_counts: scopeHitCounts,
      scope_reason: decision.scope_reason,
      query_scope: packet.query_scope,
      requested_memory_types: decision.requested_memory_types,
      candidate_count: queryResult.candidates.length,
      selected_count: packet.records.length,
      recently_filtered_record_ids: recentlyFilteredCandidates.map((candidate) => candidate.id),
      recently_filtered_reasons: recentlyFilteredCandidates.map((candidate) => `hard_window_active:${candidate.memory_type}`),
      recently_soft_marked_record_ids: recentlySoftMarkedCandidates.map((candidate) => candidate.id),
      replay_escape_reason: replayEscapeReason,
      result_state:
        degraded && packet.records.length === 0
          ? "dependency_unavailable"
          : packet.records.length === 0
            ? "empty"
            : "matched",
      degraded,
      degradation_reason: degradationReason,
      duration_ms: Date.now() - recallStartedAt,
      created_at: nowIso(),
    });

    const injectionStartedAt = Date.now();
    const injectionBlock = this.injectionEngine.build(packet);

    await this.repository.recordInjectionRun({
      trace_id: traceId,
      phase: normalizedContext.phase,
      injected: Boolean(injectionBlock),
      injected_count: injectionBlock?.memory_records.length ?? 0,
      token_estimate: injectionBlock?.token_estimate ?? 0,
      memory_mode: decision.memory_mode,
      requested_scopes: packet.requested_scopes,
      selected_scopes: injectionBlock?.selected_scopes ?? [],
      trimmed_record_ids: injectionBlock?.trimmed_record_ids ?? [],
      trim_reasons: injectionBlock?.trim_reasons ?? [],
      recently_filtered_record_ids: recentlyFilteredCandidates.map((candidate) => candidate.id),
      recently_filtered_reasons: recentlyFilteredCandidates.map((candidate) => `hard_window_active:${candidate.memory_type}`),
      recently_soft_marked_record_ids: recentlySoftMarkedCandidates.map((candidate) => candidate.id),
      replay_escape_reason: replayEscapeReason,
      result_state:
        packet.records.length === 0
          ? "no_records"
          : injectionBlock && injectionBlock.memory_records.length > 0
            ? "injected"
            : "trimmed_to_zero",
      duration_ms: Date.now() - injectionStartedAt,
      created_at: nowIso(),
    });

    if (injectionBlock?.memory_records.length) {
      this.storeInjectionContext(normalizedContext, injectionBlock.memory_records);
      this.rememberRecentInjection(
        normalizedContext.session_id,
        normalizedContext.turn_id,
        traceId,
        turnIndex,
        normalizedContext.phase,
        selectedCandidates.filter((candidate) =>
          injectionBlock.memory_records.some((record) => record.id === candidate.id),
        ),
      );
    }

    return {
      trace_id: traceId,
      trigger: !forceNoInjection,
      trigger_reason: finalTriggerReason,
      memory_packet: forceNoInjection ? null : packet,
      injection_block: injectionBlock,
      proactive_recommendations: proactiveRecommendations,
      degraded,
      dependency_status: await this.dependencyGuard.snapshot(),
      budget_used: injectionBlock?.token_estimate ?? 0,
      memory_packet_ids: forceNoInjection ? [] : [packet.packet_id],
    };
  }

  async sessionStartContext(context: TriggerContext): Promise<SessionStartResponse> {
    const prepared = await this.prepareContext({ ...context, phase: "session_start" });
    const additionalContext = prepared.injection_block
      ? `${prepared.injection_block.injection_reason}\n${prepared.injection_block.memory_summary}`
      : "";
    const activeTaskSummary =
      prepared.injection_block?.memory_records.find((record) => record.memory_type === "task_state")?.summary ?? null;

    return {
      trace_id: prepared.trace_id,
      additional_context: additionalContext,
      active_task_summary: activeTaskSummary,
      injection_block: prepared.injection_block,
      proactive_recommendations: prepared.proactive_recommendations,
      memory_mode: context.memory_mode ?? "workspace_plus_global",
      dependency_status: prepared.dependency_status,
      degraded: prepared.degraded,
    };
  }

  async finalizeTurn(input: FinalizeTurnInput): Promise<FinalizeTurnResponse> {
    const normalizedInput = {
      ...input,
      memory_mode: resolveMemoryMode(input.memory_mode),
    };
    const finalizeCacheKey = buildFinalizeCacheKey(normalizedInput);
    const cached = await this.finalizeIdempotencyCache?.get(finalizeCacheKey);
    if (cached) {
      return cached;
    }
    const persisted = await this.repository.findFinalizeIdempotencyRecord(finalizeCacheKey);
    if (persisted) {
      await this.finalizeIdempotencyCache?.set(finalizeCacheKey, persisted.response);
      return persisted.response;
    }
    const traceId = await resolveTraceId(this.repository, {
      session_id: normalizedInput.session_id,
      turn_id: normalizedInput.turn_id,
      phase: "after_response",
    });
    const startedAt = Date.now();

    await this.repository.recordTurn({
      trace_id: traceId,
      host: normalizedInput.host,
      workspace_id: normalizedInput.workspace_id,
      user_id: normalizedInput.user_id,
      session_id: normalizedInput.session_id,
      phase: "after_response",
      task_id: normalizedInput.task_id,
      thread_id: normalizedInput.thread_id,
      turn_id: normalizedInput.turn_id,
      current_input: normalizedInput.current_input,
      assistant_output: normalizedInput.assistant_output,
      created_at: nowIso(),
    });

    const extraction = await this.writebackEngine.submit(normalizedInput);
    if (extraction.plan_observation) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: "after_response",
        plan_kind: "memory_writeback_plan",
        input_summary: extraction.plan_observation.input_summary,
        output_summary: extraction.plan_observation.output_summary,
        prompt_version: extraction.plan_observation.prompt_version,
        schema_version: extraction.plan_observation.schema_version,
        degraded: extraction.plan_observation.degraded,
        degradation_reason: extraction.plan_observation.degradation_reason,
        result_state: extraction.plan_observation.result_state,
        duration_ms: extraction.plan_observation.duration_ms,
        created_at: nowIso(),
      });
    }

    let submittedJobs = extraction.candidates.map((candidate) => ({
      candidate_summary: candidate.summary,
      status: "accepted_async",
    })) as FinalizeTurnResponse["submitted_jobs"];
    let degraded = false;
    let degradationReason: string | undefined;

    if (extraction.candidates.length > 0) {
      const now = nowIso();
      const outboxRows = await this.repository.enqueueWritebackOutbox(
        extraction.candidates.map((candidate) => ({
          trace_id: traceId,
          session_id: normalizedInput.session_id,
          turn_id: normalizedInput.turn_id,
          candidate,
          idempotency_key: candidate.idempotency_key,
          next_retry_at: now,
        })),
      );

      const writebackResult = await this.writebackEngine.submitCandidates(extraction.candidates);

      if (writebackResult.ok) {
        submittedJobs = writebackResult.submitted_jobs;
        await this.repository.markWritebackOutboxSubmitted(
          outboxRows.map((row) => row.id),
          now,
        );
      } else {
        degraded = true;
        degradationReason = writebackResult.degradation_reason;
        submittedJobs = writebackResult.submitted_jobs;
      }
    }

    await this.repository.recordWritebackSubmission({
      trace_id: traceId,
      phase: "after_response",
      candidate_count: extraction.candidates.length,
      submitted_count: submittedJobs.filter((job) => job.status !== "dependency_unavailable" && job.status !== "rejected").length,
      memory_mode: normalizedInput.memory_mode,
      final_scopes: [...new Set(extraction.candidates.map((candidate) => candidate.scope))],
      filtered_count: extraction.filtered_count,
      filtered_reasons: extraction.filtered_reasons,
      scope_reasons: extraction.scope_reasons,
      result_state:
        extraction.candidates.length === 0
          ? "no_candidates"
          : degraded
            ? "failed"
            : "submitted",
      degraded,
      degradation_reason: degradationReason,
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    const response = {
      trace_id: traceId,
      write_back_candidates: extraction.candidates,
      submitted_jobs: submittedJobs,
      memory_mode: normalizedInput.memory_mode,
      candidate_count: extraction.candidates.length,
      filtered_count: extraction.filtered_count,
      filtered_reasons: extraction.filtered_reasons,
      writeback_submitted: submittedJobs.some((job) => isWritebackAccepted(job.status)),
      degraded,
      dependency_status: await this.dependencyGuard.snapshot(),
    };
    await this.finalizeIdempotencyCache?.set(finalizeCacheKey, response);
    await this.repository.upsertFinalizeIdempotencyRecord(
      buildFinalizeIdempotencyRecord(
        finalizeCacheKey,
        response,
        this.finalizeIdempotencyCache?.ttlMs() ?? 5 * 60 * 1000,
      ),
    );
    await this.evaluateRecallEffectivenessIfNeeded(normalizedInput, traceId);
    return response;
  }

  async getLiveness(): Promise<{ status: "alive" }> {
    return { status: "alive" };
  }

  async getReadiness(): Promise<{ status: "ready" }> {
    return { status: "ready" };
  }

  async getDependencies(): Promise<DependencyStatusSnapshot> {
    return this.dependencyGuard.snapshot();
  }

  async checkEmbeddings(): Promise<DependencyStatus> {
    const controller = new AbortController();
    let rejectTimeout: ((error: Error) => void) | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeoutHandle = setTimeout(() => {
      if (controller.signal.aborted) {
        return;
      }
      controller.abort("timeout");
      rejectTimeout?.(new Error("embeddings timed out"));
    }, this.embeddingTimeoutMs);

    try {
      await Promise.race([
        this.embeddingsClient.embedText("embedding health check", controller.signal),
        timeoutPromise,
      ]);
      const status: DependencyStatus = {
        name: "embeddings",
        status: "healthy",
        detail: "embedding request completed",
        last_checked_at: nowIso(),
      };
      await this.repository.updateDependencyStatus(status);
      return status;
    } catch (error) {
      const status: DependencyStatus = {
        name: "embeddings",
        status: controller.signal.aborted ? "degraded" : "unavailable",
        detail:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : controller.signal.aborted
              ? "embeddings timed out"
              : "embeddings unavailable",
        last_checked_at: nowIso(),
      };
      await this.repository.updateDependencyStatus(status);
      this.logger.warn({ dependency: "embeddings", err: error }, "embedding health check failed");
      return status;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async checkMemoryLlm(): Promise<DependencyStatus> {
    const healthCheck =
      this.memoryOrchestrator?.recall?.search?.healthCheck
      ?? this.memoryOrchestrator?.recall?.injection?.healthCheck
      ?? this.memoryOrchestrator?.writeback?.healthCheck;
    if (!healthCheck) {
      const status: DependencyStatus = {
        name: "memory_llm",
        status: "unavailable",
        detail: "memory llm is not configured",
        last_checked_at: nowIso(),
      };
      await this.repository.updateDependencyStatus(status);
      return status;
    }

    try {
      await healthCheck();
      const status: DependencyStatus = {
        name: "memory_llm",
        status: "healthy",
        detail: "memory llm request completed",
        last_checked_at: nowIso(),
      };
      await this.repository.updateDependencyStatus(status);
      return status;
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "memory llm unavailable";
      const status: DependencyStatus = {
        name: "memory_llm",
        status: detail.includes("timeout") ? "degraded" : "unavailable",
        detail,
        last_checked_at: nowIso(),
      };
      await this.repository.updateDependencyStatus(status);
      this.logger.warn({ dependency: "memory_llm", err: error }, "memory llm health check failed");
      return status;
    }
  }

  async getRuns(filters?: ObserveRunsFilters) {
    return this.repository.getRuns(filters);
  }

  async getMetrics() {
    return this.repository.getMetrics();
  }

  private queryResultCanBePlanned(candidates: CandidateMemory[]) {
    return Array.isArray(candidates) && candidates.length > 0;
  }

  private runSerializedPrepare<T>(
    sessionId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.sessionPrepareQueues.get(sessionId) ?? Promise.resolve();
    const scheduled = previous.catch(() => undefined).then(task);
    const settled = scheduled.then(
      () => undefined,
      () => undefined,
    );

    this.sessionPrepareQueues.set(sessionId, settled);
    settled.finally(() => {
      if (this.sessionPrepareQueues.get(sessionId) === settled) {
        this.sessionPrepareQueues.delete(sessionId);
      }
    });

    return scheduled;
  }

  private async finalizePreparedContextResponse(input: {
    traceId: string;
    sessionId: string;
    turnId?: string;
    turnIndex?: number;
    decision: TriggerDecision;
    triggerReason: string;
    queryResult: {
      query: RetrievalQuery;
      candidates: CandidateMemory[];
      degraded: boolean;
      degradation_reason?: string;
    };
    packet: MemoryPacket;
    recallStartedAt: number;
    injectionStartedAt: number;
    dependencyStatus: DependencyStatusSnapshot;
    proactiveRecommendations: ProactiveRecommendation[];
    recentlyFilteredCandidates?: CandidateMemory[];
    recentlySoftMarkedCandidates?: CandidateMemory[];
    replayEscapeReason?: string;
  }): Promise<PrepareContextResponse> {
    const scopeHitCounts = input.queryResult.candidates.reduce<Partial<Record<typeof input.packet.selected_scopes[number], number>>>((acc, candidate) => {
      acc[candidate.scope] = (acc[candidate.scope] ?? 0) + 1;
      return acc;
    }, {});

    await this.repository.recordRecallRun({
      trace_id: input.traceId,
      phase: "before_response",
      trigger_hit: true,
      trigger_type: input.decision.trigger_type,
      trigger_reason: input.triggerReason,
      memory_mode: input.decision.memory_mode,
      requested_scopes: input.decision.requested_scopes,
      matched_scopes: input.packet.selected_scopes,
      scope_hit_counts: scopeHitCounts,
      scope_reason: input.decision.scope_reason,
      query_scope: input.packet.query_scope,
      requested_memory_types: input.decision.requested_memory_types,
      candidate_count: input.queryResult.candidates.length,
      selected_count: input.packet.records.length,
      recently_filtered_record_ids: input.recentlyFilteredCandidates?.map((candidate) => candidate.id) ?? [],
      recently_filtered_reasons: input.recentlyFilteredCandidates?.map((candidate) => `hard_window_active:${candidate.memory_type}`) ?? [],
      recently_soft_marked_record_ids: input.recentlySoftMarkedCandidates?.map((candidate) => candidate.id) ?? [],
      replay_escape_reason: input.replayEscapeReason,
      result_state:
        input.queryResult.degraded && input.packet.records.length === 0
          ? "dependency_unavailable"
          : input.packet.records.length === 0
            ? "empty"
            : "matched",
      degraded: input.queryResult.degraded,
      degradation_reason: input.queryResult.degradation_reason,
      duration_ms: Date.now() - input.recallStartedAt,
      created_at: nowIso(),
    });

    const injectionBlock = this.injectionEngine.build(input.packet);
    await this.repository.recordInjectionRun({
      trace_id: input.traceId,
      phase: "before_response",
      injected: Boolean(injectionBlock),
      injected_count: injectionBlock?.memory_records.length ?? 0,
      token_estimate: injectionBlock?.token_estimate ?? 0,
      memory_mode: input.decision.memory_mode,
      requested_scopes: input.packet.requested_scopes,
      selected_scopes: injectionBlock?.selected_scopes ?? [],
      trimmed_record_ids: injectionBlock?.trimmed_record_ids ?? [],
      trim_reasons: injectionBlock?.trim_reasons ?? [],
      recently_filtered_record_ids: input.recentlyFilteredCandidates?.map((candidate) => candidate.id) ?? [],
      recently_filtered_reasons: input.recentlyFilteredCandidates?.map((candidate) => `hard_window_active:${candidate.memory_type}`) ?? [],
      recently_soft_marked_record_ids: input.recentlySoftMarkedCandidates?.map((candidate) => candidate.id) ?? [],
      replay_escape_reason: input.replayEscapeReason,
      result_state:
        input.packet.records.length === 0
          ? "no_records"
          : injectionBlock && injectionBlock.memory_records.length > 0
            ? "injected"
            : "trimmed_to_zero",
      duration_ms: Date.now() - input.injectionStartedAt,
      created_at: nowIso(),
    });

    if (injectionBlock?.memory_records.length) {
      this.storeInjectionContext(
        {
          session_id: input.sessionId,
          turn_id: input.turnId,
        },
        injectionBlock.memory_records,
        input.traceId,
      );
      this.rememberRecentInjection(
        input.sessionId,
        input.turnId,
        input.traceId,
        input.turnIndex ?? this.peekTurnIndex(input.sessionId),
        "before_response",
        input.packet.records.filter((candidate) =>
          injectionBlock.memory_records.some((record) => record.id === candidate.id),
        ),
      );
    }

    return {
      trace_id: input.traceId,
      trigger: true,
      trigger_reason: input.triggerReason,
      memory_packet: input.packet,
      injection_block: injectionBlock,
      proactive_recommendations: input.proactiveRecommendations,
      degraded: input.queryResult.degraded,
      dependency_status: input.dependencyStatus,
      budget_used: injectionBlock?.token_estimate ?? 0,
      memory_packet_ids: [input.packet.packet_id],
    };
  }

  private async collectProactiveRecommendations(
    context: TriggerContext & { memory_mode: MemoryMode },
    traceId: string,
  ): Promise<ProactiveRecommendation[]> {
    const recommender = this.memoryOrchestrator?.recommendation;
    if (!recommender || !this.storageClient) {
      return [];
    }

    const startedAt = Date.now();
    const recordsResult = await this.dependencyGuard.run(
      "storage_writeback",
      this.embeddingTimeoutMs,
      (signal) =>
        this.storageClient!.listRecords(
          {
            workspace_id: context.workspace_id,
            user_id: context.user_id,
            status: "active",
            page: 1,
            page_size: 12,
          },
          signal,
        ),
    );

    if (!recordsResult.ok || !recordsResult.value) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_recommendation_plan",
        input_summary: summarizeText(`session=${context.session_id}`),
        output_summary: summarizeText(`fallback=${recordsResult.error?.code ?? "storage_writeback_unavailable"}`),
        prompt_version: MEMORY_RECOMMENDATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: recordsResult.error?.code ?? "storage_writeback_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const availableMemories = recordsResult.value.items.slice(0, 12);
    if (availableMemories.length === 0) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_recommendation_plan",
        input_summary: summarizeText(`session=${context.session_id}`),
        output_summary: summarizeText("recommendations=0"),
        prompt_version: MEMORY_RECOMMENDATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: false,
        result_state: "skipped",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const planResult = await this.dependencyGuard.run(
      "memory_llm",
      this.embeddingTimeoutMs,
      () =>
        recommender.recommend({
          current_context: {
            user_input: context.current_input,
            session_context: {
              session_id: context.session_id,
              workspace_id: context.workspace_id,
              user_id: context.user_id,
              recent_context_summary: context.recent_context_summary,
            },
          },
          available_memories: availableMemories,
        }),
    );

    if (!planResult.ok || !planResult.value) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_recommendation_plan",
        input_summary: summarizeText(`available=${availableMemories.length}`),
        output_summary: summarizeText(`fallback=${planResult.error?.code ?? "memory_llm_unavailable"}`),
        prompt_version: MEMORY_RECOMMENDATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: planResult.error?.code ?? "memory_llm_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const recommendations = planResult.value.recommendations
      .filter((item) => item.relevance_score >= 0.7)
      .map((item) => ({
        record_id: item.record_id,
        relevance_score: item.relevance_score,
        trigger_reason: item.trigger_reason,
        suggestion: item.suggestion,
        auto_inject: item.auto_inject || item.relevance_score > 0.9,
      })) satisfies ProactiveRecommendation[];

    await this.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: context.phase,
      plan_kind: "memory_recommendation_plan",
      input_summary: summarizeText(`available=${availableMemories.length}`),
      output_summary: summarizeText(`recommendations=${recommendations.length}; auto_inject=${recommendations.filter((item) => item.auto_inject).length}`),
      prompt_version: MEMORY_RECOMMENDATION_PROMPT_VERSION,
      schema_version: MEMORY_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: recommendations.length > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    return recommendations;
  }

  private async expandCandidatesWithRelations(
    context: TriggerContext & { memory_mode: MemoryMode },
    candidates: CandidateMemory[],
    traceId: string,
  ): Promise<CandidateMemory[]> {
    if (!this.storageClient || candidates.length === 0) {
      return [];
    }

    const startedAt = Date.now();
    const sourceIds = candidates.slice(0, 5).map((candidate) => candidate.id);
    const relationItems: MemoryRelationSnapshot[] = [];

    for (const recordId of sourceIds) {
      const relationsResult = await this.dependencyGuard.run(
        "storage_writeback",
        this.embeddingTimeoutMs,
        (signal) =>
          this.storageClient!.listRelations(
            {
              workspace_id: context.workspace_id,
              record_id: recordId,
              limit: 20,
            },
            signal,
          ),
      );
      if (!relationsResult.ok || !relationsResult.value) {
        await this.repository.recordMemoryPlanRun({
          trace_id: traceId,
          phase: context.phase,
          plan_kind: "memory_relation_plan",
          input_summary: summarizeText(`seed=${sourceIds.join(",")}`),
          output_summary: summarizeText(`fallback=${relationsResult.error?.code ?? "storage_writeback_unavailable"}`),
          prompt_version: MEMORY_RELATION_PROMPT_VERSION,
          schema_version: MEMORY_PLAN_SCHEMA_VERSION,
          degraded: true,
          degradation_reason: relationsResult.error?.code ?? "storage_writeback_unavailable",
          result_state: "fallback",
          duration_ms: Date.now() - startedAt,
          created_at: nowIso(),
        });
        return [];
      }
      relationItems.push(...relationsResult.value);
    }

    const relationTargetIds = [...new Set(
      relationItems
        .filter((relation) => relation.strength >= 0.7)
        .map((relation) => relation.source_record_id === relation.target_record_id ? null : relation.target_record_id)
        .filter((id): id is string => typeof id === "string" && !sourceIds.includes(id))
    )];

    if (relationTargetIds.length === 0) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_relation_plan",
        input_summary: summarizeText(`seed=${sourceIds.join(",")}`),
        output_summary: summarizeText("relations=0"),
        prompt_version: MEMORY_RELATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: false,
        result_state: "skipped",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const relatedRecordsResult = await this.dependencyGuard.run(
      "storage_writeback",
      this.embeddingTimeoutMs,
      (signal) => this.storageClient!.getRecordsByIds(relationTargetIds, signal),
    );

    if (!relatedRecordsResult.ok || !relatedRecordsResult.value) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_relation_plan",
        input_summary: summarizeText(`targets=${relationTargetIds.join(",")}`),
        output_summary: summarizeText(`fallback=${relatedRecordsResult.error?.code ?? "storage_writeback_unavailable"}`),
        prompt_version: MEMORY_RELATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: relatedRecordsResult.error?.code ?? "storage_writeback_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const relationByTarget = new Map<string, MemoryRelationSnapshot>();
    for (const relation of relationItems) {
      if (!relationByTarget.has(relation.target_record_id)) {
        relationByTarget.set(relation.target_record_id, relation);
      }
    }

    const relatedCandidates = relatedRecordsResult.value
      .filter((record) => record.status === "active")
      .map((record) => {
        const relation = relationByTarget.get(record.id);
        return {
          id: record.id,
          workspace_id: record.workspace_id,
          user_id: record.user_id ?? context.user_id,
          task_id: record.task_id ?? null,
          session_id: record.session_id ?? null,
          memory_type: record.memory_type,
          scope: record.scope,
          summary: record.summary,
          details: {
            ...(record.details ?? {}),
            relation_type: relation?.relation_type,
            relation_reason: relation?.reason,
            relation_strength: relation?.strength,
          },
          importance: Math.max(record.importance, relation?.strength ? Math.round(relation.strength * 5) : record.importance),
          confidence: record.confidence,
          status: record.status,
          updated_at: record.updated_at,
          last_confirmed_at: null,
          rerank_score: relation?.strength ?? 0.7,
        } satisfies CandidateMemory;
      });

    await this.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: context.phase,
      plan_kind: "memory_relation_plan",
      input_summary: summarizeText(`seed=${sourceIds.join(",")}`),
      output_summary: summarizeText(`relations=${relationItems.length}; expanded=${relatedCandidates.length}`),
      prompt_version: MEMORY_RELATION_PROMPT_VERSION,
      schema_version: MEMORY_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: relatedCandidates.length > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    return relatedCandidates;
  }

  private storeInjectionContext(
    context: Pick<TriggerContext, "session_id" | "turn_id">,
    records: Array<{ id: string; summary: string; importance: number }>,
    traceIdOverride?: string,
  ) {
    this.cleanupExpiredInjectionContexts();
    const key = this.getInjectionContextKey(
      context.session_id,
      context.turn_id,
      traceIdOverride,
    );
    if (!key || records.length === 0) {
      return;
    }
    this.recentInjectionContexts.set(key, {
      memories: records.map((record) => ({
        record_id: record.id,
        summary: record.summary,
        importance: record.importance,
      })),
      created_at: Date.now(),
    });
  }

  private async evaluateRecallEffectivenessIfNeeded(
    input: Pick<FinalizeTurnInput, "session_id" | "turn_id" | "assistant_output">,
    traceId: string,
  ): Promise<void> {
    const evaluator = this.memoryOrchestrator?.recall?.effectiveness;
    if (!evaluator) {
      return;
    }

    this.cleanupExpiredInjectionContexts();
    const key = this.getInjectionContextKey(input.session_id, input.turn_id, traceId);
    if (!key) {
      return;
    }
    const context = this.recentInjectionContexts.get(key);
    if (!context || context.memories.length === 0) {
      return;
    }

    const startedAt = Date.now();
    const planResult = await this.dependencyGuard.run(
      "memory_llm",
      this.embeddingTimeoutMs,
      () =>
        evaluator.evaluate({
          injected_memories: context.memories,
          assistant_output: input.assistant_output,
        }),
    );

    if (!planResult.ok || !planResult.value) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: "after_response",
        plan_kind: "memory_effectiveness_plan",
        input_summary: summarizeText(`memories=${context.memories.length}`),
        output_summary: summarizeText(`fallback=${planResult.error?.code ?? "memory_llm_unavailable"}`),
        prompt_version: MEMORY_EFFECTIVENESS_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: planResult.error?.code ?? "memory_llm_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return;
    }

    await this.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: "after_response",
      plan_kind: "memory_effectiveness_plan",
      input_summary: summarizeText(`memories=${context.memories.length}`),
      output_summary: summarizeText(
        `evaluations=${planResult.value.evaluations.length}; used=${planResult.value.evaluations.filter((item) => item.was_used).length}`,
      ),
      prompt_version: MEMORY_EFFECTIVENESS_PROMPT_VERSION,
      schema_version: MEMORY_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: planResult.value.evaluations.length > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    await Promise.all(planResult.value.evaluations.map(async (evaluation) => {
      if (evaluation.suggested_importance_adjustment === 0) {
        return;
      }
      const current = context.memories.find((memory) => memory.record_id === evaluation.record_id);
      if (!current) {
        return;
      }
      const nextImportance = Math.max(1, Math.min(5, current.importance + evaluation.suggested_importance_adjustment));
      await this.dependencyGuard.run(
        "storage_writeback",
        this.embeddingTimeoutMs,
        () =>
          this.writebackEngine.patchRecord(evaluation.record_id, {
            importance: nextImportance,
            ...(evaluation.was_used ? { last_used_at: nowIso() } : {}),
            actor: {
              actor_type: "system",
              actor_id: "retrieval-runtime",
            },
            reason: evaluation.reason,
          }),
      );
    }));

    this.recentInjectionContexts.delete(key);
  }

  private cleanupExpiredInjectionContexts() {
    const now = Date.now();
    for (const [key, value] of this.recentInjectionContexts.entries()) {
      if (now - value.created_at > INJECTION_EVALUATION_TTL_MS) {
        this.recentInjectionContexts.delete(key);
      }
    }
  }

  private getInjectionContextKey(
    sessionId: string,
    turnId?: string,
    traceId?: string,
  ) {
    if (turnId) {
      return `${sessionId}:${turnId}`;
    }
    if (traceId) {
      return `${sessionId}:${traceId}`;
    }
    return undefined;
  }

  private applyRecentInjectionPolicy(input: {
    context: TriggerContext & { memory_mode: MemoryMode };
    traceId: string;
    turnIndex: number;
    candidates: CandidateMemory[];
  }): RecentInjectionDecision {
    if (
      !this.config.INJECTION_DEDUP_ENABLED
      || input.candidates.length === 0
      || input.context.phase !== "before_response"
    ) {
      return {
        hardFiltered: [],
        softMarked: [],
        remaining: input.candidates,
      };
    }

    const replayEscapeReason = this.resolveReplayEscapeReason(input.context, input.candidates);
    if (replayEscapeReason) {
      return {
        hardFiltered: [],
        softMarked: [],
        remaining: input.candidates,
        replayEscapeReason,
      };
    }

    const sessionState = this.recentInjections.get(input.context.session_id);
    if (!sessionState || sessionState.size === 0) {
      return {
        hardFiltered: [],
        softMarked: [],
        remaining: input.candidates,
      };
    }

    const now = Date.now();
    const hardFiltered: CandidateMemory[] = [];
    const softMarked: CandidateMemory[] = [];
    const remaining: CandidateMemory[] = [];

    for (const candidate of input.candidates) {
      const recent = sessionState.get(candidate.id);
      if (!recent) {
        remaining.push(candidate);
        continue;
      }

      const elapsedMs = Math.max(0, now - recent.injected_at);
      const turnsSince = Math.max(0, input.turnIndex - recent.turn_index);
      const hardWindowTurns = this.getHardWindowTurns(candidate.memory_type);
      const hardWindowMs = this.getHardWindowMs(candidate.memory_type);
      const softWindowMs = this.getSoftWindowMs(candidate.memory_type);

      if (
        (hardWindowTurns > 0 && turnsSince <= hardWindowTurns)
        || (hardWindowMs > 0 && elapsedMs <= hardWindowMs)
      ) {
        hardFiltered.push(candidate);
        continue;
      }

      if (softWindowMs > 0 && elapsedMs <= softWindowMs) {
        const marked: CandidateMemory = {
          ...candidate,
          recent_injection_hint: {
            recently_injected: true,
            injected_at: new Date(recent.injected_at).toISOString(),
            turns_since_last_injection: turnsSince,
          },
        };
        softMarked.push(marked);
        remaining.push(marked);
        continue;
      }

      remaining.push(candidate);
    }

    return {
      hardFiltered,
      softMarked,
      remaining,
    };
  }

  private resolveReplayEscapeReason(context: TriggerContext, candidates: CandidateMemory[]): string | undefined {
    if (this.hasRecentTaskSwitch(context.session_id)) {
      return "task_switch_escape";
    }
    const sessionState = this.recentInjections.get(context.session_id);
    if (sessionState && candidates.some((candidate) => {
      const recent = sessionState.get(candidate.id);
      return Boolean(recent?.record_updated_at && recent.record_updated_at !== candidate.updated_at);
    })) {
      return "record_version_changed_escape";
    }
    if (context.phase === "task_switch") {
      return "task_switch_escape";
    }
    if (matchesHistoryReference(context.current_input)) {
      return "history_reference_escape";
    }
    return undefined;
  }

  private getHardWindowTurns(memoryType: MemoryType) {
    switch (memoryType) {
      case "fact_preference":
        return this.config.INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE;
      case "task_state":
        return this.config.INJECTION_HARD_WINDOW_TURNS_TASK_STATE;
      case "episodic":
        return this.config.INJECTION_HARD_WINDOW_TURNS_EPISODIC;
    }
  }

  private getHardWindowMs(memoryType: MemoryType) {
    switch (memoryType) {
      case "fact_preference":
        return this.config.INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE;
      case "task_state":
        return this.config.INJECTION_HARD_WINDOW_MS_TASK_STATE;
      case "episodic":
        return this.config.INJECTION_HARD_WINDOW_MS_EPISODIC;
    }
  }

  private getSoftWindowMs(memoryType: MemoryType) {
    switch (memoryType) {
      case "fact_preference":
        return 0;
      case "task_state":
        return this.config.INJECTION_SOFT_WINDOW_MS_TASK_STATE;
      case "episodic":
        return this.config.INJECTION_SOFT_WINDOW_MS_EPISODIC;
    }
  }

  private rememberRecentInjection(
    sessionId: string,
    turnId: string | undefined,
    traceId: string,
    turnIndex: number,
    sourcePhase: TriggerContext["phase"],
    records: Array<{ id: string; memory_type: MemoryType; updated_at?: string }>,
  ) {
    if (records.length === 0) {
      return;
    }

    if (this.recentInjections.size >= this.config.INJECTION_RECENT_STATE_MAX_SESSIONS && !this.recentInjections.has(sessionId)) {
      const oldestKey = this.recentInjections.keys().next().value;
      if (oldestKey) {
        this.recentInjections.delete(oldestKey);
      }
    }

    const sessionState = this.recentInjections.get(sessionId) ?? new Map<string, RecentInjectionRecord>();
    const now = Date.now();
    for (const record of records) {
      sessionState.set(record.id, {
        record_id: record.id,
        memory_type: record.memory_type,
        record_updated_at: record.updated_at,
        injected_at: now,
        turn_index: turnIndex,
        trace_id: traceId,
        source_phase: sourcePhase,
      });
    }
    this.recentInjections.set(sessionId, sessionState);
  }

  private cleanupExpiredRecentInjections() {
    const now = Date.now();
    for (const [sessionId, records] of this.recentInjections.entries()) {
      for (const [recordId, record] of records.entries()) {
        if (now - record.injected_at > this.config.INJECTION_RECENT_STATE_TTL_MS) {
          records.delete(recordId);
        }
      }
      if (records.size === 0) {
        this.recentInjections.delete(sessionId);
      }
    }
  }

  private nextTurnIndex(sessionId: string, turnId?: string) {
    const existing = this.sessionTurnCounters.get(sessionId) ?? 0;
    if (!turnId) {
      const next = existing + 1;
      this.sessionTurnCounters.set(sessionId, next);
      return next;
    }
    const next = existing + 1;
    this.sessionTurnCounters.set(sessionId, next);
    return next;
  }

  private peekTurnIndex(sessionId: string) {
    return this.sessionTurnCounters.get(sessionId) ?? 0;
  }

  private hasRecentTaskSwitch(sessionId: string) {
    const sessionState = this.recentInjections.get(sessionId);
    if (!sessionState) {
      return false;
    }
    for (const record of sessionState.values()) {
      if (record.source_phase === "task_switch" && record.turn_index >= this.peekTurnIndex(sessionId) - 1) {
        return true;
      }
    }
    return false;
  }
}

function isAppConfig(value: AppConfig | TriggerEngine): value is AppConfig {
  return typeof value === "object" && value !== null && "DATABASE_URL" in value;
}

function pickRecentInjectionConfig(config: AppConfig): RecentInjectionRuntimeConfig {
  return {
    INJECTION_DEDUP_ENABLED: config.INJECTION_DEDUP_ENABLED,
    INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: config.INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE,
    INJECTION_HARD_WINDOW_TURNS_TASK_STATE: config.INJECTION_HARD_WINDOW_TURNS_TASK_STATE,
    INJECTION_HARD_WINDOW_TURNS_EPISODIC: config.INJECTION_HARD_WINDOW_TURNS_EPISODIC,
    INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: config.INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE,
    INJECTION_HARD_WINDOW_MS_TASK_STATE: config.INJECTION_HARD_WINDOW_MS_TASK_STATE,
    INJECTION_HARD_WINDOW_MS_EPISODIC: config.INJECTION_HARD_WINDOW_MS_EPISODIC,
    INJECTION_SOFT_WINDOW_MS_TASK_STATE: config.INJECTION_SOFT_WINDOW_MS_TASK_STATE,
    INJECTION_SOFT_WINDOW_MS_EPISODIC: config.INJECTION_SOFT_WINDOW_MS_EPISODIC,
    INJECTION_RECENT_STATE_TTL_MS: config.INJECTION_RECENT_STATE_TTL_MS,
    INJECTION_RECENT_STATE_MAX_SESSIONS: config.INJECTION_RECENT_STATE_MAX_SESSIONS,
  };
}

function reorderSelectedCandidates(
  candidates: CandidateMemory[],
  selectedRecordIds: string[],
) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected = selectedRecordIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is CandidateMemory => Boolean(candidate));

  if (selected.length > 0) {
    return selected;
  }

  return candidates.slice(0, Math.min(3, candidates.length));
}

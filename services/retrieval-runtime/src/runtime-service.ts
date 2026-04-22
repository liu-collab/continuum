import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { DependencyGuard } from "./dependency/dependency-guard.js";
import { buildMemoryPacket } from "./injection/packet-builder.js";
import type { MemoryOrchestrator, RecallInjectionPlanner, WritebackPlanner } from "./memory-orchestrator/index.js";
import type { RuntimeRepository } from "./observability/runtime-repository.js";
import { nowIso } from "./shared/utils.js";
import type {
  CandidateMemory,
  DependencyStatus,
  DependencyStatusSnapshot,
  FinalizeIdempotencyRecord,
  FinalizeTurnInput,
  FinalizeTurnResponse,
  MaintenanceRunSummary,
  MemoryPacket,
  MemoryMode,
  MemoryType,
  ObserveRunsFilters,
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
  constructor(
    private readonly triggerEngine: TriggerEngine,
    private readonly queryEngine: QueryEngine,
    private readonly embeddingsClient: EmbeddingsClient,
    private readonly injectionEngine: InjectionEngine,
    private readonly writebackEngine: WritebackEngine,
    private readonly repository: RuntimeRepository,
    private readonly dependencyGuard: DependencyGuard,
    private readonly logger: Logger,
    private readonly finalizeIdempotencyCache?: FinalizeIdempotencyCache,
    private readonly embeddingTimeoutMs = 800,
    private readonly memoryOrchestrator?: MemoryOrchestrator,
    private readonly maintenanceWorker?: WritebackMaintenanceWorker,
  ) {}

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
        degraded: Boolean(decision.degraded),
        dependency_status: await this.dependencyGuard.snapshot(),
        budget_used: 0,
        memory_packet_ids: [],
      };
    }

    const recallStartedAt = Date.now();
    const queryResult = await this.queryEngine.query(normalizedContext, decision);
    let selectedCandidates = queryResult.candidates;
    let finalTriggerReason = decision.trigger_reason;
    let forceNoInjection = false;
    let degraded = queryResult.degraded;
    let degradationReason = queryResult.degradation_reason;

    if (
      normalizedContext.phase === "before_response"
      && this.memoryOrchestrator?.recall?.injection
      && this.queryResultCanBePlanned(queryResult.candidates)
    ) {
      const recallInjectionPlanner = this.memoryOrchestrator.recall.injection;
      const planResult = await this.dependencyGuard.run(
        "memory_llm",
        this.embeddingTimeoutMs,
        () =>
          recallInjectionPlanner.plan({
            context: normalizedContext,
            memory_mode: decision.memory_mode,
            requested_scopes: decision.requested_scopes,
            requested_memory_types: decision.requested_memory_types,
            candidates: queryResult.candidates,
            search_reason: decision.llm_decision_reason,
            semantic_score: decision.semantic_score,
            semantic_threshold: undefined,
          }),
      );

      if (planResult.ok && planResult.value) {
        finalTriggerReason = planResult.value.reason;
        if (!planResult.value.should_inject) {
          selectedCandidates = [];
          forceNoInjection = true;
        } else {
          selectedCandidates = reorderSelectedCandidates(
            queryResult.candidates,
            planResult.value.selected_record_ids ?? [],
          );
        }

        const plannedMemorySummary = planResult.value.memory_summary?.trim() ?? "";
        if (planResult.value.should_inject && plannedMemorySummary.length > 0) {
          const packet = buildMemoryPacket(queryResult.query, decision, selectedCandidates);
          packet.packet_summary = plannedMemorySummary;
          return this.finalizePreparedContextResponse({
            traceId,
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
          });
        }
      } else {
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
      result_state:
        packet.records.length === 0
          ? "no_records"
          : injectionBlock && injectionBlock.memory_records.length > 0
            ? "injected"
            : "trimmed_to_zero",
      duration_ms: Date.now() - injectionStartedAt,
      created_at: nowIso(),
    });

    return {
      trace_id: traceId,
      trigger: !forceNoInjection,
      trigger_reason: finalTriggerReason,
      memory_packet: forceNoInjection ? null : packet,
      injection_block: injectionBlock,
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

  private async finalizePreparedContextResponse(input: {
    traceId: string;
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
      result_state:
        input.packet.records.length === 0
          ? "no_records"
          : injectionBlock && injectionBlock.memory_records.length > 0
            ? "injected"
            : "trimmed_to_zero",
      duration_ms: Date.now() - input.injectionStartedAt,
      created_at: nowIso(),
    });

    return {
      trace_id: input.traceId,
      trigger: true,
      trigger_reason: input.triggerReason,
      memory_packet: input.packet,
      injection_block: injectionBlock,
      degraded: input.queryResult.degraded,
      dependency_status: input.dependencyStatus,
      budget_used: injectionBlock?.token_estimate ?? 0,
      memory_packet_ids: [input.packet.packet_id],
    };
  }
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

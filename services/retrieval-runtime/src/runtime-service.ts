import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { DependencyGuard } from "./dependency/dependency-guard.js";
import { buildMemoryPacket } from "./injection/packet-builder.js";
import type { RuntimeRepository } from "./observability/runtime-repository.js";
import { nowIso } from "./shared/utils.js";
import type {
  DependencyStatusSnapshot,
  FinalizeTurnInput,
  FinalizeTurnResponse,
  MemoryMode,
  ObserveRunsFilters,
  PrepareContextResponse,
  SessionStartResponse,
  TriggerContext,
} from "./shared/types.js";
import type { QueryEngine } from "./query/query-engine.js";
import type { TriggerEngine } from "./trigger/trigger-engine.js";
import type { WritebackEngine } from "./writeback/writeback-engine.js";
import type { InjectionEngine } from "./injection/injection-engine.js";

function resolveMemoryMode(memoryMode?: MemoryMode): MemoryMode {
  return memoryMode ?? "workspace_plus_global";
}

function isWritebackAccepted(status: FinalizeTurnResponse["submitted_jobs"][number]["status"]): boolean {
  return status === "accepted" || status === "accepted_async" || status === "merged";
}

export class RetrievalRuntimeService {
  constructor(
    private readonly triggerEngine: TriggerEngine,
    private readonly queryEngine: QueryEngine,
    private readonly injectionEngine: InjectionEngine,
    private readonly writebackEngine: WritebackEngine,
    private readonly repository: RuntimeRepository,
    private readonly dependencyGuard: DependencyGuard,
    private readonly logger: Logger,
  ) {}

  async prepareContext(context: TriggerContext): Promise<PrepareContextResponse> {
    const normalizedContext = {
      ...context,
      memory_mode: resolveMemoryMode(context.memory_mode),
    };
    const traceId = randomUUID();
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
    const packet = buildMemoryPacket(queryResult.query, decision, queryResult.candidates);
    const scopeHitCounts = queryResult.candidates.reduce<Partial<Record<typeof packet.selected_scopes[number], number>>>((acc, candidate) => {
      acc[candidate.scope] = (acc[candidate.scope] ?? 0) + 1;
      return acc;
    }, {});

    await this.repository.recordRecallRun({
      trace_id: traceId,
      trigger_hit: true,
      trigger_type: decision.trigger_type,
      trigger_reason: decision.trigger_reason,
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
        queryResult.degraded && packet.records.length === 0
          ? "dependency_unavailable"
          : packet.records.length === 0
            ? "empty"
            : "matched",
      degraded: queryResult.degraded,
      degradation_reason: queryResult.degradation_reason,
      duration_ms: Date.now() - recallStartedAt,
      created_at: nowIso(),
    });

    const injectionStartedAt = Date.now();
    const injectionBlock = this.injectionEngine.build(packet);

    await this.repository.recordInjectionRun({
      trace_id: traceId,
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
      trigger: true,
      trigger_reason: decision.trigger_reason,
      memory_packet: packet,
      injection_block: injectionBlock,
      degraded: queryResult.degraded,
      dependency_status: await this.dependencyGuard.snapshot(),
      budget_used: injectionBlock?.token_estimate ?? 0,
      memory_packet_ids: [packet.packet_id],
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
    const traceId =
      (await this.repository.findTraceIdForFinalize({
        session_id: normalizedInput.session_id,
        turn_id: normalizedInput.turn_id,
        thread_id: normalizedInput.thread_id,
        current_input: normalizedInput.current_input,
      })) ?? randomUUID();
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

    const result = await this.writebackEngine.submit(normalizedInput);

    await this.repository.recordWritebackSubmission({
      trace_id: traceId,
      candidate_count: result.candidates.length,
      submitted_count: result.submitted_jobs.filter((job) => job.status !== "dependency_unavailable" && job.status !== "rejected").length,
      memory_mode: normalizedInput.memory_mode,
      final_scopes: [...new Set(result.candidates.map((candidate) => candidate.scope))],
      filtered_count: result.filtered_count,
      filtered_reasons: result.filtered_reasons,
      scope_reasons: result.scope_reasons,
      result_state:
        result.candidates.length === 0
          ? "no_candidates"
          : result.degraded
            ? "failed"
            : "submitted",
      degraded: result.degraded,
      degradation_reason: result.degradation_reason,
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    return {
      trace_id: traceId,
      write_back_candidates: result.candidates,
      submitted_jobs: result.submitted_jobs,
      memory_mode: normalizedInput.memory_mode,
      candidate_count: result.candidates.length,
      filtered_count: result.filtered_count,
      filtered_reasons: result.filtered_reasons,
      writeback_submitted: result.submitted_jobs.some((job) => isWritebackAccepted(job.status)),
      degraded: result.degraded,
      dependency_status: await this.dependencyGuard.snapshot(),
    };
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

  async getRuns(filters?: ObserveRunsFilters) {
    return this.repository.getRuns(filters);
  }

  async getMetrics() {
    return this.repository.getMetrics();
  }
}

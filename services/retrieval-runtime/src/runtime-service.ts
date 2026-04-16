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
  ObserveRunsFilters,
  PrepareContextResponse,
  SessionStartResponse,
  TriggerContext,
} from "./shared/types.js";
import type { QueryEngine } from "./query/query-engine.js";
import type { TriggerEngine } from "./trigger/trigger-engine.js";
import type { WritebackEngine } from "./writeback/writeback-engine.js";
import type { InjectionEngine } from "./injection/injection-engine.js";

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
    const traceId = randomUUID();
    const turnStartedAt = Date.now();
    await this.repository.recordTurn({
      trace_id: traceId,
      host: context.host,
      workspace_id: context.workspace_id,
      user_id: context.user_id,
      session_id: context.session_id,
      phase: context.phase,
      task_id: context.task_id,
      thread_id: context.thread_id,
      turn_id: context.turn_id,
      current_input: context.current_input,
      created_at: nowIso(),
    });

    const triggerStartedAt = Date.now();
    const decision = await this.triggerEngine.decide(context);
    await this.repository.recordTriggerRun({
      trace_id: traceId,
      trigger_hit: decision.hit,
      trigger_type: decision.trigger_type,
      trigger_reason: decision.trigger_reason,
      requested_memory_types: decision.requested_memory_types,
      scope_limit: decision.scope_limit,
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
    const queryResult = await this.queryEngine.query(context, decision);
    const packet = buildMemoryPacket(queryResult.query, decision, queryResult.candidates);

    await this.repository.recordRecallRun({
      trace_id: traceId,
      trigger_hit: true,
      trigger_type: decision.trigger_type,
      trigger_reason: decision.trigger_reason,
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
      dependency_status: prepared.dependency_status,
      degraded: prepared.degraded,
    };
  }

  async finalizeTurn(input: FinalizeTurnInput): Promise<FinalizeTurnResponse> {
    const traceId = randomUUID();
    const startedAt = Date.now();

    await this.repository.recordTurn({
      trace_id: traceId,
      host: input.host,
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      session_id: input.session_id,
      phase: "after_response",
      task_id: input.task_id,
      thread_id: input.thread_id,
      turn_id: input.turn_id,
      current_input: input.current_input,
      assistant_output: input.assistant_output,
      created_at: nowIso(),
    });

    const result = await this.writebackEngine.submit(input);

    await this.repository.recordWritebackSubmission({
      trace_id: traceId,
      candidate_count: result.candidates.length,
      submitted_count: result.submitted_jobs.filter((job) => job.status !== "dependency_unavailable" && job.status !== "rejected").length,
      filtered_count: result.filtered_count,
      filtered_reasons: result.filtered_reasons,
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
      candidate_count: result.candidates.length,
      filtered_count: result.filtered_count,
      filtered_reasons: result.filtered_reasons,
      writeback_submitted: result.submitted_jobs.length > 0,
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

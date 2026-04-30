import type { DependencyStatusSnapshot, PrepareContextResponse } from "../shared/types.js";
import type {
  CandidateMemory,
  MemoryPacket,
  ProactiveRecommendation,
  TriggerDecision,
  TriggerContext,
} from "../shared/types.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type { InjectionEngine } from "../injection/injection-engine.js";
import type { RecentInjectionPolicy } from "../injection/recent-injection-policy.js";
import type { RecallEffectivenessService } from "./recall-effectiveness-service.js";
import { nowIso } from "../shared/utils.js";

type PrepareContextFinalizerOptions = {
  repository: Pick<RuntimeRepository, "recordInjectionRun" | "recordRecallRun">;
  injectionEngine: InjectionEngine;
  recentInjectionPolicy: RecentInjectionPolicy;
  recallEffectivenessService: RecallEffectivenessService;
};

export type PrepareContextFinalizerInput = {
  traceId: string;
  sessionId: string;
  turnId?: string;
  turnIndex: number;
  phase: TriggerContext["phase"];
  decision: TriggerDecision;
  triggerReason: string;
  queryResult: {
    candidates: CandidateMemory[];
    degraded: boolean;
    degradation_reason?: string;
  };
  packet: MemoryPacket;
  recallStartedAt: number;
  injectionStartedAt: number;
  dependencyStatus: DependencyStatusSnapshot;
  proactiveRecommendations: ProactiveRecommendation[];
  injectionTokenBudget?: number;
  recentlyFilteredCandidates?: CandidateMemory[];
  recentlySoftMarkedCandidates?: CandidateMemory[];
  replayEscapeReason?: string;
  forceNoInjection?: boolean;
  degradedSkipReason?: string;
};

export class PrepareContextFinalizer {
  constructor(private readonly options: PrepareContextFinalizerOptions) {}

  async finalize(input: PrepareContextFinalizerInput): Promise<PrepareContextResponse> {
    const recentlyFilteredCandidates = input.recentlyFilteredCandidates ?? [];
    const recentlySoftMarkedCandidates = input.recentlySoftMarkedCandidates ?? [];
    const scopeHitCounts = input.queryResult.candidates.reduce<Partial<Record<typeof input.packet.selected_scopes[number], number>>>((acc, candidate) => {
      acc[candidate.scope] = (acc[candidate.scope] ?? 0) + 1;
      return acc;
    }, {});

    await this.options.repository.recordRecallRun({
      trace_id: input.traceId,
      phase: input.phase,
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
      recently_filtered_record_ids: recentlyFilteredCandidates.map((candidate) => candidate.id),
      recently_filtered_reasons: recentlyFilteredCandidates.map((candidate) => `hard_window_active:${candidate.memory_type}`),
      recently_soft_marked_record_ids: recentlySoftMarkedCandidates.map((candidate) => candidate.id),
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

    const injectionBlock = this.options.injectionEngine.build(input.packet, {
      tokenBudget: input.injectionTokenBudget,
    });

    await this.options.repository.recordInjectionRun({
      trace_id: input.traceId,
      phase: input.phase,
      injected: Boolean(injectionBlock),
      injected_count: injectionBlock?.memory_records.length ?? 0,
      token_estimate: injectionBlock?.token_estimate ?? 0,
      memory_mode: input.decision.memory_mode,
      requested_scopes: input.packet.requested_scopes,
      selected_scopes: injectionBlock?.selected_scopes ?? [],
      trimmed_record_ids: injectionBlock?.trimmed_record_ids ?? [],
      trim_reasons: injectionBlock?.trim_reasons ?? [],
      recently_filtered_record_ids: recentlyFilteredCandidates.map((candidate) => candidate.id),
      recently_filtered_reasons: recentlyFilteredCandidates.map((candidate) => `hard_window_active:${candidate.memory_type}`),
      recently_soft_marked_record_ids: recentlySoftMarkedCandidates.map((candidate) => candidate.id),
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
      this.options.recallEffectivenessService.storeInjectionContext(
        {
          session_id: input.sessionId,
          turn_id: input.turnId,
        },
        injectionBlock.memory_records,
        input.traceId,
      );
      this.options.recentInjectionPolicy.remember({
        sessionId: input.sessionId,
        turnId: input.turnId,
        traceId: input.traceId,
        turnIndex: input.turnIndex,
        sourcePhase: input.phase,
        records: input.packet.records.filter((candidate) =>
          injectionBlock.memory_records.some((record) => record.id === candidate.id),
        ),
      });
    }

    return {
      trace_id: input.traceId,
      trigger: !input.forceNoInjection,
      trigger_reason: input.triggerReason,
      memory_packet: input.forceNoInjection ? null : input.packet,
      injection_block: injectionBlock,
      proactive_recommendations: input.proactiveRecommendations,
      degraded: input.queryResult.degraded,
      degraded_skip_reason:
        input.queryResult.degraded && (input.forceNoInjection || input.packet.records.length === 0)
          ? input.degradedSkipReason
          : undefined,
      dependency_status: input.dependencyStatus,
      budget_used: injectionBlock?.token_estimate ?? 0,
      memory_packet_ids: input.forceNoInjection ? [] : [input.packet.packet_id],
    };
  }
}

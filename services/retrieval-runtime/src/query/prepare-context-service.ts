import { randomUUID } from "node:crypto";

import type { DependencyGuard } from "../dependency/dependency-guard.js";
import { buildMemoryPacket } from "../injection/packet-builder.js";
import { updateLogContext } from "../logger.js";
import type { MemoryOrchestrator } from "../memory-orchestrator/index.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type {
  CandidateMemory,
  MemoryMode,
  PrepareContextResponse,
  TriggerContext,
  TriggerDecision,
} from "../shared/types.js";
import { nowIso } from "../shared/utils.js";
import { compareRankedCandidates } from "./query-engine.js";
import type { QueryEngine } from "./query-engine.js";
import type { RecallAugmentationService } from "./recall-augmentation-service.js";
import type { RecallPreflight, RecallPreflightSkip } from "../trigger/recall-preflight.js";
import type { TriggerEngine } from "../trigger/trigger-engine.js";
import type { RecentInjectionPolicy } from "../injection/recent-injection-policy.js";
import type { PrepareContextFinalizer } from "./prepare-context-finalizer.js";

const MEMORY_SEARCH_PROMPT_VERSION = "memory-recall-search-v1";
const MEMORY_INTENT_PROMPT_VERSION = "memory-intent-plan-v1";
const MEMORY_INJECTION_PROMPT_VERSION = "memory-recall-injection-v1";
const MEMORY_PLAN_SCHEMA_VERSION = "memory-plan-schema-v1";
const MEMORY_SEARCH_RULES_VERSION = "runtime-trigger-rules-v1";

type PrepareContextServiceOptions = {
  dependencyGuard: DependencyGuard;
  memoryLlmTimeoutMs: number;
  memoryOrchestrator?: MemoryOrchestrator;
  prepareContextFinalizer: PrepareContextFinalizer;
  queryEngine: QueryEngine;
  recentInjectionPolicy: RecentInjectionPolicy;
  recallAugmentationService: RecallAugmentationService;
  recallPreflight?: RecallPreflight;
  repository: RuntimeRepository;
  triggerEngine: TriggerEngine;
};

export class PrepareContextService {
  private readonly sessionPrepareQueues = new Map<string, Promise<void>>();
  private readonly inflightPrepareContexts = new Map<string, Promise<PrepareContextResponse>>();

  constructor(private readonly options: PrepareContextServiceOptions) {}

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

    const execution = this.runSerializedPrepare(normalizedContext.session_id, () =>
      this.prepareContextInternal(normalizedContext),
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
    await this.options.recentInjectionPolicy.cleanupExpired();
    await this.options.recentInjectionPolicy.ensureLoaded(normalizedContext.session_id);
    const turnIndex = this.options.recentInjectionPolicy.nextTurnIndex(normalizedContext.session_id);
    const traceId = await resolveTraceId(this.options.repository, {
      session_id: normalizedContext.session_id,
      turn_id: normalizedContext.turn_id,
      phase: normalizedContext.phase,
    });
    updateLogContext({ trace_id: traceId });
    const turnStartedAt = Date.now();
    await this.options.repository.recordTurn({
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
    const preflight = await this.options.recallPreflight?.evaluate(normalizedContext);
    if (preflight && !preflight.should_continue) {
      return this.returnPreflightSkipped({
        context: normalizedContext,
        traceId,
        preflight,
        triggerStartedAt,
        turnStartedAt,
      });
    }
    const triggerContext = preflight
      ? {
          ...normalizedContext,
          preflight_scopes: preflight.requested_scopes,
          preflight_memory_types: preflight.requested_memory_types,
          preflight_importance_threshold: preflight.importance_threshold,
        }
      : normalizedContext;
    const decision = await this.options.triggerEngine.decide(triggerContext);
    if (normalizedContext.phase === "before_response") {
      await this.options.repository.recordMemoryPlanRun({
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
    await this.options.repository.recordTriggerRun({
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
      await this.options.repository.recordMemoryPlanRun({
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
      await this.options.repository.recordRecallRun({
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

      await this.options.repository.recordInjectionRun({
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
        degraded_skip_reason: decision.degraded && !decision.hit ? decision.degraded_skip_reason : undefined,
        dependency_status: await this.options.dependencyGuard.snapshot(),
        budget_used: 0,
        memory_packet_ids: [],
      };
    }

    const recallStartedAt = Date.now();
    const queryResult = await this.options.queryEngine.query(normalizedContext, decision);
    const conflictAwareCandidates = await this.options.recallAugmentationService.annotateOpenConflicts(
      normalizedContext,
      queryResult.candidates,
    );
    let selectedCandidates = conflictAwareCandidates;
    let plannedCandidates = conflictAwareCandidates;
    let finalTriggerReason = mergeTriggerReason(decision.trigger_reason, decision.intent_reason);
    let forceNoInjection = false;
    let degraded = queryResult.degraded;
    let degradationReason = queryResult.degradation_reason;
    let recentlyFilteredCandidates: CandidateMemory[] = [];
    let recentlySoftMarkedCandidates: CandidateMemory[] = [];
    let replayEscapeReason: string | undefined;
    const proactiveRecommendations = normalizedContext.phase === "session_start"
      ? await this.options.recallAugmentationService.collectProactiveRecommendations(normalizedContext, traceId)
      : [];

    const relationCandidates = await this.options.recallAugmentationService.expandCandidatesWithRelations(
      normalizedContext,
      selectedCandidates,
      traceId,
    );
    if (relationCandidates.length > 0) {
      selectedCandidates = dedupeCandidates([...selectedCandidates, ...relationCandidates]).sort(compareRankedCandidates);
      plannedCandidates = selectedCandidates;
      finalTriggerReason = mergeTriggerReason(finalTriggerReason, "包含关联记忆补充");
    }

    const recentInjectionDecision = this.options.recentInjectionPolicy.apply({
      context: normalizedContext,
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
      && this.options.memoryOrchestrator?.recall?.injection
      && plannedCandidates.length > 0
    ) {
      const recallInjectionPlanner = this.options.memoryOrchestrator.recall.injection;
      const injectionPlanStartedAt = Date.now();
      const planResult = await this.options.dependencyGuard.run(
        "memory_llm",
        this.options.memoryLlmTimeoutMs,
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
        await this.options.repository.recordMemoryPlanRun({
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
          return this.options.prepareContextFinalizer.finalize({
            traceId,
            sessionId: normalizedContext.session_id,
            turnId: normalizedContext.turn_id,
            phase: normalizedContext.phase,
            decision,
            triggerReason: finalTriggerReason,
            queryResult: {
              candidates: conflictAwareCandidates,
              degraded,
              degradation_reason: degradationReason,
            },
            packet,
            recallStartedAt,
            injectionStartedAt: Date.now(),
            dependencyStatus: await this.options.dependencyGuard.snapshot(),
            proactiveRecommendations,
            injectionTokenBudget: normalizedContext.injection_token_budget,
            turnIndex,
            recentlyFilteredCandidates,
            recentlySoftMarkedCandidates,
            replayEscapeReason,
            degradedSkipReason: decision.degraded_skip_reason,
          });
        }
      } else {
        await this.options.repository.recordMemoryPlanRun({
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
    return this.options.prepareContextFinalizer.finalize({
      traceId,
      sessionId: normalizedContext.session_id,
      turnId: normalizedContext.turn_id,
      turnIndex,
      phase: normalizedContext.phase,
      decision,
      triggerReason: finalTriggerReason,
      queryResult: {
        candidates: conflictAwareCandidates,
        degraded,
        degradation_reason: degradationReason,
      },
      packet,
      recallStartedAt,
      injectionStartedAt: Date.now(),
      dependencyStatus: await this.options.dependencyGuard.snapshot(),
      proactiveRecommendations,
      injectionTokenBudget: normalizedContext.injection_token_budget,
      recentlyFilteredCandidates,
      recentlySoftMarkedCandidates,
      replayEscapeReason,
      forceNoInjection,
      degradedSkipReason: decision.degraded_skip_reason,
    });
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

  private async returnPreflightSkipped(input: {
    context: TriggerContext & { memory_mode: MemoryMode };
    traceId: string;
    preflight: RecallPreflightSkip;
    triggerStartedAt: number;
    turnStartedAt: number;
  }): Promise<PrepareContextResponse> {
    const triggerType: TriggerDecision["trigger_type"] = "no_trigger";

    await this.options.repository.recordTriggerRun({
      trace_id: input.traceId,
      phase: input.context.phase,
      trigger_hit: false,
      trigger_type: triggerType,
      trigger_reason: input.preflight.trigger_reason,
      requested_memory_types: input.preflight.requested_memory_types,
      memory_mode: input.context.memory_mode,
      requested_scopes: input.preflight.requested_scopes,
      scope_reason: input.preflight.scope_reason,
      importance_threshold: input.preflight.importance_threshold,
      cooldown_applied: false,
      duration_ms: Date.now() - input.triggerStartedAt,
      created_at: nowIso(),
    });

    await this.options.repository.recordRecallRun({
      trace_id: input.traceId,
      phase: input.context.phase,
      trigger_hit: false,
      trigger_type: triggerType,
      trigger_reason: input.preflight.trigger_reason,
      memory_mode: input.context.memory_mode,
      requested_scopes: input.preflight.requested_scopes,
      matched_scopes: [],
      scope_hit_counts: {},
      scope_reason: input.preflight.scope_reason,
      query_scope: `preflight_skipped:${input.preflight.reason}`,
      requested_memory_types: input.preflight.requested_memory_types,
      candidate_count: 0,
      selected_count: 0,
      result_state:
        input.preflight.reason === "no_visible_candidates" || input.preflight.reason === "no_matching_memory_types"
          ? "empty"
          : "not_triggered",
      degraded: false,
      duration_ms: Date.now() - input.turnStartedAt,
      created_at: nowIso(),
    });

    await this.options.repository.recordInjectionRun({
      trace_id: input.traceId,
      phase: input.context.phase,
      injected: false,
      injected_count: 0,
      token_estimate: 0,
      memory_mode: input.context.memory_mode,
      requested_scopes: input.preflight.requested_scopes,
      selected_scopes: [],
      trimmed_record_ids: [],
      trim_reasons: [],
      result_state: "not_triggered",
      duration_ms: 0,
      created_at: nowIso(),
    });

    return {
      trace_id: input.traceId,
      trigger: false,
      trigger_reason: input.preflight.trigger_reason,
      memory_packet: null,
      injection_block: null,
      proactive_recommendations: [],
      degraded: false,
      dependency_status: await this.options.dependencyGuard.snapshot(),
      budget_used: 0,
      memory_packet_ids: [],
    };
  }
}

function resolveMemoryMode(memoryMode?: MemoryMode): MemoryMode {
  return memoryMode ?? "workspace_plus_global";
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

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { IntentAnalyzer, RecallSearchPlanner } from "../memory-orchestrator/index.js";
import type { EmbeddingsClient } from "../query/embeddings-client.js";
import type { ReadModelRepository } from "../query/read-model-repository.js";
import { phaseTriggerReason, runtimeMessages, scopePlanReason } from "../shared/messages.js";
import type { MemoryMode, MemoryType, ScopeType, TriggerContext, TriggerDecision } from "../shared/types.js";
import type { Logger } from "pino";
import { matchesHistoryReference, normalizeText } from "../shared/utils.js";

const SEMANTIC_TRIGGER_FLOOR_RATIO = 0.8;
const SEMANTIC_TRIGGER_MEDIAN_DELTA = 0.15;

function requestedTypesByPhase(phase: TriggerContext["phase"]): MemoryType[] {
  switch (phase) {
    case "session_start":
      return ["fact_preference", "task_state"];
    case "task_start":
    case "task_switch":
      return ["task_state", "episodic", "fact_preference"];
    case "before_plan":
      return ["fact_preference", "task_state"];
    case "before_response":
      return ["fact_preference", "task_state", "episodic"];
    case "after_response":
      return [];
  }
}

function dedupeScopes(scopes: ScopeType[]): ScopeType[] {
  return [...new Set(scopes)];
}

function scopePlanByPhase(
  phase: TriggerContext["phase"],
  hasTask: boolean,
  memoryMode: MemoryMode,
): { scopes: ScopeType[]; reason: string } {
  switch (phase) {
    case "session_start":
      return {
        scopes: memoryMode === "workspace_plus_global" ? ["workspace", "user"] : ["workspace"],
        reason: scopePlanReason(phase, memoryMode, hasTask),
      };
    case "task_start":
    case "task_switch":
    case "before_plan":
      return {
        scopes: dedupeScopes([
          "workspace",
          ...(hasTask ? ["task" as const] : []),
          ...(memoryMode === "workspace_plus_global" ? ["user" as const] : []),
        ]),
        reason: scopePlanReason(phase, memoryMode, hasTask),
      };
    case "before_response":
      return {
        scopes: dedupeScopes([
          "workspace",
          ...(hasTask ? ["task" as const] : []),
          "session",
          ...(memoryMode === "workspace_plus_global" ? ["user" as const] : []),
        ]),
        reason: scopePlanReason(phase, memoryMode, hasTask),
      };
    case "after_response":
      return {
        scopes: [],
        reason: scopePlanReason(phase, memoryMode, hasTask),
      };
  }
}

function shouldSkipForShortInput(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.length < 8 && !matchesHistoryReference(normalized);
}

export class TriggerEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly embeddingsClient: EmbeddingsClient,
    private readonly readModelRepository: ReadModelRepository,
    private readonly dependencyGuard: DependencyGuard,
    private readonly logger: Logger,
    private readonly recallSearchPlanner?: RecallSearchPlanner,
    private readonly intentAnalyzer?: IntentAnalyzer,
  ) {}

  async decide(context: TriggerContext): Promise<TriggerDecision> {
    const memoryMode = context.memory_mode ?? "workspace_plus_global";
    const scopePlan = scopePlanByPhase(context.phase, Boolean(context.task_id), memoryMode);

    if (context.phase === "after_response") {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.afterResponseReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: [],
        scope_reason: scopePlan.reason,
        importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
        cooldown_applied: false,
      };
    }

    const normalizedInput = normalizeText(context.current_input).toLowerCase();
    const requestedMemoryTypes = requestedTypesByPhase(context.phase);
    let intentDecision:
      | {
          requestedMemoryTypes: MemoryType[];
          requestedScopes: ScopeType[];
          reason: string;
          confidence: number;
          needsMemory: boolean;
          degraded: boolean;
          degradationReason?: string;
        }
      | undefined;

    if (this.intentAnalyzer && context.phase === "before_response") {
      const intentResult = await this.dependencyGuard.run(
        "memory_llm",
        this.config.MEMORY_LLM_TIMEOUT_MS,
        () =>
          this.intentAnalyzer!.analyze({
            current_input: context.current_input,
            session_context: {
              session_id: context.session_id,
              workspace_id: context.workspace_id,
              recent_turns: [],
            },
          }),
      );

      if (intentResult.ok && intentResult.value) {
        intentDecision = {
          requestedMemoryTypes:
            intentResult.value.memory_types.length > 0
              ? intentResult.value.memory_types
              : requestedMemoryTypes,
          requestedScopes:
            intentResult.value.suggested_scopes && intentResult.value.suggested_scopes.length > 0
              ? dedupeScopes(intentResult.value.suggested_scopes)
              : scopePlan.scopes,
          reason: intentResult.value.reason,
          confidence: intentResult.value.confidence,
          needsMemory: intentResult.value.needs_memory,
          degraded: false,
        };
      } else {
        intentDecision = {
          requestedMemoryTypes,
          requestedScopes: scopePlan.scopes,
          reason: "intent_analyzer_unavailable",
          confidence: 0,
          needsMemory: true,
          degraded: true,
          degradationReason: intentResult.error?.code ?? "memory_llm_unavailable",
        };
      }
    }

    const withIntent = (base: TriggerDecision): TriggerDecision =>
      intentDecision
        ? {
            ...base,
            intent_reason: intentDecision.reason,
            intent_confidence: intentDecision.confidence,
            intent_needs_memory: intentDecision.needsMemory,
            intent_memory_types: intentDecision.requestedMemoryTypes,
            intent_scopes: intentDecision.requestedScopes,
            intent_plan_attempted: true,
            intent_plan_degraded: intentDecision.degraded,
            intent_plan_degradation_reason: intentDecision.degradationReason,
          }
        : base;

    if (context.phase !== "before_response") {
      return {
        hit: true,
        trigger_type: "phase",
        trigger_reason: phaseTriggerReason(context.phase),
        requested_memory_types: requestedMemoryTypes,
        memory_mode: memoryMode,
        requested_scopes: scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold:
          context.phase === "session_start"
            ? this.config.IMPORTANCE_THRESHOLD_SESSION_START
            : this.config.IMPORTANCE_THRESHOLD_DEFAULT,
        cooldown_applied: false,
      };
    }

    if (matchesHistoryReference(normalizedInput)) {
      return withIntent({
        hit: true,
        trigger_type: "history_reference",
        trigger_reason: runtimeMessages.historyReferenceReason,
        requested_memory_types: intentDecision?.requestedMemoryTypes ?? requestedMemoryTypes,
        memory_mode: memoryMode,
        requested_scopes: intentDecision?.requestedScopes ?? scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
        cooldown_applied: false,
      });
    }

    if (this.config.RECALL_LLM_JUDGE_ENABLED && this.recallSearchPlanner) {
      const llmDecision = await this.dependencyGuard.run(
        "memory_llm",
        this.config.MEMORY_LLM_TIMEOUT_MS,
        () =>
          this.recallSearchPlanner!.plan({
            context,
            memory_mode: memoryMode,
            requested_scopes: intentDecision?.requestedScopes ?? scopePlan.scopes,
            requested_memory_types: intentDecision?.requestedMemoryTypes ?? requestedMemoryTypes,
            semantic_score: undefined,
            semantic_threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD,
          }),
      );

      if (llmDecision.ok && llmDecision.value) {
        if (!llmDecision.value.should_search) {
          return {
            hit: false,
            trigger_type: "no_trigger",
            trigger_reason: llmDecision.value.reason,
            requested_memory_types: [],
            memory_mode: memoryMode,
            requested_scopes: intentDecision?.requestedScopes ?? scopePlan.scopes,
            scope_reason: scopePlan.reason,
            importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
            cooldown_applied: false,
            llm_used: true,
            llm_decision_reason: llmDecision.value.reason,
            intent_reason: intentDecision?.reason,
            intent_confidence: intentDecision?.confidence,
            intent_needs_memory: intentDecision?.needsMemory,
            intent_memory_types: intentDecision?.requestedMemoryTypes,
            intent_scopes: intentDecision?.requestedScopes,
            intent_plan_attempted: Boolean(intentDecision),
            intent_plan_degraded: intentDecision?.degraded,
            intent_plan_degradation_reason: intentDecision?.degradationReason,
            search_plan_attempted: true,
            search_plan_degraded: false,
          };
        }

        return {
          hit: true,
          trigger_type: "llm_recall_judge",
          trigger_reason: llmDecision.value.reason || runtimeMessages.llmCandidateScanReason,
          requested_memory_types:
            llmDecision.value.requested_memory_types?.length
              ? llmDecision.value.requested_memory_types
              : intentDecision?.requestedMemoryTypes ?? requestedMemoryTypes,
          memory_mode: memoryMode,
          requested_scopes:
            llmDecision.value.requested_scopes?.length
              ? dedupeScopes(llmDecision.value.requested_scopes)
              : intentDecision?.requestedScopes ?? scopePlan.scopes,
          scope_reason: scopePlan.reason,
          importance_threshold:
            llmDecision.value.importance_threshold ?? this.config.IMPORTANCE_THRESHOLD_DEFAULT,
          cooldown_applied: false,
          query_hint: llmDecision.value.query_hint,
          candidate_limit: llmDecision.value.candidate_limit,
          llm_used: true,
          llm_decision_reason: llmDecision.value.reason,
          intent_reason: intentDecision?.reason,
          intent_confidence: intentDecision?.confidence,
          intent_needs_memory: intentDecision?.needsMemory,
          intent_memory_types: intentDecision?.requestedMemoryTypes,
          intent_scopes: intentDecision?.requestedScopes,
          intent_plan_attempted: Boolean(intentDecision),
          intent_plan_degraded: intentDecision?.degraded,
          intent_plan_degradation_reason: intentDecision?.degradationReason,
          search_plan_attempted: true,
          search_plan_degraded: false,
        };
      }

      this.logger.warn(
        {
          phase: context.phase,
          reason: llmDecision.error?.message,
        },
        "llm recall search planner degraded, falling back to semantic trigger",
      );

      return {
        ...(await this.semanticFallbackDecision(
          context,
          memoryMode,
          intentDecision?.requestedScopes ?? scopePlan.scopes,
          intentDecision?.requestedMemoryTypes ?? requestedMemoryTypes,
          scopePlan.reason,
        )),
        intent_reason: intentDecision?.reason,
        intent_confidence: intentDecision?.confidence,
        intent_needs_memory: intentDecision?.needsMemory,
        intent_memory_types: intentDecision?.requestedMemoryTypes,
        intent_scopes: intentDecision?.requestedScopes,
        intent_plan_attempted: Boolean(intentDecision),
        intent_plan_degraded: intentDecision?.degraded,
        intent_plan_degradation_reason: intentDecision?.degradationReason,
        search_plan_attempted: true,
        search_plan_degraded: true,
        search_plan_degradation_reason: llmDecision.error?.code ?? "memory_llm_unavailable",
      };
    }

    if (shouldSkipForShortInput(context.current_input)) {
      return withIntent({
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.shortInputSkipReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: intentDecision?.requestedScopes ?? scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
        cooldown_applied: false,
      });
    }

    const semanticScore = await this.semanticFallbackScore(context, memoryMode, scopePlan.scopes);
    if (semanticScore.degraded) {
      return withIntent({
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.semanticDegradedReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: intentDecision?.requestedScopes ?? scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
        cooldown_applied: false,
        semantic_score: semanticScore.score,
        degraded: true,
        degradation_reason: semanticScore.degradation_reason,
        degraded_skip_reason: "trigger_dependencies_unavailable",
      });
    }

    if (semanticScore.score >= semanticScore.threshold) {
      return withIntent({
        hit: true,
        trigger_type: "semantic_fallback",
        trigger_reason: runtimeMessages.semanticFallbackReason,
        requested_memory_types: intentDecision?.requestedMemoryTypes ?? requestedMemoryTypes,
        memory_mode: memoryMode,
        requested_scopes: intentDecision?.requestedScopes ?? scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: this.config.IMPORTANCE_THRESHOLD_SEMANTIC,
        cooldown_applied: false,
        semantic_score: semanticScore.score,
      });
    }

    return withIntent({
      hit: false,
      trigger_type: "no_trigger",
      trigger_reason: runtimeMessages.noTriggerReason,
      requested_memory_types: [],
      memory_mode: memoryMode,
      requested_scopes: intentDecision?.requestedScopes ?? scopePlan.scopes,
      scope_reason: scopePlan.reason,
      importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
      cooldown_applied: false,
      semantic_score: semanticScore.score,
    });
  }

  private async semanticFallbackDecision(
    context: TriggerContext,
    memoryMode: MemoryMode,
    requestedScopes: ScopeType[],
    requestedMemoryTypes: MemoryType[],
    scopeReason: string,
  ): Promise<TriggerDecision> {
    if (shouldSkipForShortInput(context.current_input)) {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.shortInputSkipReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: requestedScopes,
        scope_reason: scopeReason,
        importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
        cooldown_applied: false,
      };
    }

    const semanticScore = await this.semanticFallbackScore(context, memoryMode, requestedScopes);
    if (semanticScore.degraded) {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.semanticDegradedReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: requestedScopes,
        scope_reason: scopeReason,
        importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
        cooldown_applied: false,
        semantic_score: semanticScore.score,
        degraded: true,
        degradation_reason: semanticScore.degradation_reason,
        degraded_skip_reason: "trigger_dependencies_unavailable",
      };
    }

    if (semanticScore.score >= semanticScore.threshold) {
      return {
        hit: true,
        trigger_type: "semantic_fallback",
        trigger_reason: runtimeMessages.semanticFallbackReason,
        requested_memory_types: requestedMemoryTypes,
        memory_mode: memoryMode,
        requested_scopes: requestedScopes,
        scope_reason: scopeReason,
        importance_threshold: this.config.IMPORTANCE_THRESHOLD_SEMANTIC,
        cooldown_applied: false,
        semantic_score: semanticScore.score,
      };
    }

    return {
      hit: false,
      trigger_type: "no_trigger",
      trigger_reason: runtimeMessages.noTriggerReason,
      requested_memory_types: [],
      memory_mode: memoryMode,
      requested_scopes: requestedScopes,
      scope_reason: scopeReason,
      importance_threshold: this.config.IMPORTANCE_THRESHOLD_DEFAULT,
      cooldown_applied: false,
      semantic_score: semanticScore.score,
    };
  }

  private async semanticFallbackScore(
    context: TriggerContext,
    memoryMode: MemoryMode,
    requestedScopes: ScopeType[],
  ): Promise<{
    score: number;
    threshold: number;
    degraded: boolean;
    degradation_reason?: string;
  }> {
    const queryText = normalizeText(context.current_input);
    if (!queryText) {
      return { score: 0, threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD, degraded: false };
    }

    const embeddingResult = await this.dependencyGuard.run(
      "embeddings",
      this.config.EMBEDDING_TIMEOUT_MS,
      (signal) => this.embeddingsClient.embedText(queryText, signal),
    );
    const sampleResult = await this.dependencyGuard.run(
      "read_model",
      this.config.QUERY_TIMEOUT_MS,
      (signal) =>
        this.readModelRepository.searchCandidates(
          {
            workspace_id: context.workspace_id,
            user_id: context.user_id,
            session_id: context.session_id,
            phase: context.phase,
            task_id: context.task_id,
            memory_mode: memoryMode,
            scope_filter: requestedScopes,
            memory_type_filter: ["fact_preference", "task_state", "episodic"],
            status_filter: ["active"],
            importance_threshold: this.config.IMPORTANCE_THRESHOLD_SEMANTIC,
            semantic_query_text: queryText,
            candidate_limit: 8,
          },
          signal,
        ),
    );

    if (!embeddingResult.ok || !sampleResult.ok) {
      this.logger.warn(
        {
          embeddingStatus: embeddingResult.status.status,
          sampleStatus: sampleResult.status.status,
        },
        "semantic fallback degraded",
      );
      return {
        score: 0,
        threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD,
        degraded: true,
        degradation_reason:
          embeddingResult.error?.code ??
          sampleResult.error?.code ??
          "dependency_unavailable",
      };
    }

    const queryEmbedding = embeddingResult.value ?? [];
    const samples = sampleResult.value ?? [];

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return { score: 0, threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD, degraded: false };
    }

    let best = 0;
    const scores: number[] = [];
    for (const sample of samples) {
      const embedding = sample.summary_embedding;
      if (!embedding || embedding.length !== queryEmbedding.length) {
        continue;
      }
      let dot = 0;
      let leftNorm = 0;
      let rightNorm = 0;
      for (let index = 0; index < embedding.length; index += 1) {
        const left = queryEmbedding[index] ?? 0;
        const right = embedding[index] ?? 0;
        dot += left * right;
        leftNorm += left * left;
        rightNorm += right * right;
      }
      if (leftNorm === 0 || rightNorm === 0) {
        continue;
      }
      const score = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
      scores.push(score);
      best = Math.max(best, score);
    }

    const sortedScores = scores.sort((left, right) => right - left);
    const median = sortedScores.length === 0 ? 0 : sortedScores[Math.floor(sortedScores.length / 2)] ?? 0;
    const threshold = Math.max(
      median + SEMANTIC_TRIGGER_MEDIAN_DELTA,
      this.config.SEMANTIC_TRIGGER_THRESHOLD * SEMANTIC_TRIGGER_FLOOR_RATIO,
    );

    return { score: best, threshold, degraded: false };
  }
}

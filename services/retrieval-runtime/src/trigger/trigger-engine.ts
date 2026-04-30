import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type {
  IntentAnalyzer,
  RecallSearchPlanner,
} from "../memory-orchestrator/index.js";
import type { EmbeddingsClient } from "../query/embeddings-client.js";
import type { ReadModelRepository } from "../query/read-model-repository.js";
import {
  phaseTriggerReason,
  runtimeMessages,
} from "../shared/messages.js";
import type {
  MemoryMode,
  MemoryType,
  ScopeType,
  TriggerContext,
  TriggerDecision,
} from "../shared/types.js";
import type { Logger } from "pino";
import {
  buildSemanticQueryTerms,
  clamp,
  cosineSimilarity,
  matchesHistoryReference,
  normalizeText,
} from "../shared/utils.js";
import {
  dedupeScopes,
  importanceThresholdByPhase,
  requestedTypesByPhase,
  scopePlanByPhase,
} from "./phase-plan.js";

export interface SemanticTriggerStats {
  best_score: number;
  top3_avg: number;
  above_count: number;
  sample_count: number;
  hit: boolean;
}

export interface SemanticTriggerDecisionConfig {
  semanticThreshold: number;
  bestScoreThreshold: number;
  top3AvgThreshold: number;
  aboveCountThreshold: number;
}

type SemanticFallbackScoreResult = {
  score: number;
  threshold: number;
  hit: boolean;
  degraded: boolean;
  degradation_reason?: string;
};

type SemanticFallbackPrefetch = Promise<SemanticFallbackScoreResult>;

type TimedOutResult = {
  ok: false;
  timedOut: true;
};

type CompletedResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  timedOut?: false;
};

export function evaluateSemanticTriggerStats(
  scores: number[],
  config: SemanticTriggerDecisionConfig,
): SemanticTriggerStats {
  const sortedScores = [...scores].sort((left, right) => right - left);
  const bestScore = sortedScores[0] ?? 0;
  const top3 = sortedScores.slice(0, 3);
  const top3Avg =
    top3.length === 0
      ? 0
      : top3.reduce((sum, score) => sum + score, 0) / top3.length;
  const aboveCount = scores.filter((score) => score >= config.semanticThreshold).length;
  const hit =
    bestScore >= config.bestScoreThreshold ||
    (
      top3Avg >= config.top3AvgThreshold &&
      aboveCount >= config.aboveCountThreshold
    );

  return {
    best_score: bestScore,
    top3_avg: top3Avg,
    above_count: aboveCount,
    sample_count: scores.length,
    hit,
  };
}

function shouldSkipForShortInput(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.length < 8 && !matchesHistoryReference(normalized) && !hasPreferenceOrTaskStateSignal(normalized);
}

function hasPreferenceOrTaskStateSignal(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return false;
  }

  const signalPatterns = [
    /按(之前|先前|上次|原来|原先|原来的)?(约定|要求|风格|习惯|规则|偏好)/,
    /(继续|接着|延续)(推进|做|写|改|处理|上次|之前)/,
    /默认(用|按照|保持)/,
    /风格(要求|约定|保持|来)/,
    /偏好/,
    /继续(这个|这个任务|这个方案|这个方向|这个模块)/,
    /下一步(怎么做|做什么|是什么)/,
    /按照?(之前|上次)的(方案|计划|约定|结论|方向)/,
    /按(边界|约束|规则)来/,
    /会话存储|记忆面板|权限网关/,
  ];

  return signalPatterns.some((pattern) => pattern.test(normalized));
}

function waitForLimitedResult<T>(promise: Promise<T>, timeoutMs: number): Promise<CompletedResult<T> | TimedOutResult> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  return Promise.race([
    promise.then(
      (value): CompletedResult<T> => ({ ok: true, value }),
      (): CompletedResult<T> => ({ ok: false }),
    ),
    new Promise<TimedOutResult>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
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
    const defaultScopePlan = scopePlanByPhase(
      context.phase,
      Boolean(context.task_id),
      memoryMode,
    );
    const scopePlan = context.preflight_scopes
      ? {
          scopes: context.preflight_scopes,
          reason: defaultScopePlan.reason,
        }
      : defaultScopePlan;
    const baseImportanceThreshold =
      context.preflight_importance_threshold ?? importanceThresholdByPhase(context.phase, this.config);

    if (context.phase === "after_response") {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.afterResponseReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: [],
        scope_reason: scopePlan.reason,
        importance_threshold: baseImportanceThreshold,
        cooldown_applied: false,
      };
    }

    const normalizedInput = normalizeText(context.current_input).toLowerCase();
    const requestedMemoryTypes = context.preflight_memory_types ?? requestedTypesByPhase(context.phase);
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

    if (
      this.intentAnalyzer &&
      context.phase === "before_response" &&
      (!this.config.RECALL_LLM_JUDGE_ENABLED ||
        !this.recallSearchPlanner ||
        matchesHistoryReference(normalizedInput))
    ) {
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
            intentResult.value.suggested_scopes &&
            intentResult.value.suggested_scopes.length > 0
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
          degradationReason:
            intentResult.error?.code ?? "memory_llm_unavailable",
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
    const constrainTypes = (types: MemoryType[]) => {
      const constrained = types.filter((type) => requestedMemoryTypes.includes(type));
      return constrained.length > 0 ? constrained : requestedMemoryTypes;
    };
    const constrainScopes = (scopes: ScopeType[]) => {
      const constrained = scopes.filter((scope) => scopePlan.scopes.includes(scope));
      return constrained.length > 0 ? constrained : scopePlan.scopes;
    };
    const preservePreferenceRecall =
      context.phase === "before_response" &&
      intentDecision?.needsMemory === false &&
      hasPreferenceOrTaskStateSignal(context.current_input);
    const intentScopesForSearch = constrainScopes(
      preservePreferenceRecall
        ? scopePlan.scopes
        : intentDecision?.needsMemory === false
          ? scopePlan.scopes
          : (intentDecision?.requestedScopes ?? scopePlan.scopes),
    );
    const intentTypesForSearch = constrainTypes(
      preservePreferenceRecall
        ? [
            ...new Set([
              "fact_preference" as const,
              "task_state" as const,
              ...requestedMemoryTypes,
              ...(intentDecision?.requestedMemoryTypes ?? []),
            ]),
          ]
        : intentDecision?.needsMemory === false
          ? requestedMemoryTypes
          : (intentDecision?.requestedMemoryTypes ?? requestedMemoryTypes),
    );

    if (context.phase !== "before_response") {
      return {
        hit: true,
        trigger_type: "phase",
        trigger_reason: phaseTriggerReason(context.phase),
        requested_memory_types: requestedMemoryTypes,
        memory_mode: memoryMode,
        requested_scopes: scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: baseImportanceThreshold,
        cooldown_applied: false,
      };
    }

    if (matchesHistoryReference(normalizedInput)) {
      return withIntent({
        hit: true,
        trigger_type: "history_reference",
        trigger_reason: runtimeMessages.historyReferenceReason,
        requested_memory_types: intentTypesForSearch,
        memory_mode: memoryMode,
        requested_scopes: intentScopesForSearch,
        scope_reason: scopePlan.reason,
        importance_threshold: baseImportanceThreshold,
        cooldown_applied: false,
      });
    }

    if (this.config.RECALL_LLM_JUDGE_ENABLED && this.recallSearchPlanner) {
      const semanticPrefetch = this.config.RECALL_SEMANTIC_PREFETCH_ENABLED
        ? this.semanticFallbackScorePrefetch(context, memoryMode, intentScopesForSearch)
        : undefined;
      const llmDecisionPromise = this.dependencyGuard.run(
        "memory_llm",
        this.config.MEMORY_LLM_TIMEOUT_MS,
        () =>
          this.recallSearchPlanner!.plan({
            context,
            memory_mode: memoryMode,
            requested_scopes: intentScopesForSearch,
            requested_memory_types: intentTypesForSearch,
            semantic_score: undefined,
            semantic_threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD,
          }),
      );
      const limitedLlmDecision = await waitForLimitedResult(
        llmDecisionPromise,
        this.config.RECALL_LLM_JUDGE_WAIT_MS,
      );
      const llmWaitTimedOut = !limitedLlmDecision.ok && limitedLlmDecision.timedOut === true;
      const llmDecision = limitedLlmDecision.ok ? limitedLlmDecision.value : undefined;

      if (llmDecision?.ok && llmDecision.value) {
        const plannerNeedsMemory = llmDecision.value.needs_memory ?? llmDecision.value.should_search;
        const plannerIntentConfidence = llmDecision.value.intent_confidence ?? (plannerNeedsMemory ? 0.8 : 0.6);
        const plannerIntentReason = llmDecision.value.intent_reason ?? llmDecision.value.reason;
        const rawPlannerRequestedMemoryTypes = llmDecision.value.requested_memory_types
          ?.length
            ? llmDecision.value.requested_memory_types
            : intentTypesForSearch;
        const plannerRequestedMemoryTypes =
          rawPlannerRequestedMemoryTypes.filter((type) => intentTypesForSearch.includes(type));
        const rawPlannerRequestedScopes = llmDecision.value.requested_scopes?.length
          ? dedupeScopes(llmDecision.value.requested_scopes)
          : intentScopesForSearch;
        const plannerRequestedScopes =
          rawPlannerRequestedScopes.filter((scope) => intentScopesForSearch.includes(scope));
        const effectivePlannerTypes =
          plannerRequestedMemoryTypes.length > 0 ? plannerRequestedMemoryTypes : intentTypesForSearch;
        const effectivePlannerScopes =
          plannerRequestedScopes.length > 0 ? plannerRequestedScopes : intentScopesForSearch;

        if (!llmDecision.value.should_search) {
          return {
            hit: false,
            trigger_type: "no_trigger",
            trigger_reason: llmDecision.value.reason,
            requested_memory_types: [],
            memory_mode: memoryMode,
            requested_scopes: intentScopesForSearch,
            scope_reason: scopePlan.reason,
            importance_threshold: baseImportanceThreshold,
            cooldown_applied: false,
            llm_used: true,
            llm_decision_reason: llmDecision.value.reason,
            intent_reason: plannerIntentReason,
            intent_confidence: plannerIntentConfidence,
            intent_needs_memory: plannerNeedsMemory,
            intent_memory_types: effectivePlannerTypes,
            intent_scopes: effectivePlannerScopes,
            intent_plan_attempted: true,
            intent_plan_degraded: false,
            search_plan_attempted: true,
            search_plan_degraded: false,
          };
        }

        return {
          hit: true,
          trigger_type: "llm_recall_judge",
          trigger_reason:
            llmDecision.value.reason || runtimeMessages.llmCandidateScanReason,
          requested_memory_types: effectivePlannerTypes,
          memory_mode: memoryMode,
          requested_scopes: effectivePlannerScopes,
          scope_reason: scopePlan.reason,
          importance_threshold:
            llmDecision.value.importance_threshold ??
            baseImportanceThreshold,
          cooldown_applied: false,
          query_hint: llmDecision.value.query_hint,
          candidate_limit: llmDecision.value.candidate_limit,
          llm_used: true,
          llm_decision_reason: llmDecision.value.reason,
          intent_reason: plannerIntentReason,
          intent_confidence: plannerIntentConfidence,
          intent_needs_memory: plannerNeedsMemory,
          intent_memory_types: effectivePlannerTypes,
          intent_scopes: effectivePlannerScopes,
          intent_plan_attempted: true,
          intent_plan_degraded: false,
          search_plan_attempted: true,
          search_plan_degraded: false,
        };
      }

      this.logger.warn(
        {
          phase: context.phase,
          reason:
            llmWaitTimedOut
              ? `recall search planner exceeded ${this.config.RECALL_LLM_JUDGE_WAIT_MS}ms wait budget`
              : llmDecision?.error?.message,
        },
        "llm recall search planner degraded, falling back to semantic trigger",
      );
      const searchPlanDegradationReason =
        llmWaitTimedOut
          ? "memory_llm_wait_timeout"
          : llmDecision?.error?.code ?? "memory_llm_unavailable";

      return {
        ...(await this.semanticFallbackDecision(
          context,
          memoryMode,
          intentScopesForSearch,
          intentTypesForSearch,
          scopePlan.reason,
          semanticPrefetch,
        )),
        intent_reason: intentDecision?.reason ?? (llmWaitTimedOut ? "recall_planner_wait_timeout" : "recall_planner_unavailable"),
        intent_confidence: intentDecision?.confidence ?? 0,
        intent_needs_memory: intentDecision?.needsMemory ?? true,
        intent_memory_types: intentDecision?.requestedMemoryTypes ?? intentTypesForSearch,
        intent_scopes: intentDecision?.requestedScopes ?? intentScopesForSearch,
        intent_plan_attempted: true,
        intent_plan_degraded: true,
        intent_plan_degradation_reason:
          intentDecision?.degradationReason ??
          searchPlanDegradationReason,
        search_plan_attempted: true,
        search_plan_degraded: true,
        search_plan_degradation_reason: searchPlanDegradationReason,
      };
    }

    if (shouldSkipForShortInput(context.current_input)) {
      return withIntent({
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.shortInputSkipReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: intentScopesForSearch,
        scope_reason: scopePlan.reason,
        importance_threshold: baseImportanceThreshold,
        cooldown_applied: false,
      });
    }

    const semanticScore = await this.semanticFallbackScore(
      context,
      memoryMode,
      scopePlan.scopes,
    );
    if (semanticScore.degraded) {
      return withIntent({
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.semanticDegradedReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: intentScopesForSearch,
        scope_reason: scopePlan.reason,
        importance_threshold: baseImportanceThreshold,
        cooldown_applied: false,
        semantic_score: semanticScore.score,
        degraded: true,
        degradation_reason: semanticScore.degradation_reason,
        degraded_skip_reason: "trigger_dependencies_unavailable",
      });
    }

    if (semanticScore.hit) {
      return withIntent({
        hit: true,
        trigger_type: "semantic_fallback",
        trigger_reason: runtimeMessages.semanticFallbackReason,
        requested_memory_types: intentTypesForSearch,
        memory_mode: memoryMode,
        requested_scopes: intentScopesForSearch,
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
      requested_scopes: intentScopesForSearch,
      scope_reason: scopePlan.reason,
      importance_threshold: baseImportanceThreshold,
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
    semanticPrefetch?: SemanticFallbackPrefetch,
  ): Promise<TriggerDecision> {
    const baseImportanceThreshold =
      context.preflight_importance_threshold ?? this.config.IMPORTANCE_THRESHOLD_DEFAULT;
    if (shouldSkipForShortInput(context.current_input)) {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.shortInputSkipReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: requestedScopes,
        scope_reason: scopeReason,
        importance_threshold: baseImportanceThreshold,
        cooldown_applied: false,
      };
    }

    const semanticScore = await (
      semanticPrefetch ??
      this.semanticFallbackScore(context, memoryMode, requestedScopes)
    );
    if (semanticScore.degraded) {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: runtimeMessages.semanticDegradedReason,
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: requestedScopes,
        scope_reason: scopeReason,
        importance_threshold: baseImportanceThreshold,
        cooldown_applied: false,
        semantic_score: semanticScore.score,
        degraded: true,
        degradation_reason: semanticScore.degradation_reason,
        degraded_skip_reason: "trigger_dependencies_unavailable",
      };
    }

    if (semanticScore.hit) {
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
      importance_threshold: baseImportanceThreshold,
      cooldown_applied: false,
      semantic_score: semanticScore.score,
    };
  }

  private semanticFallbackScorePrefetch(
    context: TriggerContext,
    memoryMode: MemoryMode,
    requestedScopes: ScopeType[],
  ): SemanticFallbackPrefetch {
    return this.semanticFallbackScore(context, memoryMode, requestedScopes).catch((error: unknown) => {
      this.logger.warn(
        {
          phase: context.phase,
          reason: error instanceof Error ? error.message : String(error),
        },
        "semantic fallback prefetch failed",
      );
      return {
        score: 0,
        threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD,
        hit: false,
        degraded: true,
        degradation_reason: "dependency_unavailable",
      };
    });
  }

  private async semanticFallbackScore(
    context: TriggerContext,
    memoryMode: MemoryMode,
    requestedScopes: ScopeType[],
  ): Promise<{
    score: number;
    threshold: number;
    hit: boolean;
    degraded: boolean;
    degradation_reason?: string;
  }> {
    const queryText = normalizeText(context.current_input);
    if (!queryText) {
      return {
        score: 0,
        threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD,
        hit: false,
        degraded: false,
      };
    }

    const embeddingResult = await this.dependencyGuard.run(
      "embeddings",
      this.config.EMBEDDING_TIMEOUT_MS,
      (signal) => this.embeddingsClient.embedText(queryText, signal),
    );
    const queryEmbedding = embeddingResult.ok && Array.isArray(embeddingResult.value)
      ? embeddingResult.value
      : [];
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
            memory_type_filter: context.preflight_memory_types ?? ["fact_preference", "task_state", "episodic"],
            status_filter: ["active"],
            importance_threshold: this.config.IMPORTANCE_THRESHOLD_SEMANTIC,
            semantic_query_text: queryText,
            semantic_query_terms: buildSemanticQueryTerms(queryText),
            semantic_query_embedding: queryEmbedding.length > 0 ? queryEmbedding : undefined,
            candidate_limit: this.config.SEMANTIC_TRIGGER_CANDIDATE_LIMIT,
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
        hit: false,
        degraded: true,
        degradation_reason:
          embeddingResult.error?.code ??
          sampleResult.error?.code ??
          "dependency_unavailable",
      };
    }

    const samples = sampleResult.value ?? [];

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return {
        score: 0,
        threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD,
        hit: false,
        degraded: false,
      };
    }

    const scores: number[] = [];
    for (const sample of samples) {
      const embedding = sample.summary_embedding;
      if (!embedding || embedding.length !== queryEmbedding.length) {
        continue;
      }
      scores.push(clamp(cosineSimilarity(queryEmbedding, embedding), 0, 1));
    }

    const stats = evaluateSemanticTriggerStats(scores, {
      semanticThreshold: this.config.SEMANTIC_TRIGGER_THRESHOLD,
      bestScoreThreshold: this.config.SEMANTIC_TRIGGER_BEST_SCORE_THRESHOLD,
      top3AvgThreshold: this.config.SEMANTIC_TRIGGER_TOP3_AVG_THRESHOLD,
      aboveCountThreshold: this.config.SEMANTIC_TRIGGER_ABOVE_COUNT_THRESHOLD,
    });

    return {
      score: stats.best_score,
      threshold: this.config.SEMANTIC_TRIGGER_THRESHOLD,
      hit: stats.hit,
      degraded: false,
    };
  }
}

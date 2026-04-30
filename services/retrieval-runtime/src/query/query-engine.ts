import { createHash } from "node:crypto";

import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import { SmallCache } from "../shared/small-cache.js";
import type {
  CandidateMemory,
  PhaseScoringWeights,
  ReadModelAvailabilityQuery,
  RetrievalQuery,
  ScopeType,
  TriggerContext,
  TriggerDecision,
} from "../shared/types.js";
import {
  buildSemanticQueryTerms,
  clamp,
  cosineSimilarity,
  normalizeText,
  tokenizeForOverlap,
  truncateFromTail,
} from "../shared/utils.js";
import type { EmbeddingsClient } from "./embeddings-client.js";
import type { ReadModelRepository } from "./read-model-repository.js";

export interface QueryEngineResult {
  query: RetrievalQuery;
  candidates: CandidateMemory[];
  degraded: boolean;
  degradation_reason?: string;
}

const RECENCY_HALF_LIFE_DAYS: Record<CandidateMemory["memory_type"], number> = {
  fact_preference: 180,
  task_state: 30,
  episodic: 14,
};
const OPEN_CONFLICT_SCORE_PENALTY = 0.2;
const QUERY_CANDIDATE_CACHE_TTL_MS = 30_000;
const QUERY_CANDIDATE_CACHE_MAX_ENTRIES = 500;

function recencyScore(updatedAt: string, memoryType: CandidateMemory["memory_type"]): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  const halfLife = RECENCY_HALF_LIFE_DAYS[memoryType];
  return clamp(Math.pow(2, -days / halfLife), 0, 1);
}

function scopeBoost(scope: ScopeType, context: TriggerContext): number {
  if (scope === "session") {
    return 0.95;
  }
  if (scope === "workspace") {
    return 0.9;
  }
  if (context.task_id && scope === "task") {
    return 1;
  }
  if (scope === "user") {
    return 0.8;
  }
  return 0.6;
}

function fallbackSemanticScore(queryText: string, candidateSummary: string): number {
  const queryTokens = new Set(tokenizeForOverlap(queryText));
  const candidateTokens = new Set(tokenizeForOverlap(candidateSummary));

  if (queryTokens.size === 0 || candidateTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }

  return clamp(overlap / queryTokens.size, 0, 1);
}

export function applyOpenConflictPenalty(
  candidate: Pick<CandidateMemory, "has_open_conflict">,
  score: number,
): number {
  if (!candidate.has_open_conflict) {
    return score;
  }

  return clamp(score - OPEN_CONFLICT_SCORE_PENALTY, 0, 1);
}

export function compareRankedCandidates(left: CandidateMemory, right: CandidateMemory): number {
  const leftScore = left.rerank_score ?? 0;
  const rightScore = right.rerank_score ?? 0;
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  if (Boolean(left.has_open_conflict) !== Boolean(right.has_open_conflict)) {
    return Number(left.has_open_conflict) - Number(right.has_open_conflict);
  }

  if (left.importance !== right.importance) {
    return right.importance - left.importance;
  }

  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }

  return Date.parse(right.updated_at) - Date.parse(left.updated_at);
}

function weightsByPhase(phase: TriggerContext["phase"]): PhaseScoringWeights {
  switch (phase) {
    case "session_start":
      return { semantic: 0.1, importance: 0.35, confidence: 0.2, recency: 0.05, scope: 0.3 };
    case "task_start":
    case "task_switch":
      return { semantic: 0.3, importance: 0.3, confidence: 0.15, recency: 0.1, scope: 0.15 };
    case "before_plan":
      return { semantic: 0.35, importance: 0.25, confidence: 0.15, recency: 0.15, scope: 0.1 };
    case "before_response":
      return { semantic: 0.5, importance: 0.2, confidence: 0.15, recency: 0.1, scope: 0.05 };
    case "after_response":
      return { semantic: 0.45, importance: 0.25, confidence: 0.15, recency: 0.1, scope: 0.05 };
  }
}

function buildSemanticQueryText(context: TriggerContext): string {
  const currentInput = truncateFromTail(context.current_input, 512);
  const recentContextSummary = truncateFromTail(context.recent_context_summary, 512);
  const recallExpansion = buildRecallQueryExpansion(currentInput);
  return truncateFromTail(
    normalizeText([currentInput, recallExpansion, recentContextSummary].filter(Boolean).join("\n")),
    1024,
  );
}

function buildRecallQueryExpansion(currentInput: string): string {
  const normalized = normalizeText(currentInput);
  const isAskingAboutAssistantIdentity = [
    /你.{0,6}是(谁|什么|啥)/u,
    /你.{0,8}叫.{0,8}(什么|啥|哪个|谁)/u,
    /叫.{0,8}你.{0,8}(什么|啥|哪个|谁)/u,
    /让你.{0,8}叫/u,
    /称呼.{0,8}你/u,
    /你.{0,6}(名字|昵称|称呼)/u,
  ].some((pattern) => pattern.test(normalized));

  if (!isAskingAboutAssistantIdentity) {
    return "";
  }

  return "用户希望助手以后叫 用户给助手的称呼 助手名字 助手昵称 以后叫";
}

function stableArray<T extends string>(values: T[]): T[] {
  return [...values].sort();
}

function embeddingHash(embedding?: number[]) {
  if (!embedding || embedding.length === 0) {
    return null;
  }
  return createHash("sha1").update(JSON.stringify(embedding)).digest("hex");
}

function queryCandidateCacheKey(query: RetrievalQuery) {
  return JSON.stringify({
    workspace_id: query.workspace_id,
    user_id: query.user_id,
    session_id: query.session_id,
    task_id: query.task_id ?? null,
    memory_mode: query.memory_mode,
    scope_filter: stableArray(query.scope_filter),
    memory_type_filter: stableArray(query.memory_type_filter),
    status_filter: stableArray(query.status_filter),
    importance_threshold: query.importance_threshold,
    semantic_query_text: normalizeText(query.semantic_query_text),
    semantic_query_terms: stableArray(query.semantic_query_terms ?? []),
    semantic_query_embedding: embeddingHash(query.semantic_query_embedding),
    candidate_limit: query.candidate_limit,
  });
}

export function buildRetrievalQuery(
  context: TriggerContext,
  decision: TriggerDecision,
  config: AppConfig,
): RetrievalQuery {
  const candidateLimit = Math.max(
    decision.candidate_limit ?? 0,
    config.QUERY_CANDIDATE_LIMIT,
    config.RECALL_LLM_CANDIDATE_LIMIT ?? 0,
    config.PACKET_RECORD_LIMIT,
  );

  return {
    workspace_id: context.workspace_id,
    user_id: context.user_id,
    session_id: context.session_id,
    phase: context.phase,
    task_id: context.task_id,
    memory_mode: decision.memory_mode,
    scope_filter: decision.requested_scopes,
    memory_type_filter: decision.requested_memory_types,
    status_filter: ["active"],
    importance_threshold: decision.importance_threshold,
    semantic_query_text: decision.query_hint?.trim() ? decision.query_hint : buildSemanticQueryText(context),
    candidate_limit: candidateLimit,
  };
}

export class QueryEngine {
  private readonly candidateCache = new SmallCache<string, CandidateMemory[]>({
    ttlMs: QUERY_CANDIDATE_CACHE_TTL_MS,
    maxEntries: QUERY_CANDIDATE_CACHE_MAX_ENTRIES,
  });

  constructor(
    private readonly config: AppConfig,
    private readonly repository: ReadModelRepository,
    private readonly embeddingsClient: EmbeddingsClient,
    private readonly dependencyGuard: DependencyGuard,
    private readonly logger: Logger,
  ) {}

  async estimateAvailability(query: ReadModelAvailabilityQuery, signal?: AbortSignal) {
    return this.repository.estimateAvailability(query, signal);
  }

  async query(context: TriggerContext, decision: TriggerDecision): Promise<QueryEngineResult> {
    const query = buildRetrievalQuery(context, decision, this.config);
    const startedAt = Date.now();
    const embeddingsResult = await this.dependencyGuard.run(
      "embeddings",
      this.config.EMBEDDING_TIMEOUT_MS,
      (signal) => this.embeddingsClient.embedText(query.semantic_query_text, signal),
    );
    let degraded = false;
    let degradationReason: string | undefined;
    let queryEmbedding: number[] | undefined;

    if (embeddingsResult.ok) {
      queryEmbedding = embeddingsResult.value;
    } else {
      degraded = true;
      degradationReason = embeddingsResult.error?.code ?? "embedding_unavailable";
    }

    const contextualQuery = {
      ...query,
      semantic_query_terms: buildSemanticQueryTerms(query.semantic_query_text),
      semantic_query_embedding: queryEmbedding,
    };

    const cacheKey = queryCandidateCacheKey(contextualQuery);
    let baseCandidates = this.candidateCache.get(cacheKey);

    if (!baseCandidates) {
      const readModelResult = await this.dependencyGuard.run("read_model", this.config.QUERY_TIMEOUT_MS, (signal) =>
        this.repository.searchCandidates(contextualQuery, signal),
      );

      if (!readModelResult.ok) {
        return {
          query: contextualQuery,
          candidates: [],
          degraded: true,
          degradation_reason: readModelResult.error?.code ?? "dependency_unavailable",
        };
      }

      baseCandidates = readModelResult.value ?? [];
      this.candidateCache.set(cacheKey, baseCandidates);
    }

    if (baseCandidates.length === 0) {
      return { query: contextualQuery, candidates: [], degraded: false };
    }

    const maxRankedCandidates = Math.max(
      this.config.PACKET_RECORD_LIMIT,
      this.config.RECALL_LLM_CANDIDATE_LIMIT ?? this.config.QUERY_CANDIDATE_LIMIT,
    );

    const ranked = baseCandidates
      .map((candidate) => {
        const vectorSemanticScore =
          queryEmbedding && candidate.summary_embedding
            ? clamp(cosineSimilarity(queryEmbedding, candidate.summary_embedding), 0, 1)
            : 0;
        const lexicalFallbackScore =
          !candidate.summary_embedding || candidate.embedding_status === "pending" || candidate.embedding_status === "failed"
            ? fallbackSemanticScore(contextualQuery.semantic_query_text, candidate.summary)
            : 0;
        const semanticScore = vectorSemanticScore > 0 ? vectorSemanticScore : lexicalFallbackScore;
        const weights = weightsByPhase(context.phase);
        const score =
          semanticScore * weights.semantic +
          clamp(candidate.importance / 5, 0, 1) * weights.importance +
          clamp(candidate.confidence, 0, 1) * weights.confidence +
          recencyScore(candidate.updated_at, candidate.memory_type) * weights.recency +
          scopeBoost(candidate.scope, context) * weights.scope;
        const rerankScore = applyOpenConflictPenalty(candidate, score);

        return {
          ...candidate,
          semantic_score: semanticScore,
          fallback_semantic_score: lexicalFallbackScore > 0 ? lexicalFallbackScore : undefined,
          rerank_score: rerankScore,
        };
      })
      .sort(compareRankedCandidates)
      .slice(0, maxRankedCandidates);

    this.logger.debug(
      {
        turn_id: context.turn_id,
        candidate_count: ranked.length,
        duration_ms: Date.now() - startedAt,
      },
      "query engine ranked candidates",
    );

    return {
      query: contextualQuery,
      candidates: ranked,
      degraded,
      degradation_reason: degradationReason,
    };
  }
}

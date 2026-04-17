import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { CandidateMemory, RetrievalQuery, ScopeType, TriggerContext, TriggerDecision } from "../shared/types.js";
import { clamp, cosineSimilarity, normalizeText } from "../shared/utils.js";
import type { EmbeddingsClient } from "./embeddings-client.js";
import type { ReadModelRepository } from "./read-model-repository.js";

export interface QueryEngineResult {
  query: RetrievalQuery;
  candidates: CandidateMemory[];
  degraded: boolean;
  degradation_reason?: string;
}

function recencyScore(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  return clamp(1 - days / 30, 0, 1);
}

function scopeBoost(scope: ScopeType, context: TriggerContext): number {
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

export function buildRetrievalQuery(
  context: TriggerContext,
  decision: TriggerDecision,
  config: AppConfig,
): RetrievalQuery {
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
    semantic_query_text: normalizeText(
      [context.current_input, context.recent_context_summary].filter(Boolean).join("\n"),
    ),
    candidate_limit: config.QUERY_CANDIDATE_LIMIT,
  };
}

export class QueryEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly repository: ReadModelRepository,
    private readonly embeddingsClient: EmbeddingsClient,
    private readonly dependencyGuard: DependencyGuard,
    private readonly logger: Logger,
  ) {}

  async query(context: TriggerContext, decision: TriggerDecision): Promise<QueryEngineResult> {
    const query = buildRetrievalQuery(context, decision, this.config);
    const startedAt = Date.now();

    const readModelResult = await this.dependencyGuard.run("read_model", this.config.QUERY_TIMEOUT_MS, (signal) =>
      this.repository.searchCandidates(query, signal),
    );

    if (!readModelResult.ok) {
      return {
        query,
        candidates: [],
        degraded: true,
        degradation_reason: readModelResult.error?.code ?? "dependency_unavailable",
      };
    }

    const baseCandidates = readModelResult.value ?? [];
    if (baseCandidates.length === 0) {
      return { query, candidates: [], degraded: false };
    }

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

    const ranked = baseCandidates
      .map((candidate) => {
        const semanticScore =
          queryEmbedding && candidate.summary_embedding
            ? clamp(cosineSimilarity(queryEmbedding, candidate.summary_embedding), 0, 1)
            : 0;
        const score =
          semanticScore * 0.45 +
          clamp(candidate.importance / 5, 0, 1) * 0.25 +
          clamp(candidate.confidence, 0, 1) * 0.15 +
          recencyScore(candidate.updated_at) * 0.1 +
          scopeBoost(candidate.scope, context) * 0.05;

        return {
          ...candidate,
          semantic_score: semanticScore,
          rerank_score: score,
        };
      })
      .sort((left, right) => (right.rerank_score ?? 0) - (left.rerank_score ?? 0))
      .slice(0, this.config.PACKET_RECORD_LIMIT);

    this.logger.debug(
      {
        trace: context.turn_id,
        candidateCount: ranked.length,
        durationMs: Date.now() - startedAt,
      },
      "query engine ranked candidates",
    );

    return {
      query,
      candidates: ranked,
      degraded,
      degradation_reason: degradationReason,
    };
  }
}

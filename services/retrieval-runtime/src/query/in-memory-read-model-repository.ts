import type { CandidateMemory, RetrievalQuery } from "../shared/types.js";
import { clamp, cosineSimilarity, normalizeText } from "../shared/utils.js";
import type { ReadModelRepository } from "./read-model-repository.js";

function lexicalContextScore(query: RetrievalQuery, summary: string): number {
  const terms = query.semantic_query_terms ?? [];
  if (terms.length === 0) {
    return 0;
  }

  const normalizedSummary = normalizeText(summary).toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (normalizedSummary.includes(term.toLowerCase())) {
      hits += 1;
    }
  }

  return clamp(hits / terms.length, 0, 1);
}

function vectorContextScore(query: RetrievalQuery, record: CandidateMemory): number {
  if (!query.semantic_query_embedding || !record.summary_embedding) {
    return 0;
  }

  return clamp(cosineSimilarity(query.semantic_query_embedding, record.summary_embedding), 0, 1);
}

function compareContextualCandidates(query: RetrievalQuery) {
  return (left: CandidateMemory, right: CandidateMemory): number => {
    const leftLexical = lexicalContextScore(query, left.summary);
    const rightLexical = lexicalContextScore(query, right.summary);
    const leftVector = vectorContextScore(query, left);
    const rightVector = vectorContextScore(query, right);
    const leftContext = Math.max(leftLexical, leftVector);
    const rightContext = Math.max(rightLexical, rightVector);

    if (rightContext !== leftContext) {
      return rightContext - leftContext;
    }
    if (rightLexical !== leftLexical) {
      return rightLexical - leftLexical;
    }
    if (rightVector !== leftVector) {
      return rightVector - leftVector;
    }
    if (left.importance !== right.importance) {
      return right.importance - left.importance;
    }
    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }

    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  };
}

export class InMemoryReadModelRepository implements ReadModelRepository {
  constructor(private readonly records: CandidateMemory[]) {}

  async searchCandidates(query: RetrievalQuery, signal?: AbortSignal): Promise<CandidateMemory[]> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "aborted"));
    }

    return this.records
      .filter((record) => query.status_filter.includes(record.status))
      .filter((record) => query.scope_filter.includes(record.scope))
      .filter((record) => {
        if (record.scope === "workspace") {
          return record.workspace_id === query.workspace_id;
        }
        if (record.scope === "user") {
          return record.user_id === query.user_id;
        }
        if (record.scope === "task") {
          return record.workspace_id === query.workspace_id && Boolean(query.task_id) && record.task_id === query.task_id;
        }
        if (record.scope === "session") {
          return record.workspace_id === query.workspace_id && record.session_id === query.session_id;
        }
        return false;
      })
      .filter((record) => query.memory_type_filter.includes(record.memory_type))
      .filter((record) => record.importance >= query.importance_threshold)
      .sort(compareContextualCandidates(query))
      .slice(0, query.candidate_limit);
  }
}

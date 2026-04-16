import type { CandidateMemory, RetrievalQuery } from "../shared/types.js";
import type { ReadModelRepository } from "./read-model-repository.js";

export class InMemoryReadModelRepository implements ReadModelRepository {
  constructor(private readonly records: CandidateMemory[]) {}

  async searchCandidates(query: RetrievalQuery, signal?: AbortSignal): Promise<CandidateMemory[]> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "aborted"));
    }

    return this.records
      .filter((record) => record.workspace_id === query.workspace_id)
      .filter((record) => record.user_id === query.user_id)
      .filter((record) => query.status_filter.includes(record.status))
      .filter((record) => query.scope_filter.includes(record.scope))
      .filter((record) => query.memory_type_filter.includes(record.memory_type))
      .filter((record) => (query.task_id ? record.task_id === query.task_id || record.scope !== "task" : true))
      .filter((record) => record.importance >= query.importance_threshold)
      .slice(0, query.candidate_limit);
  }
}

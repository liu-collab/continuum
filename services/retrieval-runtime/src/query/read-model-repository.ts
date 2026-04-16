import type { CandidateMemory, RetrievalQuery } from "../shared/types.js";

export interface ReadModelRepository {
  searchCandidates(query: RetrievalQuery, signal?: AbortSignal): Promise<CandidateMemory[]>;
}

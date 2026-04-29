import type { CandidateMemory, ReadModelAvailability, ReadModelAvailabilityQuery, RetrievalQuery } from "../shared/types.js";

export interface ReadModelRepository {
  estimateAvailability(query: ReadModelAvailabilityQuery, signal?: AbortSignal): Promise<ReadModelAvailability>;
  searchCandidates(query: RetrievalQuery, signal?: AbortSignal): Promise<CandidateMemory[]>;
}

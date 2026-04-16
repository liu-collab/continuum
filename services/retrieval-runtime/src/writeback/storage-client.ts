import type { AppConfig } from "../config.js";
import type { SubmittedWriteBackJob, WriteBackCandidate } from "../shared/types.js";

export interface StorageWritebackClient {
  submitCandidates(
    candidates: WriteBackCandidate[],
    signal?: AbortSignal,
  ): Promise<SubmittedWriteBackJob[]>;
}

export class HttpStorageWritebackClient implements StorageWritebackClient {
  constructor(private readonly config: AppConfig) {}

  async submitCandidates(
    candidates: WriteBackCandidate[],
    signal?: AbortSignal,
  ): Promise<SubmittedWriteBackJob[]> {
    const response = await fetch(new URL("/v1/storage/write-back-candidates", this.config.STORAGE_WRITEBACK_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        candidates,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`storage writeback failed with ${response.status}`);
    }

    const payload = (await response.json()) as { submitted_jobs?: SubmittedWriteBackJob[] };
    return payload.submitted_jobs ?? [];
  }
}

import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";
import { createStorageService } from "../src/services.js";
import { buildRecordFromNormalized } from "../src/db/repositories.js";
import { normalizeCandidate } from "../src/domain/normalizer.js";
import { JobWorker } from "../src/jobs/job-worker.js";
import { createMemoryRepositories, buildCandidate } from "./memory-repositories.js";

describe("governance flow", () => {
  it("enqueues and refreshes shared read model after archive governance action", async () => {
    const recordSeed = buildRecordFromNormalized({
      normalized: normalizeCandidate(buildCandidate()),
    });
    const repositories = createMemoryRepositories({
      records: [
        {
          ...recordSeed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        },
      ],
    });

    const service = createStorageService({
      repositories,
      logger: createLogger("silent"),
      config: {
        port: 3001,
        host: "127.0.0.1",
        log_level: "silent",
        database_url: "postgres://example",
        storage_schema_private: "storage_private",
        storage_schema_shared: "storage_shared_v1",
        write_job_poll_interval_ms: 1000,
        write_job_batch_size: 10,
        write_job_max_retries: 3,
        read_model_refresh_max_retries: 2,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    await service.archiveRecord(recordSeed.id, {
      actor: {
        actor_type: "operator",
        actor_id: "tester",
      },
      reason: "task complete",
    });

    const worker = new JobWorker(repositories, createLogger("silent"), {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 2,
    });

    await worker.processAvailableJobs();

    const projected = await repositories.readModel.findById(recordSeed.id);
    expect(projected?.status).toBe("archived");
  });
});

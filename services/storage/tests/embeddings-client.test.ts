import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageService } from "../src/services.js";
import type { MemoryWriteJob, ReadModelRefreshJob } from "../src/contracts.js";
import type { StorageRepositories } from "../src/db/repositories.js";
import { HttpEmbeddingsClient } from "../src/db/embeddings-client.js";

const baseConfig = {
  port: 3001,
  host: "127.0.0.1",
  log_level: "silent",
  database_url: "postgres://example",
  storage_schema_private: "storage_private",
  storage_schema_shared: "storage_shared_v1",
  write_job_poll_interval_ms: 1000,
  write_job_batch_size: 10,
  write_job_max_retries: 3,
  read_model_refresh_max_retries: 3,
  embedding_base_url: "https://api.openai.com/v1",
  embedding_api_key: "test-key",
  embedding_model: "text-embedding-3-small",
  axis_embedding_config_path: undefined,
  redis_url: undefined,
};

describe("storage embeddings client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps third-party base path when building embeddings request url", async () => {
    let calledUrl = "";

    globalThis.fetch = (async (input) => {
      calledUrl = String(input);
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as Response;
    }) as typeof fetch;

    const client = new HttpEmbeddingsClient(baseConfig);
    const embedding = await client.embedText("hello");

    expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("supports batch embeddings on third-party endpoints", async () => {
    let calledUrl = "";
    let payloadInput: unknown;

    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      payloadInput = init?.body ? JSON.parse(String(init.body)) : null;
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        }),
      } as Response;
    }) as typeof fetch;

    const client = new HttpEmbeddingsClient(baseConfig);
    const embeddings = await client.embedTexts!(["hello", "world"]);

    expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    expect(payloadInput).toMatchObject({ input: ["hello", "world"] });
    expect(embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("reports not configured when only the default embedding model exists", () => {
    const client = new HttpEmbeddingsClient({
      ...baseConfig,
      embedding_base_url: undefined,
    });

    expect(client.isConfigured()).toBe(false);
  });

  it("reads shared managed embedding config after startup", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-embedding-"));
    const configPath = path.join(tempDir, "embedding-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        apiKey: "managed-key",
      }),
      "utf8",
    );

    let calledUrl = "";
    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer managed-key");
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.2, 0.3, 0.4] }],
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const client = new HttpEmbeddingsClient({
        ...baseConfig,
        embedding_base_url: undefined,
        axis_embedding_config_path: configPath,
      });

      expect(client.isConfigured()).toBe(true);
      await expect(client.embedText("hello")).resolves.toEqual([0.2, 0.3, 0.4]);
      expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("marks embedding dependency as not_configured when startup has no embedding base url", async () => {
    const repositories = {
      jobs: {
        enqueue: async () => ({
          id: "job-1",
          idempotency_key: "idem-1",
          workspace_id: "workspace-1",
          user_id: null,
          candidate_json: {} as never,
          candidate_hash: "hash-1",
          source_service: "test",
          job_status: "queued",
          result_record_id: null,
          result_status: null,
          error_code: null,
          error_message: null,
          retry_count: 0,
          received_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
        } satisfies MemoryWriteJob),
        enqueueMany: async () => [],
        findById: async () => null,
        findByIdempotencyKey: async () => null,
        claimQueuedJobs: async () => [],
        markSucceeded: async () => undefined,
        markDeadLetter: async () => undefined,
        requeue: async () => undefined,
        listRecent: async () => [],
      },
      records: {
        findById: async () => null,
        findByDedupeScope: async () => [],
        insertRecord: async () => {
          throw new Error("not implemented");
        },
        updateRecord: async () => {
          throw new Error("not implemented");
        },
        appendVersion: async () => {
          throw new Error("not implemented");
        },
        listRecords: async () => ({ items: [], page: 1, page_size: 20, total: 0 }),
        getVersion: async () => null,
        listVersions: async () => [],
      },
      governance: {
        appendAction: async () => undefined,
        listActions: async () => [],
      },
      conflicts: {
        openConflict: async () => {
          throw new Error("not implemented");
        },
        listConflicts: async () => [],
        findById: async () => null,
        resolveConflict: async () => {
          throw new Error("not implemented");
        },
      },
      readModel: {
        upsert: async () => undefined,
        delete: async () => undefined,
        findById: async () => null,
        listPendingEmbeddings: async () => [],
        enqueueRefresh: async () => ({
          id: "refresh-1",
          source_record_id: "record-1",
          refresh_type: "update" as const,
          job_status: "queued" as const,
          retry_count: 0,
          error_message: null,
          created_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
        } satisfies ReadModelRefreshJob),
        claimRefreshJobs: async () => [],
        markRefreshSucceeded: async () => undefined,
        markRefreshFailed: async () => undefined,
        markRefreshDeadLetter: async () => undefined,
      },
      metrics: {
        collect: async () => ({})
      },
      transaction: async (callback: (repos: StorageRepositories) => Promise<unknown>) =>
        callback(repositories as unknown as StorageRepositories),
    } as unknown as StorageRepositories;

    const service = createStorageService({
      repositories,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      } as never,
      config: {
        ...baseConfig,
        embedding_base_url: undefined,
      },
      embeddingsClient: new HttpEmbeddingsClient({
        ...baseConfig,
        embedding_base_url: undefined,
      }),
    });

    const dependencies = await service.getDependencies();
    expect(dependencies.dependencies).toContainEqual({
      name: "embedding_service",
      status: "not_configured",
      message: undefined,
    });
  });
});

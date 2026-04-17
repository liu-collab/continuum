import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/api/app.js";
import { createStorageService } from "../src/services.js";
import { runMigrations } from "../src/db/migration-runner.js";
import { createRepositories } from "../src/db/repositories.js";
import { HttpEmbeddingsClient, type EmbeddingsClient } from "../src/db/embeddings-client.js";
import { createPostgresTestContext, testDatabaseUrl } from "./postgres-test-helpers.js";
import { buildCandidate } from "./memory-repositories.js";

describe.skipIf(!testDatabaseUrl)("storage postgres integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("runs migrations and processes a writeback candidate end to end", async () => {
    const context = await createPostgresTestContext("storage_e2e");
    cleanups.push(() => context.cleanup());

    await runMigrations(context.config, context.logger, context.database, context.migrationsDir);

    const service = createStorageService({
      logger: context.logger,
      config: context.config,
      database: context.database,
    });

    const job = await service.submitWriteBackCandidate(buildCandidate());
    expect(job.job_status).toBe("queued");

    const processed = await service.processWriteJobs();
    expect(processed).toBe(1);

    const records = await service.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      task_id: undefined,
      memory_type: undefined,
      scope: undefined,
      status: undefined,
      page: 1,
      page_size: 10,
    });

    expect(records.items).toHaveLength(1);
    expect(records.items[0]?.summary).toBe("User prefers concise answers");

    const readModelRows = await context.database.session().query<{
      summary: string;
      details: Record<string, unknown>;
      source: Record<string, unknown>;
      created_at: string;
    }>(
      `
        select summary, details, source, created_at
        from "${context.sharedSchema}"."memory_read_model_v1"
        where id = $1
      `,
      [records.items[0]!.id],
    );

    expect(readModelRows.rows[0]?.summary).toBe("User prefers concise answers");
    expect(readModelRows.rows[0]?.details.subject).toBe("user");
    expect(readModelRows.rows[0]?.source.source_type).toBe("user_input");
    expect(readModelRows.rows[0]?.source.origin_workspace_id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(readModelRows.rows[0]?.created_at).toBeTruthy();
  });

  it("maps runtime batch contract to storage candidate shape", async () => {
    const context = await createPostgresTestContext("storage_runtime_batch");
    cleanups.push(() => context.cleanup());

    await runMigrations(context.config, context.logger, context.database, context.migrationsDir);

    const service = createStorageService({
      logger: context.logger,
      config: context.config,
      database: context.database,
    });

    const submitted = await service.submitRuntimeCompatibleWriteBackBatch({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      session_id: "33333333-3333-4333-8333-333333333333",
      task_id: "44444444-4444-4444-8444-444444444444",
      source_service: "retrieval-runtime",
      candidates: [
        {
          candidate_type: "commitment",
          scope: "task",
          summary: "Will finish the migration cleanup today",
          details: {
            promise: "finish the migration cleanup today",
          },
          importance: 4,
          confidence: 0.9,
          write_reason: "user made an explicit commitment",
          source: {
            host: "codex_app_server",
            session_id: "33333333-3333-4333-8333-333333333333",
            turn_id: "turn-9",
            task_id: "44444444-4444-4444-8444-444444444444",
          },
          dedupe_key: "commitment:finish-migration-cleanup",
        },
      ],
    });

    expect(submitted).toHaveLength(1);

    await service.processWriteJobs();

    const records = await service.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      task_id: "44444444-4444-4444-8444-444444444444",
      memory_type: undefined,
      scope: undefined,
      status: undefined,
      page: 1,
      page_size: 10,
    });

    expect(records.items).toHaveLength(1);
    expect(records.items[0]?.memory_type).toBe("episodic");
    expect(records.items[0]?.task_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(records.items[0]?.source_type).toBe("codex_app_server");
    expect(records.items[0]?.details_json.runtime_candidate_type).toBe("commitment");
    expect((records.items[0]?.details_json.runtime_source as { host?: string })?.host).toBe(
      "codex_app_server",
    );
  });

  it("writes summary embedding when embedding client is configured", async () => {
    const context = await createPostgresTestContext("storage_embedding");
    cleanups.push(() => context.cleanup());

    await runMigrations(context.config, context.logger, context.database, context.migrationsDir);

    class FakeEmbeddingsClient implements EmbeddingsClient {
      async embedText() {
        return Array.from({ length: 1536 }, (_, index) => Number((index / 1000).toFixed(3)));
      }
    }

    const service = createStorageService({
      logger: context.logger,
      config: {
        ...context.config,
        embedding_base_url: "http://localhost:11434",
      },
      database: context.database,
      embeddingsClient: new FakeEmbeddingsClient(),
    });

    await service.submitWriteBackCandidate(buildCandidate());
    await service.processWriteJobs();

    const repositories = createRepositories(context.database);
    const records = await repositories.records.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      task_id: undefined,
      memory_type: undefined,
      scope: undefined,
      status: undefined,
      page: 1,
      page_size: 10,
    });
    const projected = await repositories.readModel.findById(records.items[0]!.id);

    expect(projected?.summary_embedding).toHaveLength(1536);
    expect(projected?.summary_embedding?.[0]).toBe(0);
  });

  it("rejects invalid runtime batch payload at the api boundary", async () => {
    const context = await createPostgresTestContext("storage_api_validation");
    cleanups.push(() => context.cleanup());

    await runMigrations(context.config, context.logger, context.database, context.migrationsDir);

    const service = createStorageService({
      logger: context.logger,
      config: context.config,
      database: context.database,
    });
    const app = createApp(service);
    cleanups.push(() => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates",
      payload: {
        workspace_id: "not-a-uuid",
        user_id: "22222222-2222-4222-8222-222222222222",
        session_id: "33333333-3333-4333-8333-333333333333",
        source_service: "retrieval-runtime",
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            summary: "User prefers concise answers",
            details: {
              subject: "user",
              predicate: "prefers concise answers",
            },
            importance: 4,
            confidence: 0.9,
            write_reason: "user stated a stable preference explicitly",
            source: {
              host: "codex_app_server",
              session_id: "33333333-3333-4333-8333-333333333333",
              turn_id: "turn-1",
            },
            dedupe_key: "fact_preference:user:user prefers concise answers",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_failed");
  });
});

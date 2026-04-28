import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/api/app.js";
import { createLogger } from "../src/logger.js";
import { createStorageService } from "../src/services.js";
import { createMemoryRepositories, buildCandidate } from "./memory-repositories.js";

describe("storage api", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("validates structured writeback candidate and returns accepted async job", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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
        read_model_refresh_max_retries: 3,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    const app = createApp(service);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates",
      payload: buildCandidate(),
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].job_id).toBeTruthy();
    expect(body.jobs[0].status).toBe("accepted_async");
  });

  it("rejects transcript-like details payloads", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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
        read_model_refresh_max_retries: 3,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    const app = createApp(service);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates",
      payload: buildCandidate({
        details: {
          transcript: Array.from({ length: 21 }, (_, index) => ({
            role: index % 2 === 0 ? "user" : "assistant",
            content: `message-${index}`,
          })),
        },
      }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("accepts retrieval-runtime batch writeback contract", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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
        redis_url: "redis://localhost:6379",
      },
      database: {
        session() {
          throw new Error("not implemented");
        },
        async withTransaction() {
          throw new Error("not implemented");
        },
        async ping() {
          return;
        },
        async close() {
          return;
        },
      } as never,
    });

    const app = createApp(service);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates",
      payload: {
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            workspace_id: "11111111-1111-4111-8111-111111111111",
            user_id: "22222222-2222-4222-8222-222222222222",
            task_id: null,
            session_id: null,
            summary: "User prefers concise answers",
            details: {
              subject: "user",
              predicate: "prefers concise answers",
            },
            importance: 4,
            confidence: 0.9,
            write_reason: "user stated a stable preference explicitly",
            source: {
              source_type: "user_input",
              source_ref: "turn-1",
              service_name: "retrieval-runtime",
              origin_workspace_id: "11111111-1111-4111-8111-111111111111",
              confirmed_by_user: true,
            },
            idempotency_key: "fact-pref-user-prefers-concise-answers",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.submitted_jobs).toHaveLength(1);
    expect(body.submitted_jobs[0].status).toBe("accepted_async");
  });

  it("accepts suggested pending confirmation status from retrieval-runtime candidates", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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
        redis_url: "redis://localhost:6379",
      },
      database: {
        session() {
          throw new Error("not implemented");
        },
        async withTransaction() {
          throw new Error("not implemented");
        },
        async ping() {
          return;
        },
        async close() {
          return;
        },
      } as never,
    });

    const app = createApp(service);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates",
      payload: {
        candidates: [
          {
            ...buildCandidate(),
            suggested_status: "pending_confirmation",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().submitted_jobs[0].status).toBe("accepted_async");
  });

  it("accepts lightweight origin trace details without treating them as transcript payload", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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
        redis_url: "redis://localhost:6379",
      },
    });

    const app = createApp(service);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates",
      payload: {
        candidates: [
          {
            ...buildCandidate(),
            details: {
              subject: "user",
              predicate: "prefers concise answers",
              origin_trace: {
                source_turn_id: "turn-1",
                source_message_role: "user",
                source_excerpt: "Please keep answers concise by default.",
                extraction_basis: "user stated a stable preference explicitly",
                extractor_version: "memory-writeback-refine-v1",
                extraction_method: "rules",
              },
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().submitted_jobs[0].status).toBe("accepted_async");
  });

  it("accepts runtime compatible batch contract and keeps compatibility mapping", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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

    const app = createApp(service);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates",
      payload: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        user_id: "22222222-2222-4222-8222-222222222222",
        session_id: "33333333-3333-4333-8333-333333333333",
        source_service: "retrieval-runtime",
        candidates: [
          {
            candidate_type: "commitment",
            scope: "task",
            summary: "Will finish migration cleanup today",
            details: {
              promise: "finish migration cleanup",
            },
            importance: 4,
            confidence: 0.9,
            write_reason: "explicit commitment",
            source: {
              host: "codex_app_server",
              session_id: "33333333-3333-4333-8333-333333333333",
              turn_id: "turn-9",
              task_id: "44444444-4444-4444-8444-444444444444",
            },
            dedupe_key: "commitment:cleanup",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().jobs).toHaveLength(1);
    expect(response.json().submitted_jobs).toHaveLength(1);
  });

  it("returns write projection status for succeeded write jobs with refresh progress", async () => {
    const recordId = "55555555-5555-4555-8555-555555555555";
    const refreshJobId = "66666666-6666-4666-8666-666666666666";
    const service = createStorageService({
      repositories: createMemoryRepositories({
        jobs: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            idempotency_key: "projection-ready-job",
            workspace_id: "11111111-1111-4111-8111-111111111111",
            user_id: "22222222-2222-4222-8222-222222222222",
            candidate_json: buildCandidate(),
            candidate_hash: "candidate-hash",
            source_service: "retrieval-runtime",
            job_status: "succeeded",
            result_record_id: recordId,
            result_status: "insert_new",
            error_code: null,
            error_message: null,
            retry_count: 0,
            received_at: "2026-04-23T00:00:00.000Z",
            started_at: "2026-04-23T00:00:01.000Z",
            finished_at: "2026-04-23T00:00:02.000Z",
          },
        ],
        refreshJobs: [
          {
            id: refreshJobId,
            source_record_id: recordId,
            refresh_type: "insert",
            job_status: "processing",
            retry_count: 0,
            error_message: null,
            created_at: "2026-04-23T00:00:03.000Z",
            started_at: "2026-04-23T00:00:04.000Z",
            finished_at: null,
          },
        ],
      }),
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

    const app = createApp(service);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates/projection-status",
      payload: {
        job_ids: ["44444444-4444-4444-8444-444444444444"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      data: {
        items: [
          {
            job_id: "44444444-4444-4444-8444-444444444444",
            write_job_status: "succeeded",
            result_record_id: recordId,
            result_status: "insert_new",
            latest_refresh_job: {
              job_id: refreshJobId,
              source_record_id: recordId,
              refresh_type: "insert",
              job_status: "processing",
              created_at: "2026-04-23T00:00:03.000Z",
              finished_at: null,
              error_message: null,
            },
            projection_ready: false,
          },
        ],
      },
    });
  });

  it("serves split health endpoints and keeps readiness ready when optional dependencies are unavailable", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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
        redis_url: "redis://localhost:6379",
      },
      database: {
        session() {
          throw new Error("not implemented");
        },
        async withTransaction() {
          throw new Error("not implemented");
        },
        async ping() {
          return;
        },
        async close() {
          return;
        },
      } as never,
    });

    const app = createApp(service);
    apps.push(app);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/v1/storage/health/readiness",
    });
    expect(readinessResponse.statusCode).toBe(200);
    expect(readinessResponse.json().data.status).toBe("ready");

    const livenessResponse = await app.inject({
      method: "GET",
      url: "/v1/storage/health/liveness",
    });
    expect(livenessResponse.statusCode).toBe(200);
    expect(livenessResponse.json().data.status).toBe("alive");

    const dependenciesResponse = await app.inject({
      method: "GET",
      url: "/v1/storage/health/dependencies",
    });
    expect(dependenciesResponse.statusCode).toBe(200);
    const dependenciesBody = dependenciesResponse.json();
    expect(dependenciesBody.data.dependencies).toHaveLength(3);
    expect(dependenciesBody.data.dependencies[1].name).toBe("redis");
    expect(dependenciesBody.data.dependencies[1].status).toBe("unavailable");
    expect(dependenciesBody.data.dependencies[2].name).toBe("embedding_service");
    expect(dependenciesBody.data.dependencies[2].status).toBe("not_configured");

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.readiness).toBe("ready");
    expect(body.data.dependencies[1].status).toBe("unavailable");
  });

  it("marks readiness not ready when database is unavailable but keeps liveness alive", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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
        embedding_base_url: "http://localhost:11434",
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
      database: {
        session() {
          throw new Error("not implemented");
        },
        async withTransaction() {
          throw new Error("not implemented");
        },
        async ping() {
          throw new Error("database down");
        },
        async close() {
          return;
        },
      } as never,
    });

    const app = createApp(service);
    apps.push(app);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/v1/storage/health/readiness",
    });
    expect(readinessResponse.statusCode).toBe(200);
    expect(readinessResponse.json().data.status).toBe("not_ready");

    const dependenciesResponse = await app.inject({
      method: "GET",
      url: "/v1/storage/health/dependencies",
    });
    expect(dependenciesResponse.statusCode).toBe(200);
    const dependencyStatuses = dependenciesResponse.json().data.dependencies;
    expect(dependencyStatuses[0].name).toBe("database");
    expect(dependencyStatuses[0].status).toBe("unavailable");
    expect(dependencyStatuses[2].status).toBe("unavailable");

    const livenessResponse = await app.inject({
      method: "GET",
      url: "/v1/storage/health/liveness",
    });
    expect(livenessResponse.statusCode).toBe(200);
    expect(livenessResponse.json().data.status).toBe("alive");
  });

  it("rejects runtime batch writeback when session id is not uuid", async () => {
    const service = createStorageService({
      repositories: createMemoryRepositories(),
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

    const app = createApp(service);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/write-back-candidates",
      payload: {
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            workspace_id: "11111111-1111-4111-8111-111111111111",
            user_id: "22222222-2222-4222-8222-222222222222",
            task_id: null,
            session_id: "not-a-uuid",
            summary: "User prefers concise answers",
            details: {
              subject: "user",
              predicate: "prefers concise answers",
            },
            importance: 4,
            confidence: 0.9,
            write_reason: "user stated a stable preference explicitly",
            source: {
              source_type: "user_input",
              source_ref: "turn-1",
              service_name: "retrieval-runtime",
            },
            idempotency_key: "fact-pref-invalid-session",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_failed");
  });

  it("exposes confirm, invalidate and delete governance routes", async () => {
    const repositories = createMemoryRepositories();
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

    const job = await service.submitWriteBackCandidate(buildCandidate());
    expect(job.id).toBeTruthy();
    await service.processWriteJobs();
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
    const [stored] = records.items;

    const app = createApp(service);
    apps.push(app);

    const body = {
      actor: {
        actor_type: "operator",
        actor_id: "tester",
      },
      reason: "manual governance",
    };

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/v1/storage/records/${stored!.id}/confirm`,
      payload: body,
    });
    expect(confirmResponse.statusCode).toBe(200);

    const invalidateResponse = await app.inject({
      method: "POST",
      url: `/v1/storage/records/${stored!.id}/invalidate`,
      payload: body,
    });
    expect(invalidateResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({
      method: "POST",
      url: `/v1/storage/records/${stored!.id}/delete`,
      payload: body,
    });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it("serves records with required workspace context and pagination shape", async () => {
    const repositories = createMemoryRepositories();
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
    await service.submitWriteBackCandidate(buildCandidate());
    await service.processWriteJobs();

    const app = createApp(service);
    apps.push(app);

    const missingWorkspace = await app.inject({
      method: "GET",
      url: "/v1/storage/records",
    });
    expect(missingWorkspace.statusCode).toBe(400);

    const response = await app.inject({
      method: "GET",
      url: "/v1/storage/records?workspace_id=11111111-1111-4111-8111-111111111111&page=1&page_size=10",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    expect(response.json().data.total).toBe(1);
    expect(response.json().data.page).toBe(1);
    expect(response.json().data.page_size).toBe(10);
  });

  it("serves record versions and history routes", async () => {
    const repositories = createMemoryRepositories();
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
    const job = await service.submitWriteBackCandidate(buildCandidate());
    expect(job.id).toBeTruthy();
    await service.processWriteJobs();
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
    const [stored] = records.items;

    await service.archiveRecord(stored!.id, {
      actor: {
        actor_type: "operator",
        actor_id: "tester",
      },
      reason: "check history api",
    });

    const app = createApp(service);
    apps.push(app);

    const versionsResponse = await app.inject({
      method: "GET",
      url: `/v1/storage/records/${stored!.id}/versions`,
    });
    const historyResponse = await app.inject({
      method: "GET",
      url: `/v1/storage/records/${stored!.id}/history`,
    });

    expect(versionsResponse.statusCode).toBe(200);
    expect(historyResponse.statusCode).toBe(200);
    expect(versionsResponse.json().data.length).toBeGreaterThan(0);
    expect(historyResponse.json().data.length).toBeGreaterThan(0);
  });

  it("accepts governance execution batches and lists execution history", async () => {
    const repositories = createMemoryRepositories();
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

    const job = await service.submitWriteBackCandidate(buildCandidate());
    expect(job.id).toBeTruthy();
    await service.processWriteJobs();
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
    const [stored] = records.items;

    const app = createApp(service);
    apps.push(app);

    const executeResponse = await app.inject({
      method: "POST",
      url: "/v1/storage/governance-executions",
      payload: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        source_service: "retrieval-runtime",
        items: [
          {
            proposal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            proposal_type: "archive",
            targets: {
              record_ids: [stored!.id],
            },
            suggested_changes: {
              status: "archived",
            },
            reason_code: "duplicate_preference",
            reason_text: "archived duplicate preference",
            evidence: {
              seed_record_ids: [stored!.id],
            },
            planner: {
              model: "memory_llm",
              confidence: 0.91,
            },
            verifier: {
              required: false,
            },
            policy_version: "memory-governance-v1",
            idempotency_key: "archive-proposal-one",
          },
        ],
      },
    });

    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json().data).toHaveLength(1);
    expect(executeResponse.json().data[0].execution.execution_status).toBe("executed");

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/storage/governance-executions?workspace_id=11111111-1111-4111-8111-111111111111",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data.length).toBe(1);

    const executionId = executeResponse.json().data[0].execution.id;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/storage/governance-executions/${executionId}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().data.execution.id).toBe(executionId);
    expect(detailResponse.json().data.proposal.id).toBe(executeResponse.json().data[0].proposal.id);
    expect(Array.isArray(detailResponse.json().data.targets)).toBe(true);

    const rejectedResponse = await app.inject({
      method: "POST",
      url: "/v1/storage/governance-executions",
      payload: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        source_service: "retrieval-runtime",
        items: [
          {
            proposal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            proposal_type: "delete",
            targets: {
              record_ids: [stored!.id],
            },
            suggested_changes: {
              delete_mode: "soft",
            },
            reason_code: "obsolete_task_state",
            reason_text: "delete obsolete task state",
            evidence: {
              delete_reason: "covered by newer state",
            },
            planner: {
              model: "memory_llm",
              confidence: 0.95,
            },
            verifier: {
              required: true,
              model: "memory_llm",
              decision: "reject",
              confidence: 0.41,
              notes: "records were judged unrelated",
            },
            policy_version: "memory-governance-v1",
            idempotency_key: "delete-proposal-rejected",
          },
        ],
      },
    });

    expect(rejectedResponse.statusCode).toBe(200);
    const recentRejectedResponse = await app.inject({
      method: "GET",
      url: "/v1/storage/governance-proposals/recent-rejected?workspace_id=11111111-1111-4111-8111-111111111111",
    });
    expect(recentRejectedResponse.statusCode).toBe(200);
    expect(recentRejectedResponse.json().data).toEqual([
      expect.objectContaining({
        proposal_type: "delete",
        reason_text: "delete obsolete task state",
        verifier_notes: "records were judged unrelated",
      }),
    ]);
  });

  it("upserts and lists memory relations", async () => {
    const repositories = createMemoryRepositories();
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

    const jobA = await service.submitWriteBackCandidate(buildCandidate({ idempotency_key: "rel-a" }));
    const jobB = await service.submitWriteBackCandidate(buildCandidate({
      idempotency_key: "rel-b",
      summary: "Repository requires API tests before commit",
      scope: "workspace",
      user_id: null,
      source: {
        source_type: "assistant_final",
        source_ref: "turn-2",
        service_name: "retrieval-runtime",
        origin_workspace_id: "11111111-1111-4111-8111-111111111111",
      },
    }));
    expect(jobA.id).toBeTruthy();
    expect(jobB.id).toBeTruthy();
    await service.processWriteJobs();

    const records = await service.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      page: 1,
      page_size: 10,
    });
    const [first, second] = records.items;

    const app = createApp(service);
    apps.push(app);

    const upsertResponse = await app.inject({
      method: "POST",
      url: "/v1/storage/relations",
      payload: {
        relations: [
          {
            workspace_id: "11111111-1111-4111-8111-111111111111",
            source_record_id: first!.id,
            target_record_id: second!.id,
            relation_type: "related_to",
            strength: 0.88,
            bidirectional: true,
            reason: "同一工作区约束",
            created_by_service: "retrieval-runtime",
          },
        ],
      },
    });

    expect(upsertResponse.statusCode).toBe(200);
    expect(upsertResponse.json().data).toHaveLength(1);

    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/storage/relations?workspace_id=11111111-1111-4111-8111-111111111111&record_id=${first!.id}`,
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data).toHaveLength(1);
    expect(listResponse.json().data[0].target_record_id).toBe(second!.id);
  });

  it("requires delete_reason for delete governance executions", async () => {
    const app = createApp(
      createStorageService({
        repositories: createMemoryRepositories(),
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
      }),
    );
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/governance-executions",
      payload: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        source_service: "retrieval-runtime",
        items: [
          {
            proposal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            proposal_type: "delete",
            targets: {
              record_ids: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
            },
            suggested_changes: {
              delete_mode: "soft",
            },
            reason_code: "obsolete_task_state",
            reason_text: "delete obsolete task state",
            evidence: {},
            planner: {
              model: "memory_llm",
              confidence: 0.95,
            },
            verifier: {
              required: true,
              model: "memory_llm",
              decision: "approve",
              confidence: 0.92,
            },
            policy_version: "memory-governance-v1",
            idempotency_key: "delete-proposal-one",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_failed");
  });
});

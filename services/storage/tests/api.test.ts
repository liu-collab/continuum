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
    expect(body.status).toBe("accepted_async");
    expect(body.data.job_id).toBeTruthy();
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
        workspace_id: "11111111-1111-4111-8111-111111111111",
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

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.submitted_jobs).toHaveLength(1);
    expect(body.submitted_jobs[0].status).toBe("accepted_async");
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
        workspace_id: "11111111-1111-4111-8111-111111111111",
        user_id: "22222222-2222-4222-8222-222222222222",
        session_id: "not-a-uuid",
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
              session_id: "not-a-uuid",
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

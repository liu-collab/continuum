import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { MemoryBadRequestError, MemoryClient, MemoryTimeoutError, MemoryUnavailableError } from "../index.js";

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "session-001",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

function createDependencyStatus() {
  return {
    read_model: {
      name: "read_model" as const,
      status: "healthy" as const,
      detail: "ok",
      last_checked_at: "2026-04-18T12:00:00.000Z",
    },
    embeddings: {
      name: "embeddings" as const,
      status: "healthy" as const,
      detail: "ok",
      last_checked_at: "2026-04-18T12:00:00.000Z",
    },
    storage_writeback: {
      name: "storage_writeback" as const,
      status: "healthy" as const,
      detail: "ok",
      last_checked_at: "2026-04-18T12:00:00.000Z",
    },
    memory_llm: {
      name: "memory_llm" as const,
      status: "healthy" as const,
      detail: "ok",
      last_checked_at: "2026-04-18T12:00:00.000Z",
    },
  };
}

async function startMockRuntime(register: (app: FastifyInstance) => void | Promise<void>) {
  const app = Fastify({ logger: false });
  await register(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock runtime address unavailable");
  }

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe("memory client", () => {
  const startedApps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(startedApps.splice(0).map((app) => app.close()));
  });

  it("injects memory_native_agent host for prepare-context and validates the response", async () => {
    let receivedHost: string | null = null;

    const runtime = await startMockRuntime((app) => {
      app.post("/v1/runtime/prepare-context", async (request) => {
        const body = request.body as Record<string, unknown>;
        receivedHost = typeof body.host === "string" ? body.host : null;

        return {
          trace_id: "trace-prepare",
          trigger: true,
          trigger_reason: "phase_trigger",
          memory_packet: null,
          injection_block: {
            injection_reason: "恢复上下文",
            memory_summary: "用户偏好：默认用中文。",
            memory_records: [],
            token_estimate: 12,
            memory_mode: "workspace_plus_global",
            requested_scopes: ["workspace", "user"],
            selected_scopes: ["workspace"],
            trimmed_record_ids: [],
            trim_reasons: [],
          },
          degraded: false,
          dependency_status: createDependencyStatus(),
          budget_used: 12,
          memory_packet_ids: [],
        };
      });
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    const response = await client.prepareContext({
      workspace_id: ids.workspace,
      user_id: ids.user,
      task_id: ids.task,
      session_id: ids.session,
      turn_id: "turn-1",
      phase: "before_response",
      current_input: "继续上一轮已经确认的约束。",
    });

    expect(receivedHost).toBe("memory_native_agent");
    expect(response.trace_id).toBe("trace-prepare");
    expect(response.injection_block?.memory_summary).toContain("默认用中文");
  });

  it("returns a degraded fallback when runtime reports dependency_unavailable", async () => {
    const runtime = await startMockRuntime((app) => {
      app.post("/v1/runtime/session-start-context", async (_request, reply) => {
        reply.status(503).send({
          error: {
            code: "dependency_unavailable",
            message: "read model unavailable",
          },
        });
      });
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    const response = await client.sessionStartContext({
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      recent_context_summary: "恢复当前上下文。",
    });

    expect(response.degraded).toBe(true);
    expect(response.injection_block).toBeNull();
    expect(response.additional_context).toBe("");
    expect(response.memory_mode).toBe("workspace_plus_global");
  });

  it("throws MemoryTimeoutError when finalize-turn exceeds timeout", async () => {
    const runtime = await startMockRuntime((app) => {
      app.post("/v1/runtime/finalize-turn", async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          trace_id: "trace-finalize",
          write_back_candidates: [],
          submitted_jobs: [],
          memory_mode: "workspace_plus_global",
          candidate_count: 0,
          filtered_count: 0,
          filtered_reasons: [],
          writeback_submitted: false,
          degraded: false,
          dependency_status: createDependencyStatus(),
        };
      });
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({
      baseUrl: runtime.baseUrl,
      finalizeTimeoutMs: 20,
    });

    await expect(
      client.finalizeTurn({
        workspace_id: ids.workspace,
        user_id: ids.user,
        task_id: ids.task,
        session_id: ids.session,
        current_input: "我偏好默认中文输出。",
        assistant_output: "收到，后续统一保持中文。",
      }),
    ).rejects.toBeInstanceOf(MemoryTimeoutError);
  });

  it("throws MemoryUnavailableError when runtime returns 5xx", async () => {
    const runtime = await startMockRuntime((app) => {
      app.get("/v1/runtime/dependency-status", async (_request, reply) => {
        reply.status(500).send({
          error: {
            code: "internal_error",
            message: "runtime exploded",
          },
        });
      });
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    await expect(client.dependencyStatus()).rejects.toBeInstanceOf(MemoryUnavailableError);
  });

  it("throws MemoryBadRequestError when runtime returns 4xx", async () => {
    const runtime = await startMockRuntime((app) => {
      app.post("/v1/runtime/prepare-context", async (_request, reply) => {
        reply.status(400).send({
          error: {
            code: "validation_error",
            message: "Invalid prepare-context payload",
          },
        });
      });
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    await expect(
      client.prepareContext({
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        phase: "before_response",
        current_input: "继续。",
      }),
    ).rejects.toBeInstanceOf(MemoryBadRequestError);
  });

  it("reads healthz and dependency status with schema validation", async () => {
    const dependencyStatus = createDependencyStatus();
    const runtime = await startMockRuntime((app) => {
      app.get("/healthz", async () => ({
        version: "0.1.0",
        api_version: "v1",
        liveness: {
          status: "alive",
        },
        readiness: {
          status: "ready",
        },
        dependencies: dependencyStatus,
      }));

      app.get("/v1/runtime/dependency-status", async () => dependencyStatus);
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    const health = await client.healthz();
    const dependencies = await client.dependencyStatus();

    expect(health.liveness.status).toBe("alive");
    expect(health.readiness.status).toBe("ready");
    expect(health.version).toBe("0.1.0");
    expect(health.api_version).toBe("v1");
    expect(dependencies.read_model.status).toBe("healthy");
  });

  it("runs an active embedding health check with schema validation", async () => {
    const runtime = await startMockRuntime((app) => {
      app.post("/v1/runtime/dependency-status/embeddings/check", async () => ({
        name: "embeddings",
        status: "healthy",
        detail: "embedding request completed",
        last_checked_at: "2026-04-21T12:00:00.000Z",
      }));
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    const response = await client.checkEmbeddings();

    expect(response).toEqual({
      name: "embeddings",
      status: "healthy",
      detail: "embedding request completed",
      last_checked_at: "2026-04-21T12:00:00.000Z",
    });
  });

  it("runs an active memory llm health check with schema validation", async () => {
    const runtime = await startMockRuntime((app) => {
      app.post("/v1/runtime/dependency-status/memory-llm/check", async () => ({
        name: "memory_llm",
        status: "healthy",
        detail: "memory llm request completed",
        last_checked_at: "2026-04-21T12:00:00.000Z",
      }));
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    const response = await client.checkMemoryLlm();

    expect(response).toEqual({
      name: "memory_llm",
      status: "healthy",
      detail: "memory llm request completed",
      last_checked_at: "2026-04-21T12:00:00.000Z",
    });
  });

  it("reads and updates runtime governance config", async () => {
    const runtime = await startMockRuntime((app) => {
      app.get("/v1/runtime/config", async () => ({
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: false,
          WRITEBACK_MAINTENANCE_INTERVAL_MS: 900000,
          WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
          WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
          WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
        },
      }));
      app.put("/v1/runtime/config", async (request) => ({
        ok: true,
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: Boolean(
            (request.body as { governance?: { WRITEBACK_MAINTENANCE_ENABLED?: boolean } }).governance
              ?.WRITEBACK_MAINTENANCE_ENABLED,
          ),
          WRITEBACK_MAINTENANCE_INTERVAL_MS: 300000,
          WRITEBACK_GOVERNANCE_VERIFY_ENABLED: false,
          WRITEBACK_GOVERNANCE_SHADOW_MODE: true,
          WRITEBACK_MAINTENANCE_MAX_ACTIONS: 5,
        },
      }));
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    await expect(client.getRuntimeConfig()).resolves.toMatchObject({
      governance: {
        WRITEBACK_MAINTENANCE_ENABLED: false,
        WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
      },
    });

    await expect(
      client.updateRuntimeConfig({
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: true,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      governance: {
        WRITEBACK_MAINTENANCE_ENABLED: true,
        WRITEBACK_GOVERNANCE_SHADOW_MODE: true,
        WRITEBACK_MAINTENANCE_MAX_ACTIONS: 5,
      },
    });
  });

  it("reads write projection status with schema validation", async () => {
    const runtime = await startMockRuntime((app) => {
      app.post("/v1/runtime/write-projection-status", async () => ({
        items: [
          {
            job_id: "550e8400-e29b-41d4-a716-446655440050",
            write_job_status: "succeeded",
            result_record_id: "550e8400-e29b-41d4-a716-446655440051",
            result_status: "insert_new",
            latest_refresh_job: {
              job_id: "550e8400-e29b-41d4-a716-446655440052",
              source_record_id: "550e8400-e29b-41d4-a716-446655440051",
              refresh_type: "insert",
              job_status: "succeeded",
              created_at: "2026-04-23T12:00:00.000Z",
              finished_at: "2026-04-23T12:00:01.000Z",
              error_message: null,
            },
            projection_ready: true,
          },
        ],
      }));
    });
    startedApps.push(runtime.app);

    const client = new MemoryClient({ baseUrl: runtime.baseUrl });
    const response = await client.getWriteProjectionStatuses({
      job_ids: ["550e8400-e29b-41d4-a716-446655440050"],
    });

    expect(response).toEqual({
      items: [
        {
          job_id: "550e8400-e29b-41d4-a716-446655440050",
          write_job_status: "succeeded",
          result_record_id: "550e8400-e29b-41d4-a716-446655440051",
          result_status: "insert_new",
          latest_refresh_job: {
            job_id: "550e8400-e29b-41d4-a716-446655440052",
            source_record_id: "550e8400-e29b-41d4-a716-446655440051",
            refresh_type: "insert",
            job_status: "succeeded",
            created_at: "2026-04-23T12:00:00.000Z",
            finished_at: "2026-04-23T12:00:01.000Z",
            error_message: null,
          },
          projection_ready: true,
        },
      ],
    });
  });
});

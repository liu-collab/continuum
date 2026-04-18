import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../../server.js";
import type { AgentConfig } from "../../config/index.js";

const tempRoots: string[] = [];
const runtimeCalls = {
  healthz: vi.fn(async () => ({
    liveness: { status: "alive" as const },
    readiness: { status: "ready" as const },
    dependencies: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
  })),
  dependencyStatus: vi.fn(async () => ({
    read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
  })),
  sessionStartContext: vi.fn(async () => ({
    trace_id: "trace-session",
    additional_context: "",
    active_task_summary: null,
    injection_block: null,
    memory_mode: "workspace_plus_global" as const,
    dependency_status: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
    degraded: false,
  })),
  prepareContext: vi.fn(async ({ phase }: { phase: string }) => ({
    trace_id: `trace-${phase}`,
    trigger: phase === "before_response",
    trigger_reason: phase,
    memory_packet: null,
    injection_block: null,
    degraded: false,
    dependency_status: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
    budget_used: 0,
    memory_packet_ids: [],
  })),
  finalizeTurn: vi.fn(async () => ({
    trace_id: "trace-finalize",
    write_back_candidates: [],
    submitted_jobs: [],
    memory_mode: "workspace_plus_global" as const,
    candidate_count: 0,
    filtered_count: 0,
    filtered_reasons: [],
    writeback_submitted: false,
    degraded: false,
    dependency_status: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
  })),
};

vi.mock("../../memory-client/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../memory-client/index.js")>();
  return {
    ...actual,
    MemoryClient: vi.fn().mockImplementation(() => runtimeCalls),
  };
});

vi.mock("../../providers/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/index.js")>();
  return {
    ...actual,
    createProvider: vi.fn(() => ({
      id: () => "ollama",
      model: () => "qwen2.5-coder",
      chat: async function* () {
        yield { type: "text_delta", text: "hello from provider" } as const;
        yield {
          type: "end",
          finish_reason: "stop" as const,
          usage: {
            prompt_tokens: 3,
            completion_tokens: 5,
          },
        };
      },
    })),
  };
});

function createTempHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-http-"));
  tempRoots.push(root);
  return root;
}

function createConfig(home: string, workspaceRoot: string): AgentConfig {
  return {
    runtime: {
      baseUrl: "http://127.0.0.1:4100",
      requestTimeoutMs: 800,
      finalizeTimeoutMs: 1_500,
    },
    provider: {
      kind: "ollama",
      model: "qwen2.5-coder",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2,
    },
    memory: {
      mode: "workspace_plus_global",
      userId: "550e8400-e29b-41d4-a716-446655440001",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      cwd: workspaceRoot,
    },
    mcp: {
      servers: [],
    },
    tools: {
      shellExec: {
        enabled: true,
        timeoutMs: 30_000,
        denyPatterns: [],
      },
    },
    cli: {
      systemPrompt: null,
    },
    streaming: {
      flushChars: 32,
      flushIntervalMs: 30,
    },
    locale: "zh-CN",
  };
}

describe("http session routes", () => {
  const apps: Array<ReturnType<typeof createServer>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a session and exposes session metadata", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "hello", "utf8");

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        workspace_id: "project-alpha",
        memory_mode: "workspace_only",
        locale: "en-US",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as {
      session_id: string;
      workspace_id: string;
      memory_mode: string;
      locale: string;
    };
    expect(created.workspace_id).toBe("project-alpha");
    expect(created.memory_mode).toBe("workspace_only");
    expect(created.locale).toBe("en-US");

    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/agent/sessions/${created.session_id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json() as {
      session: {
        id: string;
        workspace_id: string;
        memory_mode: string;
        locale: string;
      };
      messages: unknown[];
    };
    expect(detail.session.workspace_id).toBe("project-alpha");
    expect(detail.session.memory_mode).toBe("workspace_only");
    expect(detail.session.locale).toBe("en-US");
    expect(detail.messages).toEqual([]);

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/agent/sessions?workspace_id=project-alpha",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json() as {
      items: Array<{ id: string }>;
      next_cursor: string | null;
    };
    expect(listPayload.items).toHaveLength(1);
    expect(listPayload.items[0]?.id).toBe(created.session_id);
    expect(listPayload.next_cursor).toBeNull();
  });

  it("protects workspace fs endpoints from path escape", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/fs/file?path=../secret.txt",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "tool_denied_path",
        message: "Resolved path escapes the workspace root.",
      },
    });
  });

  it("serves health and openapi endpoints", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const healthResponse = await app.inject({
      method: "GET",
      url: "/healthz",
    });
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toMatchObject({
      status: "ok",
      api_version: "v1",
      dependencies: {
        retrieval_runtime: "reachable",
      },
    });

    const openApiResponse = await app.inject({
      method: "GET",
      url: "/v1/agent/openapi.json",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(openApiResponse.statusCode).toBe(200);
    expect(openApiResponse.json()).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/v1/agent/sessions": expect.any(Object),
      },
    });
  }, 15_000);
});

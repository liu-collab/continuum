import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../../server.js";
import type { AgentConfig } from "../../config/index.js";
import type { PrepareContextResult } from "../../memory-client/index.js";

const { pickWorkspaceDirectoryMock } = vi.hoisted(() => ({
  pickWorkspaceDirectoryMock: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../workspace-picker.js", () => ({
  pickWorkspaceDirectory: pickWorkspaceDirectoryMock,
}));

const tempRoots: string[] = [];
const runtimeCalls = {
  healthz: vi.fn(async () => ({
    liveness: { status: "alive" as const },
    readiness: { status: "ready" as const },
    dependencies: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      memory_llm: { name: "memory_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
  })),
  dependencyStatus: vi.fn(async () => ({
    read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    memory_llm: { name: "memory_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
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
      memory_llm: { name: "memory_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
    degraded: false,
  })),
  prepareContext: vi.fn(async ({ phase }: { phase: string }): Promise<PrepareContextResult> => ({
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
      memory_llm: { name: "memory_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
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
      memory_llm: { name: "memory_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
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
    createProvider: vi.fn((config: { kind: string; model: string }) => ({
      id: () => config.kind,
      model: () => config.model,
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
      injectionTokenBudget: 1_500,
    },
    mcp: {
      servers: [],
    },
    tools: {
      maxOutputChars: 8_192,
      approvalMode: "confirm",
      shellExec: {
        enabled: true,
        timeoutMs: 30_000,
        denyPatterns: [],
      },
    },
    cli: {
      systemPrompt: null,
    },
    context: {
      maxTokens: null,
      reserveTokens: 4_096,
      compactionStrategy: "truncate",
    },
    planning: {
      planMode: "advisory",
    },
    logging: {
      level: "info",
      format: "json",
    },
    streaming: {
      flushChars: 32,
      flushIntervalMs: 30,
    },
    skills: {
      enabled: true,
      autoDiscovery: false,
      discoveryPaths: [],
    },
    locale: "zh-CN",
  };
}

describe("http session routes", () => {
  const apps: Array<ReturnType<typeof createServer>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    pickWorkspaceDirectoryMock.mockReset();
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
      workspace_short_id: string;
      memory_mode: string;
      locale: string;
    };
    expect(created.workspace_id).toBe("project-alpha");
    expect(created.workspace_short_id).toBe("projecta");
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
      latest_event_id: number | null;
    };
    expect(detail.session.workspace_id).toBe("project-alpha");
    expect(detail.session.memory_mode).toBe("workspace_only");
    expect(detail.session.locale).toBe("en-US");
    expect(detail.messages).toEqual([]);
    expect(detail.latest_event_id).toBeGreaterThanOrEqual(2);

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


  it("rejects requests without bearer token", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/sessions"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "token_invalid",
        message: "Invalid or missing token."
      }
    });
  });

  it("returns 404 for unknown session", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/sessions/session-missing",
      headers: {
        authorization: `Bearer ${app.mnaToken}`
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "session_not_found",
        message: "Session not found."
      }
    });
  });

  it("returns workspace_mismatch when the session belongs to another workspace", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

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
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { session_id: string };

    const response = await app.inject({
      method: "GET",
      url: `/v1/agent/sessions/${created.session_id}?workspace_id=project-beta`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "workspace_mismatch",
        message: "Session workspace does not match the requested workspace.",
      },
    });
  });

  it("paginates sessions for a workspace by last_active_at desc", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createOne = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        workspace_id: "project-alpha"
      }
    });
    const firstSession = createOne.json() as { session_id: string };

    await new Promise((resolve) => setTimeout(resolve, 5));

    const createTwo = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        workspace_id: "project-alpha"
      }
    });
    const secondSession = createTwo.json() as { session_id: string };

    await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        workspace_id: "project-beta"
      }
    });

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/agent/sessions?workspace_id=project-alpha&limit=1",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(firstPage.statusCode).toBe(200);
    const firstPayload = firstPage.json() as {
      items: Array<{ id: string; workspace_id: string }>;
      next_cursor: string | null;
    };
    expect(firstPayload.items).toHaveLength(1);
    expect(firstPayload.items[0]?.id).toBe(secondSession.session_id);
    expect(firstPayload.items[0]?.workspace_id).toBe("project-alpha");
    expect(firstPayload.next_cursor).toBeTruthy();

    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/agent/sessions?workspace_id=project-alpha&limit=1&cursor=${encodeURIComponent(firstPayload.next_cursor ?? "")}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(secondPage.statusCode).toBe(200);
    const secondPayload = secondPage.json() as {
      items: Array<{ id: string }>;
      next_cursor: string | null;
    };
    expect(secondPayload.items.every((item) => item.id !== secondSession.session_id)).toBe(true);
    expect(secondPayload.next_cursor).toBeNull();
  });

  it("lists known workspaces and reads file tree by workspace id", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    const workspaceTwoRoot = path.join(home, "workspace-two");
    fs.mkdirSync(path.join(home, ".mna"), { recursive: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(workspaceTwoRoot, { recursive: true });
    fs.writeFileSync(path.join(workspaceTwoRoot, "notes.md"), "# second", "utf8");
    fs.writeFileSync(
      path.join(home, ".mna", "workspaces.json"),
      JSON.stringify({
        [workspaceRoot]: "550e8400-e29b-41d4-a716-446655440000",
        [workspaceTwoRoot]: "workspace-secondary"
      }, null, 2),
      "utf8"
    );

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const workspacesResponse = await app.inject({
      method: "GET",
      url: "/v1/agent/workspaces",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(workspacesResponse.statusCode).toBe(200);
    const workspacesPayload = workspacesResponse.json() as {
      items: Array<{ workspace_id: string; short_id: string; cwd: string; label: string; is_current: boolean }>;
    };
    expect(workspacesPayload.items).toHaveLength(2);
    expect(workspacesPayload.items[0]?.workspace_id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(workspacesPayload.items[0]?.short_id).toBe("550e8400");
    expect(workspacesPayload.items[0]?.is_current).toBe(true);
    expect(workspacesPayload.items.some((item) => item.workspace_id === "workspace-secondary")).toBe(true);
    expect(workspacesPayload.items.some((item) => item.short_id === "workspac")).toBe(true);

    const treeResponse = await app.inject({
      method: "GET",
      url: "/v1/agent/fs/tree?workspace_id=workspace-secondary&path=.",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(treeResponse.statusCode).toBe(200);
    const treePayload = treeResponse.json() as {
      path: string;
      workspace_id: string;
      workspace_short_id: string;
      entries: Array<{ name: string; type: string }>;
    };
    expect(treePayload.workspace_id).toBe("workspace-secondary");
    expect(treePayload.workspace_short_id).toBe("workspac");
    expect(treePayload.entries).toEqual([{ name: "notes.md", type: "file" }]);

    const fileResponse = await app.inject({
      method: "GET",
      url: "/v1/agent/fs/file?workspace_id=workspace-secondary&path=notes.md",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(fileResponse.statusCode).toBe(200);
    expect(fileResponse.json()).toEqual({
      path: "notes.md",
      workspace_id: "workspace-secondary",
      workspace_short_id: "workspac",
      content: "# second"
    });
  });

  it("returns workspace_not_found when the requested workspace mapping is missing", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/fs/tree?workspace_id=workspace-missing&path=.",
      headers: {
        authorization: `Bearer ${app.mnaToken}`
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "workspace_not_found",
        message: "Workspace mapping not found."
      }
    });
  });

  it("registers an arbitrary workspace directory", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    const detachedRoot = path.join(home, "detached");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(detachedRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/workspaces",
      headers: {
        authorization: `Bearer ${app.mnaToken}`
      },
      payload: {
        cwd: detachedRoot
      }
    });

    expect(response.statusCode).toBe(201);
    const payload = response.json() as {
      workspace: {
        workspace_id: string;
        short_id: string;
        cwd: string;
        label: string;
        is_current: boolean;
      };
    };
    expect(payload.workspace.cwd.replace(/\\/g, "/")).toMatch(/\/detached$/);
    expect(payload.workspace.short_id).toHaveLength(8);
    expect(payload.workspace.label).toBe("detached");
    expect(payload.workspace.is_current).toBe(false);
  });

  it("opens the native picker and registers the selected workspace", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    const selectedRoot = path.join(home, "selected-workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(selectedRoot, { recursive: true });
    pickWorkspaceDirectoryMock.mockResolvedValue(selectedRoot);

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/workspaces/pick",
      headers: {
        authorization: `Bearer ${app.mnaToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cancelled: false,
      workspace: {
        label: "selected-workspace",
        is_current: false
      }
    });
  });

  it("returns cancelled when the native picker is closed", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    pickWorkspaceDirectoryMock.mockResolvedValue(null);

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/workspaces/pick",
      headers: {
        authorization: `Bearer ${app.mnaToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      cancelled: true
    });
  });

  it("patches a session title", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const created = createResponse.json() as { session_id: string };

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/v1/agent/sessions/${created.session_id}`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        title: "Renamed session"
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toEqual({ ok: true });

    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/agent/sessions/${created.session_id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    const detail = detailResponse.json() as {
      session: {
        title: string | null;
      };
    };
    expect(detail.session.title).toBe("Renamed session");
  });

  it("ignores non-whitelisted session patch fields", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const created = createResponse.json() as { session_id: string };

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/v1/agent/sessions/${created.session_id}`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        title: "Renamed session",
        memory_mode: "workspace_only"
      }
    });

    expect(patchResponse.statusCode).toBe(200);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/agent/sessions/${created.session_id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    const detail = detailResponse.json() as {
      session: {
        title: string | null;
        memory_mode: string;
      };
    };
    expect(detail.session.title).toBe("Renamed session");
    expect(detail.session.memory_mode).toBe("workspace_plus_global");
  });

  it("soft closes a session over HTTP delete", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const created = createResponse.json() as { session_id: string };

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/v1/agent/sessions/${created.session_id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({
      ok: true,
      purged: false
    });

    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/agent/sessions/${created.session_id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const detail = detailResponse.json() as {
      session: {
        closed_at: string | null;
      };
    };
    expect(detail.session.closed_at).toEqual(expect.any(String));
  });

  it("purges session data and artifacts over HTTP delete", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const created = createResponse.json() as { session_id: string };

    const artifactDir = path.join(home, ".mna", "artifacts", created.session_id);
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, "call-1.txt"), "artifact body", "utf8");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/v1/agent/sessions/${created.session_id}?purge=all`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({
      ok: true,
      purged: true
    });
    expect(fs.existsSync(artifactDir)).toBe(false);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/agent/sessions/${created.session_id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(detailResponse.statusCode).toBe(404);
  });

  it("rejects switching to an unregistered provider", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const created = createResponse.json() as { session_id: string };

    const switchResponse = await app.inject({
      method: "POST",
      url: `/v1/agent/sessions/${created.session_id}/provider`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        provider_id: "openai-compatible",
        model: "gpt-4.1-mini"
      }
    });

    expect(switchResponse.statusCode).toBe(400);
    expect(switchResponse.json()).toEqual({
      error: {
        code: "provider_not_registered",
        message: "Requested provider is not registered."
      }
    });
  });

  it("switches provider model for the next turn and updates dependency status", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const created = createResponse.json() as { session_id: string };
    const session = app.runtimeState.sessions.get(created.session_id);
    expect(session).toBeTruthy();

    await session?.runner.submit("先回答这个问题", "turn-before-switch");

    const beforeInspector = await app.inject({
      method: "GET",
      url: "/v1/agent/turns/turn-before-switch/dispatched-messages",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(beforeInspector.statusCode).toBe(200);
    expect(beforeInspector.json()).toMatchObject({
      turn_id: "turn-before-switch",
      provider_id: "ollama",
      model: "qwen2.5-coder"
    });

    const switchResponse = await app.inject({
      method: "POST",
      url: `/v1/agent/sessions/${created.session_id}/provider`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        provider_id: "ollama",
        model: "qwen2.5-coder:32b",
        temperature: 0.4
      }
    });

    expect(switchResponse.statusCode).toBe(200);
    expect(switchResponse.json()).toEqual({
      ok: true,
      provider_id: "ollama",
      model: "qwen2.5-coder:32b",
      applies_to: "next_turn"
    });

    const dependencyResponse = await app.inject({
      method: "GET",
      url: "/v1/agent/dependency-status",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(dependencyResponse.statusCode).toBe(200);
    expect(dependencyResponse.json()).toMatchObject({
      provider: {
        id: "ollama",
        model: "qwen2.5-coder:32b",
        status: "configured"
      },
      provider_key: "ollama:qwen2.5-coder:32b"
    });

    const updatedSession = app.runtimeState.sessions.get(created.session_id);
    await updatedSession?.runner.submit("再回答一次", "turn-after-switch");

    const afterInspector = await app.inject({
      method: "GET",
      url: "/v1/agent/turns/turn-after-switch/dispatched-messages",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(afterInspector.statusCode).toBe(200);
    expect(afterInspector.json()).toMatchObject({
      turn_id: "turn-after-switch",
      provider_id: "ollama",
      model: "qwen2.5-coder:32b"
    });
  });

  it("returns 404 for unknown prompt inspector turn", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/turns/turn-missing/dispatched-messages",
      headers: {
        authorization: `Bearer ${app.mnaToken}`
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "turn_not_found",
        message: "Turn not found."
      }
    });
  });

  it("returns prompt inspector payload for a persisted turn", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const created = createResponse.json() as { session_id: string };
    const session = app.runtimeState.sessions.get(created.session_id);
    expect(session).toBeTruthy();

    await session?.runner.submit("读取当前上下文", "turn-inspector");

    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/turns/turn-inspector/dispatched-messages",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      turn_id: "turn-inspector",
      provider_id: "ollama",
      model: "qwen2.5-coder",
      round: 1
    });
    const payload = response.json() as {
      messages: Array<{ role: string; content: string }>;
      prompt_segments: Array<{ kind: string; priority: string }>;
      phase_results: Array<{ phase: string; degraded: boolean }>;
      tools: Array<Record<string, unknown>>;
    };
    expect(payload.messages.at(0)?.role).toBe("system");
    expect(payload.prompt_segments.length).toBeGreaterThan(0);
    expect(payload.phase_results).toEqual([
      {
        phase: "task_start",
        trace_id: "trace-task_start",
        degraded: false,
      },
      {
        phase: "before_response",
        trace_id: "trace-before_response",
        degraded: false,
      },
    ]);
    expect(payload.prompt_segments[0]).toMatchObject({
      kind: "core_system",
      priority: "fixed",
    });
    expect(payload.messages.at(-1)).toMatchObject({
      role: "user",
      content: "读取当前上下文"
    });
    expect(Array.isArray(payload.tools)).toBe(true);
  });

  it("includes degraded skip reason in phase results when runtime skips recall under degradation", async () => {
    runtimeCalls.prepareContext.mockImplementation(async ({ phase }: { phase: string }) => ({
      trace_id: `trace-${phase}`,
      trigger: phase !== "before_response",
      trigger_reason: "dependency_unavailable",
      memory_packet: null,
      injection_block: null,
      degraded: phase === "before_response",
      degraded_skip_reason:
        phase === "before_response" ? "trigger_dependencies_unavailable" : undefined,
      dependency_status: {
        read_model: {
          name: "read_model" as const,
          status: phase === "before_response" ? "degraded" as const : "healthy" as const,
          detail: "",
          last_checked_at: "now"
        },
        embeddings: {
          name: "embeddings" as const,
          status: phase === "before_response" ? "unavailable" as const : "healthy" as const,
          detail: "",
          last_checked_at: "now"
        },
        storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
        memory_llm: {
          name: "memory_llm" as const,
          status: phase === "before_response" ? "unavailable" as const : "healthy" as const,
          detail: "",
          last_checked_at: "now"
        },
      },
      budget_used: 0,
      memory_packet_ids: [],
    }));

    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const created = createResponse.json() as { session_id: string };
    const session = app.runtimeState.sessions.get(created.session_id);
    expect(session).toBeTruthy();

    await session?.runner.submit("继续刚才那个方案", "turn-degraded-skip");

    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/turns/turn-degraded-skip/dispatched-messages",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      phase_results: [
        {
          phase: "task_start",
          trace_id: "trace-task_start",
          degraded: false,
        },
        {
          phase: "before_response",
          trace_id: "trace-before_response",
          degraded: true,
          degraded_skip_reason: "trigger_dependencies_unavailable",
        },
      ],
    });
  });

  it("returns the latest dispatched round for prompt inspector", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    app.runtimeState.store.createSession({
      id: "session-tool-round",
      workspace_id: "project-alpha",
      user_id: "user-1",
      memory_mode: "workspace_plus_global",
      locale: "zh-CN",
    });
    app.runtimeState.store.openTurn({
      id: "turn-tool-round",
      session_id: "session-tool-round",
    });
    app.runtimeState.store.saveDispatchedMessages("turn-tool-round", {
      messages_json: "[{\"role\":\"user\",\"content\":\"读取 README\"}]",
      tools_json: "[]",
      prompt_segments_json: "[{\"kind\":\"core_system\",\"priority\":\"fixed\",\"preview\":\"system\"}]",
      phase_results_json: "[{\"phase\":\"before_response\",\"trace_id\":\"trace-1\",\"degraded\":false}]",
      provider_id: "ollama",
      model: "qwen2.5-coder",
      round: 2,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/turns/turn-tool-round/dispatched-messages",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      turn_id: "turn-tool-round",
      round: 2,
      phase_results: [
        {
          phase: "before_response",
          trace_id: "trace-1",
          degraded: false,
        },
      ],
      prompt_segments: [
        {
          kind: "core_system",
          priority: "fixed",
          preview: "system",
        },
      ],
    });
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

  it("serves stored artifacts from the shared artifact root", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);
    const token = app.mnaToken;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/agent/sessions",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const created = createResponse.json() as { session_id: string };

    const artifactDir = path.join(home, ".mna", "artifacts", created.session_id);
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, "call-1.txt"), "artifact body", "utf8");

    const artifactResponse = await app.inject({
      method: "GET",
      url: `/v1/agent/artifacts/${created.session_id}/call-1.txt`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(artifactResponse.statusCode).toBe(200);
    expect(artifactResponse.body).toBe("artifact body");
  });

  it("cleans expired artifact directories on startup", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    const artifactsRoot = path.join(home, ".mna", "artifacts");
    const expiredDir = path.join(artifactsRoot, "expired-session");
    const freshDir = path.join(artifactsRoot, "fresh-session");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(expiredDir, { recursive: true });
    fs.mkdirSync(freshDir, { recursive: true });
    fs.writeFileSync(path.join(expiredDir, "call-1.txt"), "expired", "utf8");
    fs.writeFileSync(path.join(freshDir, "call-2.txt"), "fresh", "utf8");

    const expiredAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(expiredDir, expiredAt, expiredAt);
    fs.utimesSync(path.join(expiredDir, "call-1.txt"), expiredAt, expiredAt);

    const app = createServer(createConfig(home, workspaceRoot), { homeDirectory: home });
    apps.push(app);

    expect(fs.existsSync(expiredDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
  });
});

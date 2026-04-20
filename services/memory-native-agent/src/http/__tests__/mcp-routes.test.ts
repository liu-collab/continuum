import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../../server.js";
import type { AgentConfig } from "../../config/index.js";

const runtimeCalls = {
  dependencyStatus: vi.fn(async () => ({
    read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
  })),
  sessionStartContext: vi.fn(async () => null),
  prepareContext: vi.fn(async () => null),
  finalizeTurn: vi.fn(async () => null),
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
        yield {
          type: "end",
          finish_reason: "stop" as const,
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
          },
        };
      },
    })),
  };
});

function createTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mna-mcp-routes-"));
}

function createConfig(workspaceRoot: string): AgentConfig {
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
      maxOutputChars: 8_192,
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

describe("mcp routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists mcp server statuses and discovered tools", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    vi.spyOn(app.runtimeState.mcpRegistry, "listServerStatuses").mockReturnValue([
      {
        name: "filesystem",
        transport: "stdio",
        state: "ok",
        last_error: undefined,
        connected_at: "2026-04-19T00:00:00.000Z",
        tool_count: 2,
      },
    ]);
    vi.spyOn(app.runtimeState.mcpRegistry, "listTools").mockReturnValue([
      {
        server: "filesystem",
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
        },
      },
    ]);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/agent/mcp/servers",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        servers: [
          {
            name: "filesystem",
            transport: "stdio",
            state: "ok",
            last_error: undefined,
            connected_at: "2026-04-19T00:00:00.000Z",
            tool_count: 2,
          },
        ],
        tools: [
          {
            server: "filesystem",
            name: "read_file",
            description: "Read a file",
            input_schema: {
              type: "object",
            },
          },
        ],
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("accepts restart requests even when the registry reconnect fails", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    const restartSpy = vi.spyOn(app.runtimeState.mcpRegistry, "restartServer").mockRejectedValue(new Error("down"));

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/mcp/servers/filesystem/restart",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ ok: true });
      expect(restartSpy).toHaveBeenCalledWith("filesystem");
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("disables a named mcp server", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    const disableSpy = vi.spyOn(app.runtimeState.mcpRegistry, "disableServer").mockImplementation(() => undefined);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/mcp/servers/filesystem/disable",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ ok: true });
      expect(disableSpy).toHaveBeenCalledWith("filesystem");
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

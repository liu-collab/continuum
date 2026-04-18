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
    storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" }
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
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" }
    },
    degraded: false
  })),
  prepareContext: vi.fn(async () => null),
  finalizeTurn: vi.fn(async () => null)
};

vi.mock("../../memory-client/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../memory-client/index.js")>();
  return {
    ...actual,
    MemoryClient: vi.fn().mockImplementation(() => runtimeCalls)
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
        yield {
          type: "end",
          finish_reason: "stop" as const,
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1
          }
        };
      }
    }))
  };
});

function createTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mna-cors-"));
}

function createConfig(workspaceRoot: string): AgentConfig {
  return {
    runtime: {
      baseUrl: "http://127.0.0.1:4100",
      requestTimeoutMs: 800,
      finalizeTimeoutMs: 1_500
    },
    provider: {
      kind: "ollama",
      model: "qwen2.5-coder",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2
    },
    memory: {
      mode: "workspace_plus_global",
      userId: "550e8400-e29b-41d4-a716-446655440001",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      cwd: workspaceRoot
    },
    mcp: {
      servers: []
    },
    tools: {
      shellExec: {
        enabled: true,
        timeoutMs: 30_000,
        denyPatterns: []
      }
    },
    cli: {
      systemPrompt: null
    },
    streaming: {
      flushChars: 32,
      flushIntervalMs: 30
    },
    locale: "zh-CN"
  };
}

describe("http cors", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows loopback visualization origin", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/v1/agent/sessions",
        headers: {
          origin: "http://127.0.0.1:3003"
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3003");
      expect(response.headers["access-control-allow-methods"]).toContain("GET");
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

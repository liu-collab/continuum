import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../../server.js";
import type { AgentConfig } from "../../config/index.js";
import { MNA_VERSION } from "../../shared/types.js";
import { createSessionState } from "../state.js";

const runtimeCalls = {
  dependencyStatus: vi.fn(async () => ({
    read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" }
  })),
  sessionStartContext: vi.fn(async () => null),
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
    createProvider: vi.fn((config: { kind: string; model: string }) => ({
      id: () => config.kind,
      model: () => config.model,
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "mna-health-"));
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

describe("health routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports unreachable runtime in healthz and readyz", async () => {
    runtimeCalls.dependencyStatus.mockRejectedValueOnce(new Error("runtime down"));
    runtimeCalls.dependencyStatus.mockRejectedValueOnce(new Error("runtime down"));

    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const healthResponse = await app.inject({
        method: "GET",
        url: "/healthz"
      });
      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json()).toMatchObject({
        status: "ok",
        version: MNA_VERSION,
        api_version: "v1",
        runtime_min_version: MNA_VERSION,
        dependencies: {
          retrieval_runtime: "unreachable"
        }
      });
      expect(
        MNA_VERSION.localeCompare(
          (healthResponse.json() as { runtime_min_version: string }).runtime_min_version,
          undefined,
          { numeric: true, sensitivity: "base" },
        ),
      ).toBeGreaterThanOrEqual(0);

      const readyResponse = await app.inject({
        method: "GET",
        url: "/readyz"
      });
      expect(readyResponse.statusCode).toBe(200);
      expect(readyResponse.json()).toEqual({
        liveness: {
          status: "alive"
        },
        readiness: {
          status: "ready"
        },
        dependencies: {
          retrieval_runtime: {
            status: "unreachable",
            detail: "runtime down"
          }
        }
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns dependency status with runtime fallback, provider, and mcp fields", async () => {
    runtimeCalls.dependencyStatus.mockRejectedValueOnce(new Error("runtime down"));

    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/agent/dependency-status",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        runtime: {
          status: "unavailable",
          base_url: "http://127.0.0.1:4100"
        },
        provider: {
          id: "ollama",
          model: "qwen2.5-coder",
          status: "configured"
        },
        mcp: [],
        provider_key: "ollama:qwen2.5-coder"
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns metrics counters", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    app.runtimeState.metrics.turnsTotal = 2;
    app.runtimeState.metrics.turnsByFinishReason.stop = 2;
    app.runtimeState.metrics.providerCallsTotal.ollama = 3;
    app.runtimeState.metrics.providerErrorsTotal.timeout = 1;
    app.runtimeState.metrics.toolInvocationsTotal.shell_exec = 4;
    app.runtimeState.metrics.toolDenialsTotal.blocked_pattern = 1;
    app.runtimeState.metrics.streamFlushedEventsTotal = 5;
    app.runtimeState.metrics.streamDroppedAfterAbortTotal = 2;
    app.runtimeState.metrics.runtimeErrorsTotal.runtime_unavailable = 1;

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/agent/metrics",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        uptime_s: expect.any(Number),
        turns_total: 2,
        turns_by_finish_reason: {
          stop: 2
        },
        provider_calls_total: {
          ollama: 3
        },
        provider_errors_total: {
          timeout: 1
        },
        tool_invocations_total: {
          shell_exec: 4
        },
        tool_denials_total: {
          blocked_pattern: 1
        },
        stream_flushed_events_total: 5,
        stream_dropped_after_abort_total: 2,
        runtime_errors_total: {
          runtime_unavailable: 1
        }
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("increments dropped-after-abort metric after an aborted turn", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    const session = createSessionState(app.runtimeState, "session-metrics-abort");
    const initialCount = app.runtimeState.metrics.streamDroppedAfterAbortTotal;

    try {
      const runnerPromise = session.runner.submit("继续", "turn-metrics-abort");
      session.runner.abort("turn-metrics-abort");
      await runnerPromise;

      const response = await app.inject({
        method: "GET",
        url: "/v1/agent/metrics",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        stream_dropped_after_abort_total: expect.any(Number)
      });
      expect((response.json() as { stream_dropped_after_abort_total: number }).stream_dropped_after_abort_total)
        .toBeGreaterThanOrEqual(initialCount);
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

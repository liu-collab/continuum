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
    storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    memory_llm: { name: "memory_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" }
  })),
  checkEmbeddings: vi.fn(async () => ({
    name: "embeddings" as const,
    status: "healthy" as const,
    detail: "embedding request completed",
    last_checked_at: "now",
  })),
  checkMemoryLlm: vi.fn(async () => ({
    name: "memory_llm" as const,
    status: "healthy" as const,
    detail: "memory llm request completed",
    last_checked_at: "now",
  })),
  getRuntimeConfig: vi.fn(async () => ({
    governance: {
      WRITEBACK_MAINTENANCE_ENABLED: false,
      WRITEBACK_MAINTENANCE_INTERVAL_MS: 900000,
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
      WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
      WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
    },
  })),
  updateRuntimeConfig: vi.fn(async (payload: {
    governance?: {
      WRITEBACK_MAINTENANCE_ENABLED?: boolean;
      WRITEBACK_MAINTENANCE_INTERVAL_MS?: number;
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED?: boolean;
      WRITEBACK_GOVERNANCE_SHADOW_MODE?: boolean;
      WRITEBACK_MAINTENANCE_MAX_ACTIONS?: number;
    };
  }) => ({
    ok: true as const,
    governance: {
      WRITEBACK_MAINTENANCE_ENABLED: payload.governance?.WRITEBACK_MAINTENANCE_ENABLED ?? false,
      WRITEBACK_MAINTENANCE_INTERVAL_MS: payload.governance?.WRITEBACK_MAINTENANCE_INTERVAL_MS ?? 900000,
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED: payload.governance?.WRITEBACK_GOVERNANCE_VERIFY_ENABLED ?? true,
      WRITEBACK_GOVERNANCE_SHADOW_MODE: payload.governance?.WRITEBACK_GOVERNANCE_SHADOW_MODE ?? false,
      WRITEBACK_MAINTENANCE_MAX_ACTIONS: payload.governance?.WRITEBACK_MAINTENANCE_MAX_ACTIONS ?? 10,
    },
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
    createProvider: vi.fn((
      config: { kind: string; model: string; apiKey?: string; apiKeyEnv?: string },
      env?: NodeJS.ProcessEnv,
    ) => ({
      id: () => config.kind,
      model: () => config.model,
      status: () => {
        const missingApiKey =
          (config.kind === "openai-compatible" || config.kind === "openai-responses" || config.kind === "anthropic")
          && !config.apiKey
          && !(config.apiKeyEnv && env?.[config.apiKeyEnv]);

        if (missingApiKey) {
          return {
            status: "misconfigured" as const,
            detail: `provider ${config.kind} 缺少 API key 配置`,
          };
        }

        return {
          status: "configured" as const,
          detail: undefined,
        };
      },
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
      temperature: 0.2,
      effort: null,
      maxTokens: null,
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
      maxOutputChars: 8_192,
      approvalMode: "confirm",
      shellExec: {
        enabled: true,
        timeoutMs: 30_000,
        denyPatterns: []
      }
    },
    cli: {
      systemPrompt: null
    },
    context: {
      maxTokens: null,
      reserveTokens: 4_096,
      compactionStrategy: "truncate"
    },
    planning: {
      planMode: "advisory",
    },
    logging: {
      level: "info",
      format: "json"
    },
    streaming: {
      flushChars: 32,
      flushIntervalMs: 30
    },
    skills: {
      enabled: true,
      autoDiscovery: false,
      discoveryPaths: []
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
          base_url: "http://127.0.0.1:4100",
          embeddings: {
            status: "unknown",
            detail: "runtime dependency status is unavailable",
          },
          memory_llm: {
            status: "unknown",
            detail: "runtime dependency status is unavailable",
          }
        },
        provider: {
          id: "ollama",
          model: "qwen2.5-coder",
          status: "configured",
          detail: undefined,
        },
        mcp: [],
        provider_key: "ollama:qwen2.5-coder"
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps the checked memory llm status after refreshing dependency status", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    const memoryServer = await import("fastify").then(({ default: Fastify }) => Fastify({ logger: false }));

    await memoryServer.post("/v1/chat/completions", async () => ({
      id: "chatcmpl-test",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "{\"ok\":true}"
          },
          finish_reason: "stop"
        }
      ]
    }));

    try {
      await memoryServer.listen({ host: "127.0.0.1", port: 0 });
      const address = memoryServer.server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      const configResponse = await app.inject({
        method: "POST",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        },
        payload: {
          memory_llm: {
            base_url: `http://127.0.0.1:${port}`,
            model: "gpt-4.1-mini",
            api_key: "memory-key",
            protocol: "openai-compatible",
            timeout_ms: 3000
          }
        }
      });

      expect(configResponse.statusCode).toBe(200);

      const checkResponse = await app.inject({
        method: "POST",
        url: "/v1/agent/dependency-status/memory-llm/check",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(checkResponse.statusCode).toBe(200);

      const statusResponse = await app.inject({
        method: "GET",
        url: "/v1/agent/dependency-status",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({
        runtime: {
          memory_llm: {
            status: "healthy",
            detail: "memory llm request completed",
          }
        }
      });
    } finally {
      await memoryServer.close();
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reads runtime config and persists updated provider plus embedding config", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const readResponse = await app.inject({
        method: "GET",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(readResponse.statusCode).toBe(200);
      expect(readResponse.json()).toMatchObject({
        provider: {
          kind: "ollama",
          model: "qwen2.5-coder",
          base_url: "http://127.0.0.1:11434",
          effort: null,
          max_tokens: null,
        },
        tools: {
          approval_mode: "confirm",
        },
        planning: {
          plan_mode: "advisory",
        },
        embedding: {
          base_url: null,
          model: null,
          api_key: null
        },
        memory_llm: {
          base_url: null,
          model: "claude-haiku-4-5-20251001",
          api_key: null,
          protocol: "openai-compatible",
          timeout_ms: 15000,
          effort: null,
          max_tokens: null,
        },
        mcp: {
          servers: []
        }
      });

      const writeResponse = await app.inject({
        method: "POST",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        },
        payload: {
          provider: {
            kind: "openai-compatible",
            model: "deepseek-chat",
            base_url: "https://api.deepseek.com",
            api_key: "demo-key",
            effort: "high",
            max_tokens: 6000,
          },
          embedding: {
            base_url: "https://api.openai.com/v1",
            model: "text-embedding-3-small",
            api_key: "embed-key"
          },
          tools: {
            approval_mode: "yolo",
          },
          planning: {
            plan_mode: "confirm",
          },
          memory_llm: {
            base_url: "https://api.anthropic.com",
            model: "claude-haiku-4-5-20251001",
            api_key: "writeback-key",
            protocol: "anthropic",
            timeout_ms: 8000,
            effort: "medium",
            max_tokens: 1200,
          },
          mcp: {
            servers: [
              {
                name: "echo-http",
                transport: "http",
                url: "http://127.0.0.1:7001/mcp",
              },
            ],
          }
        }
      });

      expect(writeResponse.statusCode).toBe(200);
      expect(writeResponse.json()).toEqual({ ok: true });

      const managedDir = path.dirname(path.dirname(app.mnaTokenPath));
      const managedConfigPath = path.join(managedDir, "config.json");
      const managedSecretsPath = path.join(managedDir, "secrets.json");
      expect(JSON.parse(fs.readFileSync(managedConfigPath, "utf8"))).toEqual({
        version: 2,
        provider: {
          kind: "openai-compatible",
          model: "deepseek-chat",
          base_url: "https://api.deepseek.com",
          temperature: 0.2,
          effort: "high",
          max_tokens: 6000,
        },
        embedding: {
          baseUrl: "https://api.openai.com/v1",
          model: "text-embedding-3-small",
        },
        memory_llm: {
          baseUrl: "https://api.anthropic.com",
          model: "claude-haiku-4-5-20251001",
          protocol: "anthropic",
          timeoutMs: 8000,
          effort: "medium",
          maxTokens: 1200,
        },
        tools: {
          approval_mode: "yolo",
        },
        planning: {
          plan_mode: "confirm",
        },
        mcp: {
          servers: [
            {
              name: "echo-http",
              transport: "http",
              url: "http://127.0.0.1:7001/mcp",
            },
          ],
        }
      });

      expect(JSON.parse(fs.readFileSync(managedSecretsPath, "utf8"))).toEqual({
        version: 2,
        provider_api_key: "demo-key",
        embedding_api_key: "embed-key",
        memory_llm_api_key: "writeback-key",
      });

      const configResponse = await app.inject({
        method: "GET",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(configResponse.statusCode).toBe(200);
      expect(configResponse.json()).toMatchObject({
        provider: {
          kind: "openai-compatible",
          model: "deepseek-chat",
          base_url: "https://api.deepseek.com",
          api_key: "demo-key",
          effort: "high",
          max_tokens: 6000,
        },
        tools: {
          approval_mode: "yolo",
        },
        planning: {
          plan_mode: "confirm",
        },
        embedding: {
          base_url: "https://api.openai.com/v1",
          model: "text-embedding-3-small",
          api_key: "embed-key"
        },
        memory_llm: {
          base_url: "https://api.anthropic.com",
          model: "claude-haiku-4-5-20251001",
          api_key: "writeback-key",
          protocol: "anthropic",
          timeout_ms: 8000,
          effort: "medium",
          max_tokens: 1200,
        },
        mcp: {
          servers: [
            {
              name: "echo-http",
              transport: "http",
              url: "http://127.0.0.1:7001/mcp",
            },
          ],
        }
      });

      const dependencyResponse = await app.inject({
        method: "GET",
        url: "/v1/agent/dependency-status",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(dependencyResponse.statusCode).toBe(200);
      expect(dependencyResponse.json()).toMatchObject({
        provider: {
          id: "openai-compatible",
          model: "deepseek-chat",
          status: "configured"
        },
        provider_key: "openai-compatible:deepseek-chat"
      });

      const metricsResponse = await app.inject({
        method: "GET",
        url: "/v1/agent/metrics",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(metricsResponse.statusCode).toBe(200);
      expect(metricsResponse.json()).toMatchObject({
        planning: {
          generated_total: expect.any(Number),
          confirm_required_total: expect.any(Number),
        },
        retries: {
          total: expect.any(Number),
        },
        context_budget: {
          dropped_messages_total: expect.any(Number),
        },
        tool_batches: {
          total: expect.any(Number),
          max_batch_size: expect.any(Number),
        },
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("proxies governance runtime config to retrieval-runtime", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const readResponse = await app.inject({
        method: "GET",
        url: "/v1/agent/runtime/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(readResponse.statusCode).toBe(200);
      expect(readResponse.json()).toMatchObject({
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: false,
          WRITEBACK_MAINTENANCE_INTERVAL_MS: 900000,
        },
      });

      const writeResponse = await app.inject({
        method: "PUT",
        url: "/v1/agent/runtime/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        },
        payload: {
          governance: {
            WRITEBACK_MAINTENANCE_ENABLED: true,
            WRITEBACK_MAINTENANCE_INTERVAL_MS: 300000,
            WRITEBACK_GOVERNANCE_VERIFY_ENABLED: false,
            WRITEBACK_GOVERNANCE_SHADOW_MODE: true,
            WRITEBACK_MAINTENANCE_MAX_ACTIONS: 5,
          },
        },
      });

      expect(writeResponse.statusCode).toBe(200);
      expect(runtimeCalls.updateRuntimeConfig).toHaveBeenCalledWith({
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: true,
          WRITEBACK_MAINTENANCE_INTERVAL_MS: 300000,
          WRITEBACK_GOVERNANCE_VERIFY_ENABLED: false,
          WRITEBACK_GOVERNANCE_SHADOW_MODE: true,
          WRITEBACK_MAINTENANCE_MAX_ACTIONS: 5,
        },
      });
      expect(writeResponse.json()).toMatchObject({
        ok: true,
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: true,
          WRITEBACK_MAINTENANCE_INTERVAL_MS: 300000,
          WRITEBACK_MAINTENANCE_MAX_ACTIONS: 5,
        },
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("proxies an active embedding health check", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/dependency-status/embeddings/check",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(runtimeCalls.checkEmbeddings).toHaveBeenCalledTimes(1);
      expect(response.json()).toEqual({
        name: "embeddings",
        status: "healthy",
        detail: "embedding request completed",
        last_checked_at: "now",
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("proxies an active memory llm health check", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/dependency-status/memory-llm/check",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(runtimeCalls.checkMemoryLlm).toHaveBeenCalledTimes(1);
      expect(response.json()).toEqual({
        name: "memory_llm",
        status: "healthy",
        detail: "memory llm request completed",
        last_checked_at: "now",
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("checks memory llm with the managed config file instead of runtime cached state", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    const memoryServer = await import("fastify").then(({ default: Fastify }) => Fastify({ logger: false }));
    await memoryServer.post("/v1/chat/completions", async () => {
      return {
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "{\"ok\":true}"
            },
            finish_reason: "stop"
          }
        ]
      };
    });

    try {
      await memoryServer.listen({ host: "127.0.0.1", port: 0 });
      const address = memoryServer.server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      const configResponse = await app.inject({
        method: "POST",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        },
        payload: {
          memory_llm: {
            base_url: `http://127.0.0.1:${port}`,
            model: "gpt-4.1-mini",
            api_key: "memory-key",
            protocol: "openai-compatible",
            timeout_ms: 3000,
            effort: "high"
          }
        }
      });

      expect(configResponse.statusCode).toBe(200);

      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/dependency-status/memory-llm/check",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(runtimeCalls.checkMemoryLlm).not.toHaveBeenCalled();
      expect(response.json()).toEqual({
        name: "memory_llm",
        status: "healthy",
        detail: "memory llm request completed",
        last_checked_at: expect.any(String),
      });
    } finally {
      await memoryServer.close();
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports provider API key env hints and accepts api_key_env updates", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), {
      homeDirectory: home,
      env: {
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    });

    try {
      const readResponse = await app.inject({
        method: "GET",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
      });

      expect(readResponse.statusCode).toBe(200);
      expect(readResponse.json()).toMatchObject({
        env_hints: {
          provider_api_key_env: "DEEPSEEK_API_KEY",
        },
      });

      const writeResponse = await app.inject({
        method: "POST",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
        payload: {
          provider: {
            kind: "openai-compatible",
            model: "deepseek-chat",
            base_url: "https://api.deepseek.com",
            api_key_env: "DEEPSEEK_API_KEY",
          },
        },
      });

      expect(writeResponse.statusCode).toBe(200);
      expect(JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"))).toMatchObject({
        version: 2,
        provider: {
          kind: "openai-compatible",
          model: "deepseek-chat",
          base_url: "https://api.deepseek.com",
          api_key_env: "DEEPSEEK_API_KEY",
        },
      });

      const dependencyResponse = await app.inject({
        method: "GET",
        url: "/v1/agent/dependency-status",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
      });

      expect(dependencyResponse.statusCode).toBe(200);
      expect(dependencyResponse.json()).toMatchObject({
        provider: {
          id: "openai-compatible",
          model: "deepseek-chat",
          status: "configured",
        },
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("lists OpenAI-compatible provider models through the local proxy", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const providerServer = await import("fastify").then(({ default: Fastify }) => Fastify({ logger: false }));
    let authHeader: string | undefined;
    await providerServer.get("/v1/models", async (request) => {
      authHeader = request.headers.authorization;
      return {
        object: "list",
        data: [
          { id: "qwen-plus", object: "model" },
          { id: "qwen-turbo", object: "model" },
        ],
      };
    });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      await providerServer.listen({ host: "127.0.0.1", port: 0 });
      const address = providerServer.server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/provider-models",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
        payload: {
          kind: "openai-compatible",
          base_url: `http://127.0.0.1:${port}/v1`,
          api_key: "provider-key",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(authHeader).toBe("Bearer provider-key");
      expect(response.json()).toEqual({
        models: [
          { id: "qwen-plus", label: "qwen-plus" },
          { id: "qwen-turbo", label: "qwen-turbo" },
        ],
      });
    } finally {
      await providerServer.close();
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("lists Ollama models through the local proxy", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const providerServer = await import("fastify").then(({ default: Fastify }) => Fastify({ logger: false }));
    await providerServer.get("/api/tags", async () => ({
      models: [
        { name: "qwen2.5-coder:latest" },
        { name: "nomic-embed-text:latest" },
      ],
    }));

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      await providerServer.listen({ host: "127.0.0.1", port: 0 });
      const address = providerServer.server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/provider-models",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
        payload: {
          kind: "ollama",
          base_url: `http://127.0.0.1:${port}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        models: [
          { id: "nomic-embed-text:latest", label: "nomic-embed-text:latest" },
          { id: "qwen2.5-coder:latest", label: "qwen2.5-coder:latest" },
        ],
      });
    } finally {
      await providerServer.close();
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects provider config when required api_key is missing", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`
        },
        payload: {
          provider: {
            kind: "openai-compatible",
            model: "deepseek-chat",
            base_url: "https://api.deepseek.com"
          }
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        ok: false,
        error: {
          code: "invalid_config_payload",
          message: "provider.api_key: api_key or api_key_env is required for the selected provider.",
        },
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects mcp config when stdio transport is missing command", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/agent/config",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
        payload: {
          mcp: {
            servers: [
              {
                name: "echo-stdio",
                transport: "stdio",
              },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        ok: false,
        error: {
          code: "invalid_config_payload",
          message: "mcp.servers.0.command: command is required for stdio transport.",
        },
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
    app.runtimeState.metrics.latencySamples.prepareContextMs.push(20, 40, 60, 80);
    app.runtimeState.metrics.latencySamples.providerFirstTokenMs.push(100, 200, 300, 400);

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
        },
        latency_p50_ms: {
          prepare_context: 40,
          provider_first_token: 200
        },
        latency_p95_ms: {
          prepare_context: 80,
          provider_first_token: 400
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
    const session = await createSessionState(app.runtimeState, "session-metrics-abort");
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

  it("increments provider error buckets by normalized provider code", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    app.runtimeState.metrics.providerErrorsTotal.rate_limited = 1;
    app.runtimeState.metrics.providerErrorsTotal.stream_error = 2;
    app.runtimeState.metrics.providerErrorsTotal.unavailable = 3;

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
        provider_errors_total: {
          rate_limited: 1,
          stream_error: 2,
          unavailable: 3
        }
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("publishes all normalized provider error buckets in metrics", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    app.runtimeState.metrics.providerErrorsTotal.rate_limited = 2;
    app.runtimeState.metrics.providerErrorsTotal.unavailable = 4;
    app.runtimeState.metrics.providerErrorsTotal.timeout = 6;
    app.runtimeState.metrics.providerErrorsTotal.stream_error = 8;

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/agent/metrics",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        provider_errors_total: {
          rate_limited: 2,
          unavailable: 4,
          timeout: 6,
          stream_error: 8,
        },
      });
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps published latency percentiles within the current performance thresholds when samples are in budget", async () => {
    const home = createTempHome();
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), { homeDirectory: home });
    app.runtimeState.metrics.latencySamples.prepareContextMs.push(120, 180, 220, 320, 480, 640, 790);
    app.runtimeState.metrics.latencySamples.providerFirstTokenMs.push(300, 420, 650, 820, 1100, 1500, 1950);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/agent/metrics",
        headers: {
          authorization: `Bearer ${app.mnaToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as {
        latency_p95_ms: {
          prepare_context: number;
          provider_first_token: number;
        };
      };
      expect(payload.latency_p95_ms.prepare_context).toBeLessThanOrEqual(800);
      expect(payload.latency_p95_ms.provider_first_token).toBeLessThanOrEqual(2000);
    } finally {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

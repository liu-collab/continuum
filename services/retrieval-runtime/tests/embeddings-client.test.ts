import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import type { EmbeddingsClient } from "../src/query/embeddings-client.js";
import { CachedEmbeddingsClient, HttpEmbeddingsClient } from "../src/query/embeddings-client.js";
import { hasCompleteRuntimeWritebackLlmConfig, resolveRuntimeWritebackLlmConfig } from "../src/writeback-llm-config.js";

const cacheConfig = {
  EMBEDDING_BASE_URL: "https://api.openai.com/v1",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_CACHE_TTL_MS: 5 * 60 * 1000,
  EMBEDDING_CACHE_MAX_ENTRIES: 1000,
};

class SpyEmbeddingsClient implements EmbeddingsClient {
  public callCount = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly vector: number[] = [0.1, 0.2, 0.3]) {}

  async embedText(): Promise<number[]> {
    this.callCount += 1;
    if (this.pending.length > 0) {
      await new Promise<void>((resolve) => {
        this.pending.push(resolve);
      });
    }
    return [...this.vector];
  }

  async embedTextAfterRelease(): Promise<number[]> {
    this.callCount += 1;
    await new Promise<void>((resolve) => {
      this.pending.push(resolve);
    });
    return [...this.vector];
  }

  releaseAll() {
    for (const resolve of this.pending.splice(0)) {
      resolve();
    }
  }
}

describe("retrieval-runtime embeddings client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps third-party base path when building embeddings request url", async () => {
    let calledUrl = "";

    globalThis.fetch = (async (input) => {
      calledUrl = String(input);
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.4, 0.5, 0.6] }],
        }),
      } as Response;
    }) as typeof fetch;

    const client = new HttpEmbeddingsClient({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3002,
      LOG_LEVEL: "info",
      LOG_SAMPLE_RATE: 1,
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
      READ_MODEL_SCHEMA: "storage_shared_v1",
      READ_MODEL_TABLE: "memory_read_model_v1",
      RUNTIME_SCHEMA: "runtime_private",
      STORAGE_WRITEBACK_URL: "http://localhost:3001",
      EMBEDDING_BASE_URL: "https://api.openai.com/v1",
      EMBEDDING_MODEL: "text-embedding-3-small",
      EMBEDDING_API_KEY: "test-key",
      EMBEDDING_CACHE_TTL_MS: 5 * 60 * 1000,
      EMBEDDING_CACHE_MAX_ENTRIES: 1000,
      MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
      MEMORY_LLM_PROTOCOL: "openai-compatible",
      MEMORY_LLM_TIMEOUT_MS: 15000,
      MEMORY_LLM_FALLBACK_ENABLED: true,
      MEMORY_LLM_DEGRADED_THRESHOLD: 0.5,
      MEMORY_LLM_RECOVERY_INTERVAL_MS: 5 * 60 * 1000,
      RECALL_LLM_JUDGE_ENABLED: true,
      RECALL_LLM_JUDGE_MAX_TOKENS: 400,
      RECALL_LLM_CANDIDATE_LIMIT: 12,
      WRITEBACK_MAX_CANDIDATES: 3,
      WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS: 5000,
      WRITEBACK_OUTBOX_BATCH_SIZE: 50,
      WRITEBACK_OUTBOX_MAX_RETRIES: 5,
      MEMORY_LLM_REFINE_MAX_TOKENS: 800,
      WRITEBACK_REFINE_ENABLED: true,
      WRITEBACK_MAINTENANCE_ENABLED: false,
      WRITEBACK_MAINTENANCE_INTERVAL_MS: 900_000,
      WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS: 3_600_000,
      WRITEBACK_MAINTENANCE_WORKSPACE_BATCH: 3,
      WRITEBACK_MAINTENANCE_SEED_LIMIT: 20,
      WRITEBACK_MAINTENANCE_RELATED_LIMIT: 40,
      WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD: 0.35,
      WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS: 86_400_000,
      WRITEBACK_MAINTENANCE_TIMEOUT_MS: 10_000,
      WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1500,
      WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
      WRITEBACK_MAINTENANCE_MIN_IMPORTANCE: 2,
      WRITEBACK_MAINTENANCE_ACTOR_ID: "retrieval-runtime-maintenance",
      WRITEBACK_SESSION_EPISODIC_TTL_MS: 7 * 24 * 60 * 60 * 1000,
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
      WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: 1000,
      WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE: 0.85,
      WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE: 0.92,
      WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
      FINALIZE_IDEMPOTENCY_TTL_MS: 5 * 60 * 1000,
      FINALIZE_IDEMPOTENCY_MAX_ENTRIES: 500,
      WRITEBACK_INPUT_OVERLAP_THRESHOLD: 0.2,
      WRITEBACK_CROSS_REFERENCE_CONFIRMATION_THRESHOLD: 0.85,
      WRITEBACK_CROSS_REFERENCE_PARTIAL_MATCH_THRESHOLD: 0.7,
      QUERY_TIMEOUT_MS: 50,
      STORAGE_TIMEOUT_MS: 50,
      EMBEDDING_TIMEOUT_MS: 50,
      QUERY_CANDIDATE_LIMIT: 30,
      PACKET_RECORD_LIMIT: 10,
      INJECTION_RECORD_LIMIT: 5,
      INJECTION_TOKEN_BUDGET: 1500,
      INJECTION_DEDUP_ENABLED: true,
      INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 5,
      INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
      INJECTION_HARD_WINDOW_TURNS_EPISODIC: 2,
      INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 30 * 60 * 1000,
      INJECTION_HARD_WINDOW_MS_TASK_STATE: 10 * 60 * 1000,
      INJECTION_HARD_WINDOW_MS_EPISODIC: 5 * 60 * 1000,
      INJECTION_SOFT_WINDOW_MS_TASK_STATE: 30 * 60 * 1000,
      INJECTION_SOFT_WINDOW_MS_EPISODIC: 15 * 60 * 1000,
      INJECTION_RECENT_STATE_TTL_MS: 60 * 60 * 1000,
      INJECTION_RECENT_STATE_MAX_SESSIONS: 500,
      SEMANTIC_TRIGGER_THRESHOLD: 0.72,
      IMPORTANCE_THRESHOLD_SESSION_START: 4,
      IMPORTANCE_THRESHOLD_DEFAULT: 3,
      IMPORTANCE_THRESHOLD_SEMANTIC: 4,
    });

    const embedding = await client.embedText("hello");

    expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    expect(embedding).toEqual([0.4, 0.5, 0.6]);
  });

  it("does not require embedding config during startup config loading", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "3002",
      LOG_LEVEL: "info",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
      READ_MODEL_SCHEMA: "storage_shared_v1",
      READ_MODEL_TABLE: "memory_read_model_v1",
      RUNTIME_SCHEMA: "runtime_private",
      STORAGE_WRITEBACK_URL: "http://localhost:3001",
    });

    expect(config.EMBEDDING_BASE_URL).toBeUndefined();
    expect(config.EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(config.EMBEDDING_TIMEOUT_MS).toBe(30_000);
  });

  it("reports not configured before managed embedding config is added", () => {
    const client = new HttpEmbeddingsClient({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3002,
      LOG_LEVEL: "info",
      LOG_SAMPLE_RATE: 1,
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
      READ_MODEL_SCHEMA: "storage_shared_v1",
      READ_MODEL_TABLE: "memory_read_model_v1",
      RUNTIME_SCHEMA: "runtime_private",
      STORAGE_WRITEBACK_URL: "http://localhost:3001",
      EMBEDDING_MODEL: "text-embedding-3-small",
      EMBEDDING_CACHE_TTL_MS: 5 * 60 * 1000,
      EMBEDDING_CACHE_MAX_ENTRIES: 1000,
      MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
      MEMORY_LLM_PROTOCOL: "openai-compatible",
      MEMORY_LLM_TIMEOUT_MS: 15000,
      MEMORY_LLM_FALLBACK_ENABLED: true,
      MEMORY_LLM_DEGRADED_THRESHOLD: 0.5,
      MEMORY_LLM_RECOVERY_INTERVAL_MS: 5 * 60 * 1000,
      RECALL_LLM_JUDGE_ENABLED: true,
      RECALL_LLM_JUDGE_MAX_TOKENS: 400,
      RECALL_LLM_CANDIDATE_LIMIT: 12,
      WRITEBACK_MAX_CANDIDATES: 3,
      WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS: 5000,
      WRITEBACK_OUTBOX_BATCH_SIZE: 50,
      WRITEBACK_OUTBOX_MAX_RETRIES: 5,
      MEMORY_LLM_REFINE_MAX_TOKENS: 800,
      WRITEBACK_REFINE_ENABLED: true,
      WRITEBACK_MAINTENANCE_ENABLED: false,
      WRITEBACK_MAINTENANCE_INTERVAL_MS: 900_000,
      WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS: 3_600_000,
      WRITEBACK_MAINTENANCE_WORKSPACE_BATCH: 3,
      WRITEBACK_MAINTENANCE_SEED_LIMIT: 20,
      WRITEBACK_MAINTENANCE_RELATED_LIMIT: 40,
      WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD: 0.35,
      WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS: 86_400_000,
      WRITEBACK_MAINTENANCE_TIMEOUT_MS: 10_000,
      WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1500,
      WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
      WRITEBACK_MAINTENANCE_MIN_IMPORTANCE: 2,
      WRITEBACK_MAINTENANCE_ACTOR_ID: "retrieval-runtime-maintenance",
      WRITEBACK_SESSION_EPISODIC_TTL_MS: 7 * 24 * 60 * 60 * 1000,
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
      WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: 1000,
      WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE: 0.85,
      WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE: 0.92,
      WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
      FINALIZE_IDEMPOTENCY_TTL_MS: 5 * 60 * 1000,
      FINALIZE_IDEMPOTENCY_MAX_ENTRIES: 500,
      WRITEBACK_INPUT_OVERLAP_THRESHOLD: 0.2,
      WRITEBACK_CROSS_REFERENCE_CONFIRMATION_THRESHOLD: 0.85,
      WRITEBACK_CROSS_REFERENCE_PARTIAL_MATCH_THRESHOLD: 0.7,
      QUERY_TIMEOUT_MS: 50,
      STORAGE_TIMEOUT_MS: 50,
      EMBEDDING_TIMEOUT_MS: 50,
      QUERY_CANDIDATE_LIMIT: 30,
      PACKET_RECORD_LIMIT: 10,
      INJECTION_RECORD_LIMIT: 5,
      INJECTION_TOKEN_BUDGET: 1500,
      INJECTION_DEDUP_ENABLED: true,
      INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 5,
      INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
      INJECTION_HARD_WINDOW_TURNS_EPISODIC: 2,
      INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 30 * 60 * 1000,
      INJECTION_HARD_WINDOW_MS_TASK_STATE: 10 * 60 * 1000,
      INJECTION_HARD_WINDOW_MS_EPISODIC: 5 * 60 * 1000,
      INJECTION_SOFT_WINDOW_MS_TASK_STATE: 30 * 60 * 1000,
      INJECTION_SOFT_WINDOW_MS_EPISODIC: 15 * 60 * 1000,
      INJECTION_RECENT_STATE_TTL_MS: 60 * 60 * 1000,
      INJECTION_RECENT_STATE_MAX_SESSIONS: 500,
      SEMANTIC_TRIGGER_THRESHOLD: 0.72,
      IMPORTANCE_THRESHOLD_SESSION_START: 4,
      IMPORTANCE_THRESHOLD_DEFAULT: 3,
      IMPORTANCE_THRESHOLD_SEMANTIC: 4,
    });

    expect(client.isConfigured()).toBe(false);
  });

  it("reads managed embedding config from a shared file", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-embedding-"));
    const configPath = path.join(tempDir, "embedding-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        apiKey: "shared-key",
      }),
      "utf8",
    );

    let calledUrl = "";
    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer shared-key");
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const client = new HttpEmbeddingsClient({
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: 3002,
        LOG_LEVEL: "info",
        LOG_SAMPLE_RATE: 1,
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
        READ_MODEL_SCHEMA: "storage_shared_v1",
        READ_MODEL_TABLE: "memory_read_model_v1",
        RUNTIME_SCHEMA: "runtime_private",
        STORAGE_WRITEBACK_URL: "http://localhost:3001",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_CACHE_TTL_MS: 5 * 60 * 1000,
        EMBEDDING_CACHE_MAX_ENTRIES: 1000,
        AXIS_EMBEDDING_CONFIG_PATH: configPath,
        MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
        MEMORY_LLM_PROTOCOL: "openai-compatible",
        MEMORY_LLM_TIMEOUT_MS: 15000,
        MEMORY_LLM_FALLBACK_ENABLED: true,
        MEMORY_LLM_DEGRADED_THRESHOLD: 0.5,
        MEMORY_LLM_RECOVERY_INTERVAL_MS: 5 * 60 * 1000,
        RECALL_LLM_JUDGE_ENABLED: true,
        RECALL_LLM_JUDGE_MAX_TOKENS: 400,
        RECALL_LLM_CANDIDATE_LIMIT: 12,
        WRITEBACK_MAX_CANDIDATES: 3,
        WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS: 5000,
        WRITEBACK_OUTBOX_BATCH_SIZE: 50,
        WRITEBACK_OUTBOX_MAX_RETRIES: 5,
        MEMORY_LLM_REFINE_MAX_TOKENS: 800,
        WRITEBACK_REFINE_ENABLED: true,
        WRITEBACK_MAINTENANCE_ENABLED: false,
        WRITEBACK_MAINTENANCE_INTERVAL_MS: 900_000,
        WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS: 3_600_000,
        WRITEBACK_MAINTENANCE_WORKSPACE_BATCH: 3,
        WRITEBACK_MAINTENANCE_SEED_LIMIT: 20,
        WRITEBACK_MAINTENANCE_RELATED_LIMIT: 40,
        WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD: 0.35,
        WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS: 86_400_000,
        WRITEBACK_MAINTENANCE_TIMEOUT_MS: 10_000,
        WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1500,
        WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
        WRITEBACK_MAINTENANCE_MIN_IMPORTANCE: 2,
        WRITEBACK_MAINTENANCE_ACTOR_ID: "retrieval-runtime-maintenance",
        WRITEBACK_SESSION_EPISODIC_TTL_MS: 7 * 24 * 60 * 60 * 1000,
        WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
        WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: 1000,
        WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE: 0.85,
        WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE: 0.92,
        WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
        FINALIZE_IDEMPOTENCY_TTL_MS: 5 * 60 * 1000,
        FINALIZE_IDEMPOTENCY_MAX_ENTRIES: 500,
        WRITEBACK_INPUT_OVERLAP_THRESHOLD: 0.2,
        WRITEBACK_CROSS_REFERENCE_CONFIRMATION_THRESHOLD: 0.85,
        WRITEBACK_CROSS_REFERENCE_PARTIAL_MATCH_THRESHOLD: 0.7,
        QUERY_TIMEOUT_MS: 50,
        STORAGE_TIMEOUT_MS: 50,
        EMBEDDING_TIMEOUT_MS: 50,
        QUERY_CANDIDATE_LIMIT: 30,
        PACKET_RECORD_LIMIT: 10,
        INJECTION_RECORD_LIMIT: 5,
        INJECTION_TOKEN_BUDGET: 1500,
        INJECTION_DEDUP_ENABLED: true,
        INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 5,
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
        INJECTION_HARD_WINDOW_TURNS_EPISODIC: 2,
        INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 30 * 60 * 1000,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 10 * 60 * 1000,
        INJECTION_HARD_WINDOW_MS_EPISODIC: 5 * 60 * 1000,
        INJECTION_SOFT_WINDOW_MS_TASK_STATE: 30 * 60 * 1000,
        INJECTION_SOFT_WINDOW_MS_EPISODIC: 15 * 60 * 1000,
        INJECTION_RECENT_STATE_TTL_MS: 60 * 60 * 1000,
        INJECTION_RECENT_STATE_MAX_SESSIONS: 500,
        SEMANTIC_TRIGGER_THRESHOLD: 0.72,
        IMPORTANCE_THRESHOLD_SESSION_START: 4,
        IMPORTANCE_THRESHOLD_DEFAULT: 3,
        IMPORTANCE_THRESHOLD_SEMANTIC: 4,
      });

      expect(client.isConfigured()).toBe(true);
      await expect(client.embedText("hello")).resolves.toEqual([0.1, 0.2, 0.3]);
      expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reads managed memory llm config from a shared file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-writeback-"));
    const configPath = path.join(tempDir, "memory-llm-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        baseUrl: "https://api.anthropic.com",
        model: "claude-haiku-4-5-20251001",
        apiKey: "writeback-key",
        protocol: "anthropic",
        timeoutMs: 8000,
      }),
      "utf8",
    );

    try {
      const resolved = resolveRuntimeWritebackLlmConfig({
        MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
        AXIS_MEMORY_LLM_CONFIG_PATH: configPath,
      });

      expect(resolved).toEqual({
        baseUrl: "https://api.anthropic.com",
        model: "claude-haiku-4-5-20251001",
        apiKey: "writeback-key",
        protocol: "anthropic",
        timeoutMs: 8000,
      });
      expect(
        hasCompleteRuntimeWritebackLlmConfig({
          AXIS_MEMORY_LLM_CONFIG_PATH: configPath,
        }),
      ).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("caches normalized embedding requests and returns defensive copies", async () => {
    const inner = new SpyEmbeddingsClient([0.4, 0.5, 0.6]);
    const client = new CachedEmbeddingsClient(inner, cacheConfig);

    const first = await client.embedText(" hello\nworld ");
    first[0] = 9;
    const second = await client.embedText("hello world");

    expect(second).toEqual([0.4, 0.5, 0.6]);
    expect(inner.callCount).toBe(1);
    expect(client.stats()).toMatchObject({
      enabled: true,
      entries: 1,
      hits: 1,
      misses: 1,
      max_entries: 1000,
      ttl_ms: 5 * 60 * 1000,
    });
  });

  it("deduplicates concurrent embedding requests for the same normalized input", async () => {
    const inner = new SpyEmbeddingsClient([0.7, 0.8, 0.9]);
    inner.embedText = inner.embedTextAfterRelease.bind(inner);
    const client = new CachedEmbeddingsClient(inner, cacheConfig);

    const first = client.embedText("same query");
    const second = client.embedText("same   query");

    expect(inner.callCount).toBe(1);
    inner.releaseAll();

    await expect(Promise.all([first, second])).resolves.toEqual([
      [0.7, 0.8, 0.9],
      [0.7, 0.8, 0.9],
    ]);
    expect(client.stats()).toMatchObject({
      hits: 1,
      misses: 1,
      entries: 1,
    });
  });

  it("bypasses cache when embedding cache limits are disabled", async () => {
    const inner = new SpyEmbeddingsClient([0.1, 0.2, 0.3]);
    const client = new CachedEmbeddingsClient(inner, {
      ...cacheConfig,
      EMBEDDING_CACHE_TTL_MS: 0,
    });

    await client.embedText("hello");
    await client.embedText("hello");

    expect(inner.callCount).toBe(2);
    expect(client.stats()).toMatchObject({
      enabled: false,
      entries: 0,
      hits: 0,
      misses: 2,
    });
  });

  it("keeps embedding cache keys separate across active embedding models", async () => {
    const inner = new SpyEmbeddingsClient([0.1, 0.2, 0.3]);
    const firstClient = new CachedEmbeddingsClient(inner, {
      ...cacheConfig,
      EMBEDDING_MODEL: "text-embedding-3-small",
    });
    const secondClient = new CachedEmbeddingsClient(inner, {
      ...cacheConfig,
      EMBEDDING_MODEL: "text-embedding-3-large",
    });

    await firstClient.embedText("hello");
    await firstClient.embedText("hello");
    await secondClient.embedText("hello");

    expect(inner.callCount).toBe(2);
  });
});

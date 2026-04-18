import { afterEach, describe, expect, it } from "vitest";

import { HttpEmbeddingsClient } from "../src/query/embeddings-client.js";

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
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
      READ_MODEL_SCHEMA: "storage_shared_v1",
      READ_MODEL_TABLE: "memory_read_model_v1",
      RUNTIME_SCHEMA: "runtime_private",
      STORAGE_WRITEBACK_URL: "http://localhost:3001",
      EMBEDDING_BASE_URL: "https://api.openai.com/v1",
      EMBEDDING_MODEL: "text-embedding-3-small",
      EMBEDDING_API_KEY: "test-key",
      WRITEBACK_LLM_MODEL: "claude-haiku-4-5-20251001",
      WRITEBACK_LLM_TIMEOUT_MS: 5000,
      WRITEBACK_MAX_CANDIDATES: 3,
      QUERY_TIMEOUT_MS: 50,
      STORAGE_TIMEOUT_MS: 50,
      EMBEDDING_TIMEOUT_MS: 50,
      QUERY_CANDIDATE_LIMIT: 30,
      PACKET_RECORD_LIMIT: 10,
      INJECTION_RECORD_LIMIT: 5,
      INJECTION_TOKEN_BUDGET: 1500,
      SEMANTIC_TRIGGER_THRESHOLD: 0.72,
      IMPORTANCE_THRESHOLD_SESSION_START: 4,
      IMPORTANCE_THRESHOLD_DEFAULT: 3,
      IMPORTANCE_THRESHOLD_SEMANTIC: 4,
    });

    const embedding = await client.embedText("hello");

    expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    expect(embedding).toEqual([0.4, 0.5, 0.6]);
  });
});

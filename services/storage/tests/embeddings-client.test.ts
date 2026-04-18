import { afterEach, describe, expect, it } from "vitest";

import { HttpEmbeddingsClient } from "../src/db/embeddings-client.js";

const baseConfig = {
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
  embedding_base_url: "https://api.openai.com/v1",
  embedding_api_key: "test-key",
  embedding_model: "text-embedding-3-small",
  redis_url: undefined,
};

describe("storage embeddings client", () => {
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
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as Response;
    }) as typeof fetch;

    const client = new HttpEmbeddingsClient(baseConfig);
    const embedding = await client.embedText("hello");

    expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("supports batch embeddings on third-party endpoints", async () => {
    let calledUrl = "";
    let payloadInput: unknown;

    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      payloadInput = init?.body ? JSON.parse(String(init.body)) : null;
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        }),
      } as Response;
    }) as typeof fetch;

    const client = new HttpEmbeddingsClient(baseConfig);
    const embeddings = await client.embedTexts!(["hello", "world"]);

    expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    expect(payloadInput).toMatchObject({ input: ["hello", "world"] });
    expect(embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });
});

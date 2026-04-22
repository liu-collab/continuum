import { afterEach, describe, expect, it } from "vitest";

import { callMemoryLlm, parseMemoryLlmJsonPayload } from "../src/memory-orchestrator/llm-client.js";

describe("memory orchestrator llm client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("targets the anthropic messages endpoint and extracts text blocks", async () => {
    let calledUrl = "";

    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
      return {
        ok: true,
        json: async () => ({
          content: [
            {
              type: "text",
              text: "{\"ok\":true}",
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const result = await callMemoryLlm(
      {
        MEMORY_LLM_BASE_URL: "https://api.anthropic.com",
        MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
        MEMORY_LLM_API_KEY: "test-key",
        MEMORY_LLM_PROTOCOL: "anthropic",
        MEMORY_LLM_TIMEOUT_MS: 500,
        MEMORY_LLM_EFFORT: "medium",
      },
      "system",
      { ping: true },
      64,
    );

    expect(calledUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(result).toBe("{\"ok\":true}");
  });

  it("targets the openai-compatible chat endpoint and extracts message content", async () => {
    let calledUrl = "";

    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer openai-key");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "{\"ok\":true,\"source\":\"openai\"}",
              },
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const result = await callMemoryLlm(
      {
        MEMORY_LLM_BASE_URL: "https://api.openai.com/v1",
        MEMORY_LLM_MODEL: "gpt-5-mini",
        MEMORY_LLM_API_KEY: "openai-key",
        MEMORY_LLM_PROTOCOL: "openai-compatible",
        MEMORY_LLM_TIMEOUT_MS: 500,
        MEMORY_LLM_EFFORT: "high",
      },
      "system",
      { ping: true },
      64,
    );

    expect(calledUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(result).toBe("{\"ok\":true,\"source\":\"openai\"}");
  });

  it("retries openai-compatible requests without response_format for compatibility endpoints", async () => {
    let callCount = 0;

    globalThis.fetch = (async (_input, init) => {
      callCount += 1;
      const parsedBody = JSON.parse(String(init?.body)) as {
        response_format?: unknown;
      };

      if (callCount === 1) {
        expect(parsedBody.response_format).toEqual({ type: "json_object" });
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: "unsupported response_format" } }),
        } as Response;
      }

      expect(parsedBody.response_format).toBeUndefined();
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "{\"ok\":true,\"source\":\"fallback\"}",
              },
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const result = await callMemoryLlm(
      {
        MEMORY_LLM_BASE_URL: "https://compat.example.com/v1",
        MEMORY_LLM_MODEL: "gpt-5.3-codex-spark",
        MEMORY_LLM_API_KEY: "compat-key",
        MEMORY_LLM_PROTOCOL: "openai-compatible",
        MEMORY_LLM_TIMEOUT_MS: 500,
        MEMORY_LLM_EFFORT: "medium",
      },
      "system",
      { ping: true },
      64,
    );

    expect(callCount).toBe(2);
    expect(result).toBe("{\"ok\":true,\"source\":\"fallback\"}");
  });

  it("parses fenced json payloads", () => {
    expect(
      parseMemoryLlmJsonPayload("```json\n{\"reason\":\"ok\",\"should_search\":true}\n```"),
    ).toEqual({
      reason: "ok",
      should_search: true,
    });
  });
});

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
    let systemPrompt = "";

    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer openai-key");
      const parsedBody = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      systemPrompt = parsedBody.messages.find((message) => message.role === "system")?.content ?? "";
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
    expect(systemPrompt.toLowerCase()).toContain("json");
    expect(result).toBe("{\"ok\":true,\"source\":\"openai\"}");
  });

  it("targets the OpenAI Responses endpoint and extracts output text", async () => {
    let calledUrl = "";
    let parsedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer openai-key");
      parsedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "{\"ok\":true,\"source\":\"responses\"}",
                },
              ],
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const result = await callMemoryLlm(
      {
        MEMORY_LLM_BASE_URL: "https://api.openai.com/v1",
        MEMORY_LLM_MODEL: "gpt-4.1-mini",
        MEMORY_LLM_API_KEY: "openai-key",
        MEMORY_LLM_PROTOCOL: "openai-responses",
        MEMORY_LLM_TIMEOUT_MS: 500,
        MEMORY_LLM_EFFORT: "medium",
      },
      "system",
      { ping: true },
      64,
    );

    expect(calledUrl).toBe("https://api.openai.com/v1/responses");
    expect(parsedBody).toMatchObject({
      model: "gpt-4.1-mini",
      store: false,
      max_output_tokens: 64,
    });
    expect(String(parsedBody.input).toLowerCase()).toContain("json");
    expect(result).toBe("{\"ok\":true,\"source\":\"responses\"}");
  });

  it("targets the Ollama chat endpoint and extracts message content", async () => {
    let calledUrl = "";
    let parsedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input, init) => {
      calledUrl = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      parsedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({
          message: {
            content: "{\"ok\":true,\"source\":\"ollama\"}",
          },
        }),
      } as Response;
    }) as typeof fetch;

    const result = await callMemoryLlm(
      {
        MEMORY_LLM_BASE_URL: "http://127.0.0.1:11434",
        MEMORY_LLM_MODEL: "qwen2.5-coder",
        MEMORY_LLM_PROTOCOL: "ollama",
        MEMORY_LLM_TIMEOUT_MS: 500,
        MEMORY_LLM_EFFORT: "medium",
      },
      "system",
      { ping: true },
      64,
    );

    expect(calledUrl).toBe("http://127.0.0.1:11434/api/chat");
    expect(parsedBody).toMatchObject({
      model: "qwen2.5-coder",
      stream: false,
    });
    expect(result).toBe("{\"ok\":true,\"source\":\"ollama\"}");
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

  it("retries transient upstream failures before succeeding", async () => {
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount += 1;
      if (callCount < 3) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: "service unavailable" } }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "{\"ok\":true,\"source\":\"retry-success\"}",
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

    expect(callCount).toBe(3);
    expect(result).toBe("{\"ok\":true,\"source\":\"retry-success\"}");
  });

  it("retries one more time for repeated transient failures", async () => {
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount += 1;
      if (callCount < 4) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: { message: "bad gateway" } }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "{\"ok\":true,\"source\":\"retry-fourth\"}",
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

    expect(callCount).toBe(4);
    expect(result).toBe("{\"ok\":true,\"source\":\"retry-fourth\"}");
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

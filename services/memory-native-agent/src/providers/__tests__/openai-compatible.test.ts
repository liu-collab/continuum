import { afterEach, describe, expect, it } from "vitest";

import { OpenAICompatibleProvider } from "../openai-compatible.js";
import { ProviderAuthError, ProviderRateLimitedError, ProviderTimeoutError, ProviderUnavailableError } from "../types.js";
import { collectChunks, sseStream, startProviderMock } from "./test-helpers.js";

describe("OpenAICompatibleProvider", () => {
  const apps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("streams text deltas and emits final usage", async () => {
    let requestUserAgent: string | undefined;
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (request, reply) => {
        requestUserAgent = request.headers["user-agent"];
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"，世界\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":7}}\n",
            "data: [DONE]\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
    });

    const chunks = await collectChunks(
      provider.chat({
        messages: [{ role: "user", content: "你好" }],
      }),
    );

    expect(chunks).toEqual([
      { type: "text_delta", text: "你好" },
      { type: "text_delta", text: "，世界" },
      { type: "end", finish_reason: "stop", usage: { prompt_tokens: 11, completion_tokens: 7 } },
    ]);
    expect(requestUserAgent).toBe("continuum-mna/0.1.0 (+provider=openai-compatible)");
  });

  it("buffers tool call arguments until a complete call is available", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (_request, reply) => {
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"fs_read\",\"arguments\":\"{\\\"path\\\":\\\"REA\"}}]}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"DME.md\\\"}\"}}]}}]}\n",
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n",
            "data: [DONE]\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
    });

    const chunks = await collectChunks(
      provider.chat({
        messages: [{ role: "user", content: "读取 README" }],
      }),
    );

    expect(chunks[0]).toEqual({
      type: "tool_call",
      call: {
        id: "call_1",
        name: "fs_read",
        args: {
          path: "README.md",
        },
      },
    });
    expect(chunks[1]).toEqual({
      type: "end",
      finish_reason: "tool_use",
      usage: {
        prompt_tokens: 9,
        completion_tokens: 4,
      },
    });
  });

  it("retries stream mode when stream payload is invalid before any chunk", async () => {
    const seenStreams: boolean[] = [];
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (request, reply) => {
        const body = request.body as { stream?: boolean };
        seenStreams.push(Boolean(body.stream));
        reply.header("content-type", "text/event-stream");
        return reply.send(sseStream(["data: {not-json}\n"]));
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
      runtimeSettings: {
        maxRetries: 1,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toThrow("OpenAI-compatible provider returned invalid JSON in stream.");
    expect(seenStreams).toEqual([true, true]);
  });

  it("throws rate-limited errors after the single retry is exhausted", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (_request, reply) => {
        reply.header("retry-after", "0");
        reply.status(429).send({ error: { message: "slow down" } });
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
      runtimeSettings: {
        maxRetries: 0,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toBeInstanceOf(ProviderRateLimitedError);
  });

  it("throws auth errors for upstream 401 responses without retrying", async () => {
    let requestCount = 0;
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (_request, reply) => {
        requestCount += 1;
        reply.status(401).send({ error: { message: "bad key" } });
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
      runtimeSettings: {
        maxRetries: 2,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toBeInstanceOf(ProviderAuthError);
    expect(requestCount).toBe(1);
  });

  it("throws unavailable errors for upstream 5xx responses after retries", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (_request, reply) => {
        reply.status(500).send({ error: { message: "boom" } });
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
      runtimeSettings: {
        maxRetries: 0,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("stops streaming after the caller aborts the request signal", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (_request, reply) => {
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"second\"}}]}\n",
            "data: [DONE]\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
    });

    const controller = new AbortController();
    const chunks: Array<{ type: string; text?: string }> = [];

    await (async () => {
      for await (const chunk of provider.chat({
        messages: [{ role: "user", content: "继续" }],
        signal: controller.signal,
      })) {
        chunks.push(chunk as { type: string; text?: string });
        if (chunk.type === "text_delta") {
          controller.abort();
        }
      }
    })();

    expect(chunks).toEqual([
      {
        type: "text_delta",
        text: "first",
      },
    ]);
  });

  it("throws timeout errors when the first token never arrives", async () => {
    let requestCount = 0;
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async () => {
        requestCount += 1;
        return new Promise(() => undefined);
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
      runtimeSettings: {
        maxRetries: 1,
        firstTokenTimeoutMs: 20,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(requestCount).toBe(2);
  });

  it("preserves multiple tiered system messages in the OpenAI request body", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (request, reply) => {
        requestBody = request.body as Record<string, unknown>;
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1}}\n",
            "data: [DONE]\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
    });

    await collectChunks(
      provider.chat({
        messages: [
          { role: "system", content: "core system prompt" },
          { role: "system", content: "<memory_injection tier=\"high\">high memory</memory_injection>" },
          { role: "system", content: "<memory_summary>summary memory</memory_summary>" },
          { role: "user", content: "继续" },
        ],
      }),
    );

    expect(requestBody).toMatchObject({
      messages: [
        { role: "system", content: "core system prompt" },
        { role: "system", content: "<memory_injection tier=\"high\">high memory</memory_injection>" },
        { role: "system", content: "<memory_summary>summary memory</memory_summary>" },
        { role: "user", content: "继续" },
      ],
    });
  });
});

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
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (_request, reply) => {
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

  it("falls back to non-stream mode when stream payload is invalid before any chunk", async () => {
    const seenStreams: boolean[] = [];
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async (request, reply) => {
        const body = request.body as { stream?: boolean };
        seenStreams.push(Boolean(body.stream));

        if (body.stream) {
          reply.header("content-type", "text/event-stream");
          return reply.send(sseStream(["data: {not-json}\n"]));
        }

        return reply.send({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "降级后的完整输出",
              },
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 6,
          },
        });
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

    const chunks = await collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] }));
    expect(seenStreams).toEqual([true, false]);
    expect(chunks).toEqual([
      { type: "text_delta", text: "降级后的完整输出" },
      { type: "end", finish_reason: "stop", usage: { prompt_tokens: 5, completion_tokens: 6 } },
    ]);
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
    const server = await startProviderMock((app) => {
      app.post("/v1/chat/completions", async () => new Promise(() => undefined));
    });
    apps.push(server.app);

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: "deepseek-chat",
      apiKey: "test-key",
      runtimeSettings: {
        maxRetries: 0,
        firstTokenTimeoutMs: 20,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});

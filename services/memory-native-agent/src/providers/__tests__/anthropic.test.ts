import { afterEach, describe, expect, it } from "vitest";

import { AnthropicProvider } from "../anthropic.js";
import { ProviderTimeoutError, ProviderUnavailableError } from "../types.js";
import { collectChunks, sseStream, startProviderMock } from "./test-helpers.js";

describe("AnthropicProvider", () => {
  const apps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("streams text deltas from SSE events", async () => {
    let requestUserAgent: string | undefined;
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (request, reply) => {
        requestUserAgent = request.headers["user-agent"];
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            "event: message_start\n",
            "data: {\"message\":{\"usage\":{\"input_tokens\":13,\"output_tokens\":0}}}\n\n",
            "event: content_block_delta\n",
            "data: {\"delta\":{\"type\":\"text_delta\",\"text\":\"你好\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"delta\":{\"type\":\"text_delta\",\"text\":\"，Anthropic\"}}\n\n",
            "event: message_delta\n",
            "data: {\"usage\":{\"output_tokens\":8}}\n\n",
            "event: message_stop\n",
            "data: {}\n\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new AnthropicProvider({
      baseUrl: server.baseUrl,
      model: "claude-sonnet",
      apiKey: "anthropic-key",
    });

    const chunks = await collectChunks(provider.chat({ messages: [{ role: "user", content: "你好" }] }));
    expect(chunks).toEqual([
      { type: "text_delta", text: "你好" },
      { type: "text_delta", text: "，Anthropic" },
      { type: "end", finish_reason: "stop", usage: { prompt_tokens: 13, completion_tokens: 8 } },
    ]);
    expect(requestUserAgent).toBe("continuum-mna/0.1.0 (+provider=anthropic)");
  });

  it("buffers tool_use input until a complete JSON object can be emitted", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (_request, reply) => {
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            "event: content_block_start\n",
            "data: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"fs_read\",\"input\":{}}}\n\n",
            "event: content_block_delta\n",
            "data: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\\\"REA\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"DME.md\\\"}\"}}\n\n",
            "event: message_stop\n",
            "data: {}\n\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new AnthropicProvider({
      baseUrl: server.baseUrl,
      model: "claude-sonnet",
      apiKey: "anthropic-key",
    });

    const chunks = await collectChunks(provider.chat({ messages: [{ role: "user", content: "读一下 README" }] }));
    expect(chunks[0]).toEqual({
      type: "tool_call",
      call: {
        id: "toolu_1",
        name: "fs_read",
        args: {
          path: "README.md",
        },
      },
    });
    expect(chunks[1]).toEqual({
      type: "end",
      finish_reason: "tool_use",
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });
  });

  it("retries stream responses when the stream payload is malformed", async () => {
    const seenStreamValues: boolean[] = [];
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (request, reply) => {
        const body = request.body as { stream?: boolean };
        seenStreamValues.push(Boolean(body.stream));
        reply.header("content-type", "text/event-stream");
        return reply.send(sseStream(["event: content_block_delta\n", "data: {not-json}\n\n"]));
      });
    });
    apps.push(server.app);

    const provider = new AnthropicProvider({
      baseUrl: server.baseUrl,
      model: "claude-sonnet",
      apiKey: "anthropic-key",
      runtimeSettings: {
        maxRetries: 1,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toThrow("Anthropic provider returned invalid JSON in stream.");
    expect(seenStreamValues).toEqual([true, true]);
  });

  it("throws unavailable errors for 5xx responses", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (_request, reply) => {
        reply.status(503).send({ error: { message: "down" } });
      });
    });
    apps.push(server.app);

    const provider = new AnthropicProvider({
      baseUrl: server.baseUrl,
      model: "claude-sonnet",
      apiKey: "anthropic-key",
      runtimeSettings: {
        maxRetries: 0,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("maps system prompts and tool schemas into the anthropic request body", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (request, reply) => {
        requestBody = request.body as Record<string, unknown>;
        return reply.send({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 3,
            output_tokens: 2,
          },
        });
      });
    });
    apps.push(server.app);

    const provider = new AnthropicProvider({
      baseUrl: server.baseUrl,
      model: "claude-sonnet",
      apiKey: "anthropic-key",
      runtimeSettings: {
        maxRetries: 0,
      },
    });

    await collectChunks(
      provider.chat({
        messages: [
          { role: "system", content: "你是 memory-native-agent。\n请先读工具输出规则。" },
          { role: "user", content: "读取 README" },
        ],
        tools: [
          {
            name: "fs_read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        ],
      }),
    );

    expect(requestBody).toMatchObject({
      model: "claude-sonnet",
      system: "你是 memory-native-agent。\n请先读工具输出规则。",
      tools: [
        {
          name: "fs_read",
          description: "Read a file",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      ],
    });
    if (!requestBody) {
      throw new Error("expected anthropic request body");
    }
    const anthropicRequest = requestBody as { messages?: unknown };
    expect(anthropicRequest.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "读取 README",
          },
        ],
      },
    ]);
  });

  it("combines multiple tiered memory system blocks into a single anthropic system string", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (request, reply) => {
        requestBody = request.body as Record<string, unknown>;
        return reply.send({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 3,
            output_tokens: 2,
          },
        });
      });
    });
    apps.push(server.app);

    const provider = new AnthropicProvider({
      baseUrl: server.baseUrl,
      model: "claude-sonnet",
      apiKey: "anthropic-key",
      runtimeSettings: {
        maxRetries: 0,
      },
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
      system: "core system prompt\n\n<memory_injection tier=\"high\">high memory</memory_injection>\n\n<memory_summary>summary memory</memory_summary>",
    });
  });

  it("uses a higher default max_tokens when the caller does not provide one", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (request, reply) => {
        requestBody = request.body as Record<string, unknown>;
        return reply.send({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 3,
            output_tokens: 2,
          },
        });
      });
    });
    apps.push(server.app);

    const provider = new AnthropicProvider({
      baseUrl: server.baseUrl,
      model: "claude-sonnet",
      apiKey: "anthropic-key",
      runtimeSettings: {
        maxRetries: 0,
      },
    });

    await collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] }));

    expect(requestBody).toMatchObject({
      max_tokens: 4096,
    });
  });

  it("retries timeout errors in stream mode", async () => {
    let requestCount = 0;
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async () => {
        requestCount += 1;
        return new Promise(() => undefined);
      });
    });
    apps.push(server.app);

    const provider = new AnthropicProvider({
      baseUrl: server.baseUrl,
      model: "claude-sonnet",
      apiKey: "anthropic-key",
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
});

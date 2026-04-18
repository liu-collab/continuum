import { afterEach, describe, expect, it } from "vitest";

import { AnthropicProvider } from "../anthropic.js";
import { ProviderUnavailableError } from "../types.js";
import { collectChunks, sseStream, startProviderMock } from "./test-helpers.js";

describe("AnthropicProvider", () => {
  const apps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("streams text deltas from SSE events", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (_request, reply) => {
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

  it("falls back to non-stream responses when the stream payload is malformed", async () => {
    const seenStreamValues: boolean[] = [];
    const server = await startProviderMock((app) => {
      app.post("/v1/messages", async (request, reply) => {
        const body = request.body as { stream?: boolean };
        seenStreamValues.push(Boolean(body.stream));

        if (body.stream) {
          reply.header("content-type", "text/event-stream");
          return reply.send(sseStream(["event: content_block_delta\n", "data: {not-json}\n\n"]));
        }

        return reply.send({
          content: [{ type: "text", text: "非流式回退内容" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 6,
            output_tokens: 7,
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

    const chunks = await collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] }));
    expect(seenStreamValues).toEqual([true, false]);
    expect(chunks).toEqual([
      { type: "text_delta", text: "非流式回退内容" },
      { type: "end", finish_reason: "stop", usage: { prompt_tokens: 6, completion_tokens: 7 } },
    ]);
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
});

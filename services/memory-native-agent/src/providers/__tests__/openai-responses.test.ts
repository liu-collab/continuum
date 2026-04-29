import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAIResponsesProvider } from "../openai-responses.js";
import { ProviderAuthError, ProviderRateLimitedError, ProviderTimeoutError, ProviderUnavailableError } from "../types.js";
import { collectChunks, sseStream, startProviderMock } from "./test-helpers.js";

function responsesEvent(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function completedEvent(usage = { input_tokens: 11, output_tokens: 7 }, output: unknown[] = []) {
  return responsesEvent({
    type: "response.completed",
    sequence_number: 99,
    response: {
      id: "resp_1",
      object: "response",
      created_at: 1,
      output,
      output_text: "",
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      model: "gpt-4.1-mini",
      parallel_tool_calls: true,
      status: "completed",
      text: null,
      tool_choice: "auto",
      tools: [],
      usage,
    },
  });
}

describe("OpenAIResponsesProvider", () => {
  const apps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("streams text deltas through the official Responses SDK", async () => {
    let requestBody: Record<string, unknown> | null = null;
    let requestUserAgent: string | undefined;
    const server = await startProviderMock((app) => {
      app.post("/v1/responses", async (request, reply) => {
        requestBody = request.body as Record<string, unknown>;
        requestUserAgent = request.headers["user-agent"];
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            responsesEvent({
              type: "response.output_text.delta",
              item_id: "msg_1",
              output_index: 0,
              content_index: 0,
              delta: "你好",
              sequence_number: 1,
            }),
            responsesEvent({
              type: "response.output_text.delta",
              item_id: "msg_1",
              output_index: 0,
              content_index: 0,
              delta: "，世界",
              sequence_number: 2,
            }),
            completedEvent(),
            "data: [DONE]\n\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OpenAIResponsesProvider({
      baseUrl: `${server.baseUrl}/v1`,
      model: "gpt-4.1-mini",
      apiKey: "test-key",
    });

    const chunks = await collectChunks(
      provider.chat({
        messages: [
          { role: "system", content: "core system prompt" },
          { role: "user", content: "你好" },
        ],
      }),
    );

    expect(chunks).toEqual([
      { type: "text_delta", text: "你好" },
      { type: "text_delta", text: "，世界" },
      { type: "end", finish_reason: "stop", usage: { prompt_tokens: 11, completion_tokens: 7 } },
    ]);
    expect(requestUserAgent).toContain("axis-mna/0.1.0 (+provider=openai-responses)");
    expect(requestBody).toMatchObject({
      model: "gpt-4.1-mini",
      instructions: "core system prompt",
      input: [
        {
          type: "message",
          role: "user",
          content: "你好",
        },
      ],
      stream: true,
      store: false,
    });
  });

  it("maps Responses function calls into MNA tool calls", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/responses", async (_request, reply) => {
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            responsesEvent({
              type: "response.output_item.done",
              output_index: 0,
              item: {
                id: "fc_1",
                type: "function_call",
                call_id: "call_1",
                name: "fs_read",
                arguments: "{\"path\":\"README.md\"}",
                status: "completed",
              },
              sequence_number: 1,
            }),
            completedEvent({ input_tokens: 9, output_tokens: 4 }),
            "data: [DONE]\n\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OpenAIResponsesProvider({
      baseUrl: `${server.baseUrl}/v1`,
      model: "gpt-4.1-mini",
      apiKey: "test-key",
    });

    const chunks = await collectChunks(
      provider.chat({
        messages: [{ role: "user", content: "读取 README" }],
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

    expect(chunks).toEqual([
      {
        type: "tool_call",
        call: {
          id: "call_1",
          name: "fs_read",
          args: {
            path: "README.md",
          },
        },
      },
      {
        type: "end",
        finish_reason: "tool_use",
        usage: {
          prompt_tokens: 9,
          completion_tokens: 4,
        },
      },
    ]);
  });

  it("maps previous assistant tool calls and tool results into Responses input items", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startProviderMock((app) => {
      app.post("/v1/responses", async (request, reply) => {
        requestBody = request.body as Record<string, unknown>;
        reply.header("content-type", "text/event-stream");
        return reply.send(sseStream([completedEvent(), "data: [DONE]\n\n"]));
      });
    });
    apps.push(server.app);

    const provider = new OpenAIResponsesProvider({
      baseUrl: `${server.baseUrl}/v1`,
      model: "gpt-4.1-mini",
      apiKey: "test-key",
    });

    await collectChunks(
      provider.chat({
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                name: "fs_read",
                args: { path: "README.md" },
              },
            ],
          },
          {
            role: "tool",
            content: "file content",
            tool_call_id: "call_1",
          },
          {
            role: "user",
            content: "继续",
          },
        ],
      }),
    );

    expect(requestBody).toMatchObject({
      input: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "fs_read",
          arguments: "{\"path\":\"README.md\"}",
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "file content",
        },
        {
          type: "message",
          role: "user",
          content: "继续",
        },
      ],
    });
  });

  it("emits tool calls from the completed response when no item-done event is sent", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/responses", async (_request, reply) => {
        reply.header("content-type", "text/event-stream");
        return reply.send(
          sseStream([
            completedEvent(
              { input_tokens: 9, output_tokens: 4 },
              [
                {
                  id: "fc_1",
                  type: "function_call",
                  call_id: "call_1",
                  name: "fs_read",
                  arguments: "{\"path\":\"README.md\"}",
                  status: "completed",
                },
              ],
            ),
            "data: [DONE]\n\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OpenAIResponsesProvider({
      baseUrl: `${server.baseUrl}/v1`,
      model: "gpt-4.1-mini",
      apiKey: "test-key",
    });

    const chunks = await collectChunks(
      provider.chat({
        messages: [{ role: "user", content: "读取 README" }],
      }),
    );

    expect(chunks).toEqual([
      {
        type: "tool_call",
        call: {
          id: "call_1",
          name: "fs_read",
          args: {
            path: "README.md",
          },
        },
      },
      {
        type: "end",
        finish_reason: "tool_use",
        usage: {
          prompt_tokens: 9,
          completion_tokens: 4,
        },
      },
    ]);
  });

  it("maps upstream auth, rate limit, and unavailable errors", async () => {
    const server = await startProviderMock((app) => {
      app.post("/auth/responses", async (_request, reply) => reply.status(401).send({ error: { message: "bad key" } }));
      app.post("/rate/responses", async (_request, reply) => reply.status(429).send({ error: { message: "slow down" } }));
      app.post("/down/responses", async (_request, reply) => reply.status(500).send({ error: { message: "boom" } }));
    });
    apps.push(server.app);

    await expect(collectChunks(new OpenAIResponsesProvider({
      baseUrl: `${server.baseUrl}/auth`,
      model: "gpt-4.1-mini",
      apiKey: "test-key",
      runtimeSettings: { maxRetries: 0 },
    }).chat({ messages: [{ role: "user", content: "继续" }] }))).rejects.toBeInstanceOf(ProviderAuthError);

    await expect(collectChunks(new OpenAIResponsesProvider({
      baseUrl: `${server.baseUrl}/rate`,
      model: "gpt-4.1-mini",
      apiKey: "test-key",
      runtimeSettings: { maxRetries: 0 },
    }).chat({ messages: [{ role: "user", content: "继续" }] }))).rejects.toBeInstanceOf(ProviderRateLimitedError);

    await expect(collectChunks(new OpenAIResponsesProvider({
      baseUrl: `${server.baseUrl}/down`,
      model: "gpt-4.1-mini",
      apiKey: "test-key",
      runtimeSettings: { maxRetries: 0 },
    }).chat({ messages: [{ role: "user", content: "继续" }] }))).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("throws timeout errors when no Responses event arrives", async () => {
    const server = await startProviderMock((app) => {
      app.post("/v1/responses", async (_request, reply) => {
        const stream = new Readable({ read() {} });
        reply.raw.on("close", () => stream.destroy());
        reply.header("content-type", "text/event-stream");
        return reply.send(stream);
      });
    });
    apps.push(server.app);

    const provider = new OpenAIResponsesProvider({
      baseUrl: `${server.baseUrl}/v1`,
      model: "gpt-4.1-mini",
      apiKey: "test-key",
      runtimeSettings: {
        firstTokenTimeoutMs: 20,
        maxRetries: 0,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});

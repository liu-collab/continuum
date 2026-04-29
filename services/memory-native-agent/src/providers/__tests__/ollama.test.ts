import { afterEach, describe, expect, it } from "vitest";

import { OllamaProvider } from "../ollama.js";
import { ProviderTimeoutError, ProviderUnavailableError } from "../types.js";
import { collectChunks, ndjsonStream, startProviderMock } from "./test-helpers.js";

describe("OllamaProvider", () => {
  const apps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("streams NDJSON text responses", async () => {
    let requestUserAgent: string | undefined;
    const server = await startProviderMock((app) => {
      app.post("/api/chat", async (request, reply) => {
        requestUserAgent = request.headers["user-agent"];
        reply.header("content-type", "application/x-ndjson");
        return reply.send(
          ndjsonStream([
            "{\"message\":{\"content\":\"你好\"}}\n",
            "{\"message\":{\"content\":\"，Ollama\"}}\n",
            "{\"done\":true,\"done_reason\":\"stop\",\"prompt_eval_count\":4,\"eval_count\":5}\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: "qwen2.5-coder",
    });

    const chunks = await collectChunks(provider.chat({ messages: [{ role: "user", content: "你好" }] }));
    expect(chunks).toEqual([
      { type: "text_delta", text: "你好" },
      { type: "text_delta", text: "，Ollama" },
      { type: "end", finish_reason: "stop", usage: { prompt_tokens: 4, completion_tokens: 5 } },
    ]);
    expect(requestUserAgent).toBe("axis-mna/0.1.0 (+provider=ollama)");
  });

  it("emits tool calls when Ollama returns tool_calls blocks", async () => {
    const server = await startProviderMock((app) => {
      app.post("/api/chat", async (_request, reply) => {
        reply.header("content-type", "application/x-ndjson");
        return reply.send(
          ndjsonStream([
            "{\"message\":{\"tool_calls\":[{\"id\":\"call-1\",\"function\":{\"name\":\"shell_exec\",\"arguments\":{\"command\":\"dir\"}}}]}}\n",
            "{\"done\":true,\"prompt_eval_count\":2,\"eval_count\":1}\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: "qwen2.5-coder",
    });

    const chunks = await collectChunks(provider.chat({ messages: [{ role: "user", content: "列文件" }] }));
    expect(chunks[0]).toEqual({
      type: "tool_call",
      call: {
        id: "call-1",
        name: "shell_exec",
        args: {
          command: "dir",
        },
      },
    });
    expect(chunks[1]).toEqual({
      type: "end",
      finish_reason: "tool_use",
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    });
  });

  it("retries stream NDJSON when parsing fails", async () => {
    const seenStreamValues: boolean[] = [];
    const server = await startProviderMock((app) => {
      app.post("/api/chat", async (request, reply) => {
        const body = request.body as { stream?: boolean };
        seenStreamValues.push(Boolean(body.stream));
        reply.header("content-type", "application/x-ndjson");
        return reply.send(ndjsonStream(["{not-json}\n"]));
      });
    });
    apps.push(server.app);

    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: "qwen2.5-coder",
      runtimeSettings: {
        maxRetries: 1,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toThrow("Ollama provider returned invalid NDJSON.");
    expect(seenStreamValues).toEqual([true, true]);
  });

  it("throws unavailable errors for 5xx responses", async () => {
    const server = await startProviderMock((app) => {
      app.post("/api/chat", async (_request, reply) => {
        reply.status(500).send({ error: "boom" });
      });
    });
    apps.push(server.app);

    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: "qwen2.5-coder",
      runtimeSettings: {
        maxRetries: 0,
      },
    });

    await expect(
      collectChunks(provider.chat({ messages: [{ role: "user", content: "继续" }] })),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("throws timeout errors when no response arrives before the configured timeout", async () => {
    let requestCount = 0;
    const server = await startProviderMock((app) => {
      app.post("/api/chat", async () => {
        requestCount += 1;
        return new Promise(() => undefined);
      });
    });
    apps.push(server.app);

    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: "qwen2.5-coder",
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

  it("forwards multiple tiered system messages to Ollama unchanged", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startProviderMock((app) => {
      app.post("/api/chat", async (request, reply) => {
        requestBody = request.body as Record<string, unknown>;
        reply.header("content-type", "application/x-ndjson");
        return reply.send(
          ndjsonStream([
            "{\"message\":{\"content\":\"ok\"}}\n",
            "{\"done\":true,\"done_reason\":\"stop\",\"prompt_eval_count\":1,\"eval_count\":1}\n",
          ]),
        );
      });
    });
    apps.push(server.app);

    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: "qwen2.5-coder",
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

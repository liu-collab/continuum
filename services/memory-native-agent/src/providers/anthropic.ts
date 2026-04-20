import {
  ProviderRateLimitedError,
  ProviderStreamError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  type ChatChunk,
  type ChatRequest,
  type IModelProvider,
  type ProviderRuntimeSettings,
  type ToolSchema,
} from "./types.js";
import {
  buildBaseUrl,
  createCompositeAbortController,
  emptyUsage,
  mapStatusToError,
  mergeUsage,
  parseJsonObject,
  resolveRuntimeSettings,
  retryDelayMs,
  sleep,
  startFirstTokenTimer,
  streamLines,
} from "./shared.js";

type AnthropicOptions = {
  baseUrl: string;
  model: string;
  apiKey: string;
  runtimeSettings?: Partial<ProviderRuntimeSettings>;
};

type PendingAnthropicToolUse = {
  id: string;
  name: string;
  inputText: string;
};

export class AnthropicProvider implements IModelProvider {
  private readonly runtimeSettings: ProviderRuntimeSettings;

  constructor(private readonly options: AnthropicOptions) {
    this.runtimeSettings = resolveRuntimeSettings(options.runtimeSettings);
  }

  id(): string {
    return "anthropic";
  }

  model(): string {
    return this.options.model;
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    let emittedChunks = 0;

    try {
      for await (const chunk of this.streamChat(request, (count) => {
        emittedChunks = count;
      })) {
        yield chunk;
      }
    } catch (error) {
      if (emittedChunks === 0 && (error instanceof ProviderStreamError || error instanceof ProviderTimeoutError)) {
        for await (const chunk of this.nonStreamChat(request)) {
          yield chunk;
        }
        return;
      }

      throw error;
    }
  }

  private async *streamChat(
    request: ChatRequest,
    onEmitCount: (count: number) => void,
  ): AsyncIterable<ChatChunk> {
    let emittedChunks = 0;
    let usage = emptyUsage();
    let sawToolCall = false;
    const pendingToolUses = new Map<number, PendingAnthropicToolUse>();
    let currentEvent = "message";
    let currentDataLines: string[] = [];

    const response = await this.executeRequest({
      request,
      stream: true,
    });

    const { controller, cleanup } = createCompositeAbortController(request.signal);
    const cancelFirstTokenTimer = startFirstTokenTimer(controller, this.runtimeSettings.firstTokenTimeoutMs);

    try {
      if (!response.body) {
        throw new ProviderStreamError("Anthropic provider did not return a response stream.");
      }

      for await (const line of streamLines(response.body)) {
        if (controller.signal.aborted) {
          return;
        }

        if (!line) {
          if (currentDataLines.length > 0) {
            cancelFirstTokenTimer();
            const payload = JSON.parse(currentDataLines.join("\n")) as Record<string, unknown>;
            currentDataLines = [];

            if (currentEvent === "content_block_delta") {
              const delta = (payload.delta ?? {}) as Record<string, unknown>;
              if (delta.type === "text_delta" && typeof delta.text === "string") {
                emittedChunks += 1;
                onEmitCount(emittedChunks);
                yield {
                  type: "text_delta",
                  text: delta.text,
                };
              }

              if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
                const index = typeof payload.index === "number" ? payload.index : 0;
                const pending = pendingToolUses.get(index);
                if (pending) {
                  pending.inputText += delta.partial_json;
                }
              }
            }

            if (currentEvent === "content_block_start") {
              const block = (payload.content_block ?? {}) as Record<string, unknown>;
              if (block.type === "tool_use") {
                const index = typeof payload.index === "number" ? payload.index : 0;
                const rawInput = block.input;
                const initialInputText =
                  rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) && Object.keys(rawInput).length > 0
                    ? JSON.stringify(rawInput)
                    : "";
                pendingToolUses.set(index, {
                  id: typeof block.id === "string" ? block.id : `tool-use-${index}`,
                  name: typeof block.name === "string" ? block.name : "",
                  inputText: initialInputText,
                });
              }
            }

            if (currentEvent === "message_start") {
              const message = (payload.message ?? {}) as Record<string, unknown>;
              const usagePayload = (message.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
              usage = mergeUsage(usage, {
                prompt_tokens: usagePayload.input_tokens,
                completion_tokens: usagePayload.output_tokens,
              });
            }

            if (currentEvent === "message_delta") {
              const usagePayload = (payload.usage ?? {}) as { output_tokens?: number };
              usage = mergeUsage(usage, {
                completion_tokens: usagePayload.output_tokens,
              });
            }

            if (currentEvent === "message_stop") {
              if (pendingToolUses.size > 0) {
                sawToolCall = true;
                for (const pending of pendingToolUses.values()) {
                  emittedChunks += 1;
                  onEmitCount(emittedChunks);
                  yield {
                    type: "tool_call",
                    call: {
                      id: pending.id,
                      name: pending.name,
                      args: parseJsonObject(pending.inputText || "{}"),
                    },
                  };
                }
                pendingToolUses.clear();
              }

              yield {
                type: "end",
                finish_reason: sawToolCall ? "tool_use" : "stop",
                usage,
              };
              return;
            }
          }

          continue;
        }

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          currentDataLines.push(line.slice(5).trim());
        }
      }

      if (pendingToolUses.size > 0) {
        sawToolCall = true;
        for (const pending of pendingToolUses.values()) {
          yield {
            type: "tool_call",
            call: {
              id: pending.id,
              name: pending.name,
              args: parseJsonObject(pending.inputText || "{}"),
            },
          };
        }
      }

      yield {
        type: "end",
        finish_reason: sawToolCall ? "tool_use" : "stop",
        usage,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError("Anthropic provider timed out before first token.", error);
      }
      if (error instanceof SyntaxError) {
        throw new ProviderStreamError("Anthropic provider returned invalid JSON in stream.", error);
      }
      throw error;
    } finally {
      cancelFirstTokenTimer();
      cleanup();
    }
  }

  private async *nonStreamChat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const response = await this.executeRequest({
      request,
      stream: false,
    });

    const payload = (await response.json()) as {
      content?: Array<Record<string, unknown>>;
      stop_reason?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    for (const block of payload.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        yield {
          type: "text_delta",
          text: block.text,
        };
      }

      if (block.type === "tool_use") {
        yield {
          type: "tool_call",
          call: {
            id: typeof block.id === "string" ? block.id : "tool-use-0",
            name: typeof block.name === "string" ? block.name : "",
            args: (block.input as Record<string, unknown>) ?? {},
          },
        };
      }
    }

    yield {
      type: "end",
      finish_reason: mapAnthropicFinishReason(payload.stop_reason, (payload.content ?? []).some((item) => item.type === "tool_use")),
      usage: {
        prompt_tokens: payload.usage?.input_tokens ?? 0,
        completion_tokens: payload.usage?.output_tokens ?? 0,
      },
    };
  }

  private async executeRequest(options: {
    request: ChatRequest;
    stream: boolean;
  }): Promise<Response> {
    for (let attempt = 0; attempt <= this.runtimeSettings.maxRetries; attempt += 1) {
      const { controller, cleanup } = createCompositeAbortController(options.request.signal);
      const cancelTimeout = startFirstTokenTimer(controller, this.runtimeSettings.firstTokenTimeoutMs);

      try {
        const response = await fetch(buildBaseUrl(this.options.baseUrl, "/v1/messages"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": this.options.apiKey,
          },
          body: JSON.stringify({
            model: options.request.model ?? this.options.model,
            system: extractAnthropicSystem(options.request.messages),
            messages: mapAnthropicMessages(options.request.messages),
            tools: mapAnthropicTools(options.request.tools),
            temperature: options.request.temperature,
            max_tokens: options.request.max_tokens ?? 4096,
            stream: options.stream,
          }),
          signal: controller.signal,
        });

        cancelTimeout();

        if (!response.ok) {
          const mappedError = mapStatusToError(response.status, "Anthropic provider");
          const delayMs = retryDelayMs(mappedError, attempt, this.runtimeSettings.maxRetries, response.headers.get("retry-after"));
          if (delayMs !== null) {
            await sleep(delayMs, options.request.signal);
            continue;
          }

          throw mappedError;
        }

        return response;
      } catch (error) {
        cancelTimeout();
        if (
          error instanceof ProviderRateLimitedError
          || error instanceof ProviderUnavailableError
        ) {
          throw error;
        }
        if (isAbortLikeError(error, controller.signal.reason)) {
          throw new ProviderTimeoutError("Anthropic provider timed out before response.", error);
        }
        if (attempt >= this.runtimeSettings.maxRetries) {
          throw error instanceof Error ? new ProviderStreamError(error.message, error) : new ProviderStreamError(String(error));
        }

        await sleep(attempt === 0 ? 500 : 1000, options.request.signal);
      } finally {
        cleanup();
      }
    }

    throw new ProviderStreamError("Anthropic provider request failed.");
  }
}

function isAbortLikeError(error: unknown, signalReason: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  return signalReason === "provider_first_token_timeout";
}

function extractAnthropicSystem(messages: ChatRequest["messages"]): string | undefined {
  const systemMessages = messages.filter((message) => message.role === "system").map((message) => message.content.trim()).filter(Boolean);
  return systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
}

function mapAnthropicMessages(messages: ChatRequest["messages"]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool" && message.tool_call_id) {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.tool_call_id,
              content: message.content,
              is_error: false,
            },
          ],
        };
      }

      if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
        return {
          role: "assistant",
          content: [
            ...(message.content ? [{ type: "text", text: message.content }] : []),
            ...message.tool_calls.map((toolCall) => ({
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.args,
            })),
          ],
        };
      }

      return {
        role: message.role,
        content: [
          {
            type: "text",
            text: message.content,
          },
        ],
      };
    });
}

function mapAnthropicTools(tools?: ToolSchema[]) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function mapAnthropicFinishReason(reason: string | undefined, sawToolCall: boolean): "stop" | "tool_use" | "length" | "error" {
  if (reason === "tool_use") {
    return "tool_use";
  }
  if (reason === "max_tokens") {
    return "length";
  }
  if (reason === "error") {
    return "error";
  }

  return sawToolCall ? "tool_use" : "stop";
}

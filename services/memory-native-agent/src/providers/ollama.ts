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
  parseJsonObject,
  resolveRuntimeSettings,
  retryDelayMs,
  sleep,
  startFirstTokenTimer,
  streamLines,
} from "./shared.js";

type OllamaOptions = {
  baseUrl: string;
  model: string;
  keepAlive?: string | number;
  runtimeSettings?: Partial<ProviderRuntimeSettings>;
};

export class OllamaProvider implements IModelProvider {
  private readonly runtimeSettings: ProviderRuntimeSettings;

  constructor(private readonly options: OllamaOptions) {
    this.runtimeSettings = resolveRuntimeSettings(options.runtimeSettings);
  }

  id(): string {
    return "ollama";
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
    const response = await this.executeRequest({
      request,
      stream: true,
    });

    const { controller, cleanup } = createCompositeAbortController(request.signal);
    const cancelFirstTokenTimer = startFirstTokenTimer(controller, this.runtimeSettings.firstTokenTimeoutMs);

    try {
      if (!response.body) {
        throw new ProviderStreamError("Ollama provider did not return a response stream.");
      }

      let emittedChunks = 0;
      let sawToolCall = false;
      let usage = emptyUsage();

      for await (const line of streamLines(response.body)) {
        if (!line.trim()) {
          continue;
        }

        cancelFirstTokenTimer();

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(line) as Record<string, unknown>;
        } catch (error) {
          throw new ProviderStreamError("Ollama provider returned invalid NDJSON.", error);
        }

        const message = (payload.message ?? {}) as Record<string, unknown>;
        if (typeof message.content === "string" && message.content.length > 0) {
          emittedChunks += 1;
          onEmitCount(emittedChunks);
          yield {
            type: "text_delta",
            text: message.content,
          };
        }

        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        if (toolCalls.length > 0) {
          sawToolCall = true;
          for (const toolCall of toolCalls as Array<Record<string, unknown>>) {
            const fn = (toolCall.function ?? {}) as Record<string, unknown>;
            emittedChunks += 1;
            onEmitCount(emittedChunks);
            yield {
              type: "tool_call",
              call: {
                id: typeof toolCall.id === "string" ? toolCall.id : `tool-call-${emittedChunks}`,
                name: typeof fn.name === "string" ? fn.name : "",
                args:
                  typeof fn.arguments === "string"
                    ? parseJsonObject(fn.arguments)
                    : ((fn.arguments as Record<string, unknown>) ?? {}),
              },
            };
          }
        }

        if (payload.done === true) {
          usage = {
            prompt_tokens: typeof payload.prompt_eval_count === "number" ? payload.prompt_eval_count : 0,
            completion_tokens: typeof payload.eval_count === "number" ? payload.eval_count : 0,
          };
          yield {
            type: "end",
            finish_reason: sawToolCall ? "tool_use" : mapOllamaFinishReason(typeof payload.done_reason === "string" ? payload.done_reason : undefined),
            usage,
          };
          return;
        }
      }

      yield {
        type: "end",
        finish_reason: "stop",
        usage,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError("Ollama provider timed out before first token.", error);
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
      message?: {
        content?: string;
        tool_calls?: Array<Record<string, unknown>>;
      };
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: string;
    };

    if (typeof payload.message?.content === "string" && payload.message.content.length > 0) {
      yield {
        type: "text_delta",
        text: payload.message.content,
      };
    }

    for (const toolCall of payload.message?.tool_calls ?? []) {
      const fn = (toolCall.function ?? {}) as Record<string, unknown>;
      yield {
        type: "tool_call",
        call: {
          id: typeof toolCall.id === "string" ? toolCall.id : "tool-call-0",
          name: typeof fn.name === "string" ? fn.name : "",
          args:
            typeof fn.arguments === "string"
              ? parseJsonObject(fn.arguments)
              : ((fn.arguments as Record<string, unknown>) ?? {}),
        },
      };
    }

    yield {
      type: "end",
      finish_reason:
        (payload.message?.tool_calls ?? []).length > 0
          ? "tool_use"
          : mapOllamaFinishReason(payload.done_reason),
      usage: {
        prompt_tokens: payload.prompt_eval_count ?? 0,
        completion_tokens: payload.eval_count ?? 0,
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
        const response = await fetch(buildBaseUrl(this.options.baseUrl, "/api/chat"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.options.model,
            messages: mapOllamaMessages(options.request.messages),
            tools: mapOllamaTools(options.request.tools),
            stream: options.stream,
            keep_alive: this.options.keepAlive,
            options: {
              temperature: options.request.temperature,
            },
          }),
          signal: controller.signal,
        });

        cancelTimeout();

        if (!response.ok) {
          const mappedError = mapStatusToError(response.status, "Ollama provider");
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
        if (error instanceof ProviderRateLimitedError || error instanceof ProviderUnavailableError) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new ProviderTimeoutError("Ollama provider timed out before response.", error);
        }

        if (attempt >= this.runtimeSettings.maxRetries) {
          throw error instanceof Error ? new ProviderStreamError(error.message, error) : new ProviderStreamError(String(error));
        }

        await sleep(attempt === 0 ? 500 : 1000, options.request.signal);
      } finally {
        cleanup();
      }
    }

    throw new ProviderStreamError("Ollama provider request failed.");
  }
}

function mapOllamaMessages(messages: ChatRequest["messages"]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls?.map((toolCall) => ({
      id: toolCall.id,
      function: {
        name: toolCall.name,
        arguments: toolCall.args,
      },
    })),
    tool_call_id: message.tool_call_id,
  }));
}

function mapOllamaTools(tools?: ToolSchema[]) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function mapOllamaFinishReason(reason: string | undefined): "stop" | "tool_use" | "length" | "error" {
  if (reason === "length") {
    return "length";
  }
  if (reason === "error") {
    return "error";
  }
  return "stop";
}

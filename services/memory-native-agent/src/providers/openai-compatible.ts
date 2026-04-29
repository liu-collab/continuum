import {
  ProviderAuthError,
  ProviderRateLimitedError,
  ProviderStreamError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  type ChatChunk,
  type ChatRequest,
  type IModelProvider,
  type ProviderRuntimeSettings,
  type ToolCall,
  type ToolSchema,
  type Usage,
} from "./types.js";
import {
  buildBaseUrl,
  createCompositeAbortController,
  emptyUsage,
  mapStatusToError,
  mergeUsage,
  parseJsonObject,
  buildProviderUserAgent,
  isProviderNetworkError,
  mapNetworkErrorToProviderUnavailable,
  resolveRuntimeSettings,
  retryDelayMs,
  sleep,
  startFirstTokenTimer,
  streamLines,
} from "./shared.js";

type OpenAICompatibleOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  organization?: string;
  effort?: ChatRequest["effort"];
  maxTokens?: number;
  runtimeSettings?: Partial<ProviderRuntimeSettings>;
};

type PendingToolCall = {
  id: string;
  name: string;
  argumentsText: string;
};

export class OpenAICompatibleProvider implements IModelProvider {
  private readonly runtimeSettings: ProviderRuntimeSettings;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.runtimeSettings = resolveRuntimeSettings(options.runtimeSettings);
  }

  id(): string {
    return "openai-compatible";
  }

  model(): string {
    return this.options.model;
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    for (let attempt = 0; attempt <= this.runtimeSettings.maxRetries; attempt += 1) {
      let emittedChunks = 0;

      try {
        for await (const chunk of this.streamChat(request, (count) => {
          emittedChunks = count;
        })) {
          yield chunk;
        }
        return;
      } catch (error) {
        if (request.signal?.aborted) {
          throw error;
        }

        if (emittedChunks > 0 || !(error instanceof ProviderStreamError || error instanceof ProviderTimeoutError)) {
          throw error;
        }

        const delayMs = retryDelayMs(error, attempt, this.runtimeSettings.maxRetries);
        if (delayMs === null) {
          throw error;
        }

        await sleep(delayMs, request.signal);
      }
    }
  }

  private async *streamChat(
    request: ChatRequest,
    onEmitCount: (count: number) => void,
  ): AsyncIterable<ChatChunk> {
    let usage = emptyUsage();
    const pendingToolCalls = new Map<number, PendingToolCall>();
    let emittedChunks = 0;
    let sawToolCall = false;

    const response = await this.executeRequest({
      request,
      stream: true,
    });

    const { controller, cleanup } = createCompositeAbortController(request.signal);
    const cancelFirstTokenTimer = startFirstTokenTimer(controller, this.runtimeSettings.firstTokenTimeoutMs);

    try {
      if (!response.body) {
        throw new ProviderStreamError("OpenAI-compatible provider did not return a response stream.");
      }

      for await (const line of streamLines(response.body)) {
        if (controller.signal.aborted) {
          return;
        }

        if (!line.startsWith("data:")) {
          continue;
        }

        const rawPayload = line.slice(5).trim();
        if (!rawPayload) {
          continue;
        }

        if (rawPayload === "[DONE]") {
          break;
        }

        cancelFirstTokenTimer();

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawPayload) as Record<string, unknown>;
        } catch (error) {
          throw new ProviderStreamError("OpenAI-compatible provider returned invalid JSON in stream.", error);
        }

        const usagePayload = payload.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
        if (usagePayload) {
          usage = mergeUsage(usage, usagePayload);
        }

        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const choice = choices[0] as Record<string, unknown> | undefined;
        if (!choice) {
          continue;
        }

        const delta = (choice.delta ?? {}) as Record<string, unknown>;
        const content = typeof delta.content === "string" ? delta.content : "";
        if (content) {
          emittedChunks += 1;
          onEmitCount(emittedChunks);
          yield {
            type: "text_delta",
            text: content,
          };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const item of delta.tool_calls as Array<Record<string, unknown>>) {
            const index = typeof item.index === "number" ? item.index : 0;
            const toolFunction = (item.function ?? {}) as Record<string, unknown>;
            const current = pendingToolCalls.get(index) ?? {
              id: typeof item.id === "string" ? item.id : `tool-call-${index}`,
              name: typeof toolFunction.name === "string" ? toolFunction.name : "",
              argumentsText: "",
            };

            if (typeof item.id === "string" && item.id.length > 0) {
              current.id = item.id;
            }
            if (typeof toolFunction.name === "string" && toolFunction.name.length > 0) {
              current.name = toolFunction.name;
            }
            if (typeof toolFunction.arguments === "string") {
              current.argumentsText += toolFunction.arguments;
            }

            pendingToolCalls.set(index, current);
          }
        }

        const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
        if (finishReason) {
          if (pendingToolCalls.size > 0) {
            sawToolCall = true;
            for (const pending of pendingToolCalls.values()) {
              const call: ToolCall = {
                id: pending.id,
                name: pending.name,
                args: parseJsonObject(pending.argumentsText || "{}"),
              };
              emittedChunks += 1;
              onEmitCount(emittedChunks);
              yield {
                type: "tool_call",
                call,
              };
            }
            pendingToolCalls.clear();
          }

          yield {
            type: "end",
            finish_reason: mapOpenAIFinishReason(finishReason, sawToolCall),
            usage,
          };
          return;
        }
      }

      if (pendingToolCalls.size > 0) {
        sawToolCall = true;
        for (const pending of pendingToolCalls.values()) {
          emittedChunks += 1;
          onEmitCount(emittedChunks);
          yield {
            type: "tool_call",
            call: {
              id: pending.id,
              name: pending.name,
              args: parseJsonObject(pending.argumentsText || "{}"),
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
        throw new ProviderTimeoutError("OpenAI-compatible provider timed out before first token.", error);
      }
      throw error;
    } finally {
      cancelFirstTokenTimer();
      cleanup();
    }
  }

  private async executeRequest(options: {
    request: ChatRequest;
    stream: boolean;
  }): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.runtimeSettings.maxRetries; attempt += 1) {
      const { controller, cleanup } = createCompositeAbortController(options.request.signal);
      const cancelTimeout = startFirstTokenTimer(controller, this.runtimeSettings.firstTokenTimeoutMs);

      try {
        const response = await fetch(buildBaseUrl(this.options.baseUrl, "/v1/chat/completions"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": buildProviderUserAgent(this.id()),
            ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
            ...(this.options.organization ? { "OpenAI-Organization": this.options.organization } : {}),
          },
          body: JSON.stringify({
            model: options.request.model ?? this.options.model,
            messages: mapOpenAIMessages(options.request.messages),
            tools: mapOpenAITools(options.request.tools),
            tool_choice: options.request.tools?.length ? "auto" : undefined,
            temperature: options.request.temperature,
            max_tokens: options.request.max_tokens ?? this.options.maxTokens,
            reasoning_effort: mapOpenAiReasoningEffort(options.request.effort ?? this.options.effort),
            stream: options.stream,
            ...(options.stream ? { stream_options: { include_usage: true } } : {}),
          }),
          signal: controller.signal,
        });

        cancelTimeout();

        if (!response.ok) {
          const mappedError = mapStatusToError(response.status, "OpenAI-compatible provider");
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
        if (error instanceof ProviderAuthError) {
          throw error;
        }
        if (error instanceof ProviderRateLimitedError || error instanceof ProviderUnavailableError) {
          const delayMs = retryDelayMs(error, attempt, this.runtimeSettings.maxRetries);
          if (delayMs === null) {
            throw error;
          }

          await sleep(delayMs, options.request.signal);
          continue;
        }

        if (error instanceof ProviderTimeoutError || error instanceof ProviderStreamError) {
          throw error;
        }

        if (isAbortLikeError(error, controller.signal.reason)) {
          throw new ProviderTimeoutError("OpenAI-compatible provider timed out before response.", error);
        }

        if (isProviderNetworkError(error)) {
          throw mapNetworkErrorToProviderUnavailable("OpenAI-compatible provider", error);
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        throw new ProviderStreamError(lastError.message, lastError);
      } finally {
        cleanup();
      }
    }

    throw lastError ?? new ProviderStreamError("OpenAI-compatible provider request failed.");
  }
}

function mapOpenAiReasoningEffort(
  effort: ChatRequest["effort"] | undefined,
): "low" | "medium" | "high" | undefined {
  if (!effort) {
    return undefined;
  }

  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
  }

  return "high";
}

function isAbortLikeError(error: unknown, signalReason: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  return signalReason === "provider_first_token_timeout";
}

function mapOpenAIFinishReason(reason: string, sawToolCall: boolean): "stop" | "tool_use" | "length" | "error" {
  if (reason === "tool_calls") {
    return "tool_use";
  }
  if (reason === "length") {
    return "length";
  }
  if (reason === "content_filter") {
    return "error";
  }
  return sawToolCall ? "tool_use" : "stop";
}

function mapOpenAITools(tools?: ToolSchema[]) {
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

function mapOpenAIMessages(messages: ChatRequest["messages"]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls?.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.args),
      },
    })),
    tool_call_id: message.tool_call_id,
  }));
}

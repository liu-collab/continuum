import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import type { ResponseInputItem, ResponseStreamEvent } from "openai/resources/responses/responses";

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
  buildProviderUserAgent,
  createCompositeAbortController,
  emptyUsage,
  parseJsonObject,
  resolveRuntimeSettings,
  startFirstTokenTimer,
} from "./shared.js";

type OpenAIResponsesOptions = {
  baseUrl: string;
  model: string;
  apiKey: string;
  organization?: string;
  effort?: ChatRequest["effort"];
  maxTokens?: number;
  runtimeSettings?: Partial<ProviderRuntimeSettings>;
};

export class OpenAIResponsesProvider implements IModelProvider {
  private readonly runtimeSettings: ProviderRuntimeSettings;
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIResponsesOptions) {
    this.runtimeSettings = resolveRuntimeSettings(options.runtimeSettings);
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl.replace(/\/+$/, ""),
      organization: options.organization,
      maxRetries: this.runtimeSettings.maxRetries,
      defaultHeaders: {
        "user-agent": buildProviderUserAgent(this.id()),
      },
    });
  }

  id(): string {
    return "openai-responses";
  }

  model(): string {
    return this.options.model;
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const { controller, cleanup } = createCompositeAbortController(request.signal);
    const cancelFirstTokenTimer = startFirstTokenTimer(controller, this.runtimeSettings.firstTokenTimeoutMs);

    try {
      const stream = await this.client.responses.create({
        model: request.model ?? this.options.model,
        instructions: extractSystemInstructions(request.messages),
        input: mapResponsesInput(request.messages),
        tools: mapResponsesTools(request.tools),
        tool_choice: request.tools?.length ? "auto" : undefined,
        temperature: request.temperature,
        max_output_tokens: request.max_tokens ?? this.options.maxTokens,
        reasoning: mapResponsesReasoning(request.effort ?? this.options.effort),
        stream: true,
        store: false,
      }, {
        signal: controller.signal,
      });

      let sawToolCall = false;
      let usage = emptyUsage();
      const emittedToolCallIds = new Set<string>();

      for await (const event of stream) {
        if (request.signal?.aborted) {
          return;
        }

        cancelFirstTokenTimer();
        const nextUsage = mergeResponsesUsage(usage, event);
        const chunk = mapResponsesEvent(event);
        if (!chunk) {
          usage = nextUsage;
          continue;
        }

        if (chunk.type === "tool_call") {
          sawToolCall = true;
          emittedToolCallIds.add(chunk.call.id);
        }
        if (chunk.type === "end") {
          if (event.type === "response.completed") {
            for (const call of mapCompletedResponsesToolCalls(event, emittedToolCallIds)) {
              sawToolCall = true;
              emittedToolCallIds.add(call.id);
              yield {
                type: "tool_call",
                call,
              };
            }
          }

          yield {
            ...chunk,
            finish_reason: sawToolCall && chunk.finish_reason === "stop" ? "tool_use" : chunk.finish_reason,
            usage: nextUsage,
          };
          return;
        }

        yield chunk;
        usage = nextUsage;
      }

      if (controller.signal.aborted) {
        if (controller.signal.reason === "provider_first_token_timeout") {
          throw new ProviderTimeoutError("OpenAI Responses provider timed out before first token.");
        }
        return;
      }

      yield {
        type: "end",
        finish_reason: sawToolCall ? "tool_use" : "stop",
        usage,
      };
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason === "provider_first_token_timeout") {
        throw new ProviderTimeoutError("OpenAI Responses provider timed out before first token.", error);
      }
      throw mapOpenAIResponsesError(error);
    } finally {
      cancelFirstTokenTimer();
      cleanup();
    }
  }
}

function extractSystemInstructions(messages: ChatRequest["messages"]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean);
  return instructions.length > 0 ? instructions.join("\n\n") : undefined;
}

function mapResponsesInput(messages: ChatRequest["messages"]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "assistant" && message.tool_calls?.length) {
      if (message.content.trim()) {
        input.push({
          type: "message",
          role: "assistant",
          content: message.content,
        });
      }
      input.push(...message.tool_calls.map((toolCall) => ({
        type: "function_call" as const,
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.args),
      })));
      continue;
    }

    if (message.role === "tool" && message.tool_call_id) {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      });
      continue;
    }

    if (message.role === "user" || message.role === "assistant") {
      input.push({
        type: "message",
        role: message.role,
        content: message.content,
      });
    }
  }

  return input;
}

function mapResponsesTools(tools?: ToolSchema[]) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }));
}

function mapResponsesReasoning(
  effort: ChatRequest["effort"] | undefined,
): { effort: "low" | "medium" | "high" | "xhigh" } | undefined {
  if (!effort) {
    return undefined;
  }

  if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh") {
    return { effort };
  }

  return { effort: "high" };
}

function mapResponsesEvent(event: ResponseStreamEvent): ChatChunk | null {
  if (event.type === "response.output_text.delta") {
    return {
      type: "text_delta",
      text: event.delta,
    };
  }

  if (event.type === "response.output_item.done" && event.item.type === "function_call") {
    return {
      type: "tool_call",
      call: mapResponsesToolCall(event.item),
    };
  }

  if (event.type === "response.completed") {
    return {
      type: "end",
      finish_reason: "stop",
      usage: emptyUsage(),
    };
  }

  if (event.type === "response.incomplete") {
    return {
      type: "end",
      finish_reason: event.response.incomplete_details?.reason === "max_output_tokens" ? "length" : "error",
      usage: emptyUsage(),
    };
  }

  if (event.type === "response.failed" || event.type === "error") {
    throw new ProviderStreamError(readResponsesEventError(event));
  }

  return null;
}

function mapResponsesToolCall(item: Extract<ResponseStreamEvent, { type: "response.output_item.done" }>["item"]): ToolCall {
  if (item.type !== "function_call") {
    throw new ProviderStreamError("OpenAI Responses provider returned a non-function tool call.");
  }

  return {
    id: item.call_id,
    name: item.name,
    args: parseJsonObject(item.arguments || "{}"),
  };
}

function mapCompletedResponsesToolCalls(
  event: Extract<ResponseStreamEvent, { type: "response.completed" }>,
  emittedToolCallIds: Set<string>,
): ToolCall[] {
  return event.response.output
    .filter(isResponsesFunctionCall)
    .filter((item) => !emittedToolCallIds.has(item.call_id))
    .map((item) => ({
      id: item.call_id,
      name: item.name,
      args: parseJsonObject(item.arguments || "{}"),
    }));
}

function isResponsesFunctionCall(
  item: Extract<ResponseStreamEvent, { type: "response.completed" }>["response"]["output"][number],
): item is Extract<typeof item, { type: "function_call" }> {
  return item.type === "function_call";
}

function mergeResponsesUsage(usage: Usage, event: ResponseStreamEvent): Usage {
  if (!("response" in event)) {
    return usage;
  }

  const responseUsage = event.response.usage;
  if (!responseUsage) {
    return usage;
  }

  return {
    prompt_tokens: responseUsage.input_tokens ?? usage.prompt_tokens,
    completion_tokens: responseUsage.output_tokens ?? usage.completion_tokens,
  };
}

function readResponsesEventError(event: Extract<ResponseStreamEvent, { type: "response.failed" | "error" }>) {
  if (event.type === "error") {
    return event.message || "OpenAI Responses provider returned an error event.";
  }

  return event.response.error?.message || "OpenAI Responses provider failed.";
}

function mapOpenAIResponsesError(error: unknown): Error {
  if (error instanceof ProviderStreamError) {
    return error;
  }

  if (error instanceof AuthenticationError) {
    return new ProviderAuthError(error.message, error.status, error);
  }

  if (error instanceof RateLimitError) {
    return new ProviderRateLimitedError(error.message, error.status, error);
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new ProviderTimeoutError("OpenAI Responses provider timed out before response.", error);
  }

  if (error instanceof APIConnectionError) {
    return new ProviderUnavailableError(`OpenAI Responses provider network error: ${error.message}`, undefined, error);
  }

  if (error instanceof APIError) {
    if (error.status && error.status >= 500) {
      return new ProviderUnavailableError(error.message, error.status, error);
    }
    return new ProviderStreamError(error.message, error);
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderTimeoutError("OpenAI Responses provider timed out before response.", error);
  }

  return error instanceof Error
    ? new ProviderStreamError(error.message, error)
    : new ProviderStreamError(String(error));
}

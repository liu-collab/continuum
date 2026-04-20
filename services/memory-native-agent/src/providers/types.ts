export type JsonSchema = Record<string, unknown>;

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
}

export type ChatChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "end"; finish_reason: "stop" | "tool_use" | "length" | "error"; usage: Usage };

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}

export interface IModelProvider {
  id(): string;
  model(): string;
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
  status?(): {
    status: "configured" | "misconfigured";
    detail?: string;
  };
}

export interface ProviderRuntimeSettings {
  maxRetries: number;
  firstTokenTimeoutMs: number;
}

export class ProviderError extends Error {
  readonly code: string;
  readonly statusCode?: number;

  constructor(message: string, options?: { code?: string; statusCode?: number; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = options?.code ?? "provider_error";
    this.statusCode = options?.statusCode;
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message, { code: "provider_auth_failed", statusCode, cause });
  }
}

export class ProviderRateLimitedError extends ProviderError {
  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message, { code: "provider_rate_limited", statusCode, cause });
  }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message, { code: "provider_unavailable", statusCode, cause });
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "provider_timeout", cause });
  }
}

export class ProviderStreamError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "provider_stream_error", cause });
  }
}

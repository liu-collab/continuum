import type { AppConfig } from "../config.js";

type AnthropicMessagesPayload = {
  content?: Array<{ type?: string; text?: string }>;
  output_text?: string;
};

type OpenAiChatPayload = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type OpenAiResponsesPayload = {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  output_text?: string;
};

type OllamaChatPayload = {
  message?: {
    content?: string;
  };
  response?: string;
};

function buildBaseUrl(baseUrl: string, pathname: string): URL {
  const endpointParts = pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const url = new URL(baseUrl);
  const basePathParts = url.pathname.split("/").filter(Boolean);
  const pathToAppend =
    endpointParts.length > 1 && basePathParts.at(-1) === endpointParts[0]
      ? endpointParts.slice(1)
      : endpointParts;

  url.pathname = `/${[...basePathParts, ...pathToAppend].join("/")}`;
  url.search = "";
  url.hash = "";
  return url;
}

function isOpenAiChatPayload(payload: AnthropicMessagesPayload | OpenAiChatPayload | OpenAiResponsesPayload | OllamaChatPayload): payload is OpenAiChatPayload {
  return "choices" in payload;
}

export type MemoryLlmConfig = Pick<
  AppConfig,
  | "MEMORY_LLM_BASE_URL"
  | "MEMORY_LLM_MODEL"
  | "MEMORY_LLM_API_KEY"
  | "MEMORY_LLM_PROTOCOL"
  | "MEMORY_LLM_TIMEOUT_MS"
  | "MEMORY_LLM_EFFORT"
>;

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_ATTEMPTS = 4;
const TRANSIENT_BACKOFF_MS = [0, 500, 1_500, 4_000];
const JSON_OBJECT_SYSTEM_PREFIX = "Return a valid json object only.";
const JSON_OBJECT_INPUT_PREFIX = "Return the result as a valid json object.";

export async function callMemoryLlm(
  config: MemoryLlmConfig,
  systemPrompt: string,
  userPayload: unknown,
  maxTokens: number,
): Promise<string> {
  if (!config.MEMORY_LLM_BASE_URL) {
    throw new Error("MEMORY_LLM_BASE_URL is not configured");
  }

  const protocol = config.MEMORY_LLM_PROTOCOL;
  const requestUrl = resolveRequestUrl(config.MEMORY_LLM_BASE_URL, protocol);
  const headers = resolveRequestHeaders(config);
  const requestBodies = buildRequestBodies(config, systemPrompt, userPayload, maxTokens);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < TRANSIENT_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(TRANSIENT_BACKOFF_MS[attempt] ?? TRANSIENT_BACKOFF_MS.at(-1) ?? 1_500);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort("memory_llm_timeout");
    }, config.MEMORY_LLM_TIMEOUT_MS);

    try {
      let response: Response | undefined;
      for (const requestBody of requestBodies) {
        response = await fetch(requestUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (response.ok) {
          break;
        }

        if (!shouldTryNextRequestBody(protocol)) {
          break;
        }
      }

      if (!response?.ok) {
        const status = response?.status;
        if (status !== undefined && attempt + 1 < TRANSIENT_ATTEMPTS && TRANSIENT_STATUS_CODES.has(status)) {
          continue;
        }
        throw new Error(`memory llm request failed with ${status ?? "unknown"}`);
      }

      const payload = (await response.json()) as AnthropicMessagesPayload | OpenAiChatPayload | OpenAiResponsesPayload | OllamaChatPayload;
      return extractResponseText(payload);
    } catch (error) {
      if (isTransientMemoryLlmError(error) && attempt + 1 < TRANSIENT_ATTEMPTS) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError ?? new Error("memory llm request failed");
}

function resolveRequestUrl(baseUrl: string, protocol: MemoryLlmConfig["MEMORY_LLM_PROTOCOL"]) {
  if (protocol === "anthropic") {
    return buildBaseUrl(baseUrl, "/v1/messages");
  }
  if (protocol === "openai-responses") {
    return buildBaseUrl(baseUrl, "/v1/responses");
  }
  if (protocol === "ollama") {
    return buildBaseUrl(baseUrl, "/api/chat");
  }
  return buildBaseUrl(baseUrl, "/v1/chat/completions");
}

function resolveRequestHeaders(config: MemoryLlmConfig) {
  if (config.MEMORY_LLM_PROTOCOL === "anthropic") {
    return {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(config.MEMORY_LLM_API_KEY ? { "x-api-key": config.MEMORY_LLM_API_KEY } : {}),
    };
  }

  return {
    "content-type": "application/json",
    ...(config.MEMORY_LLM_API_KEY
      ? { authorization: `Bearer ${config.MEMORY_LLM_API_KEY}` }
      : {}),
  };
}

function buildRequestBodies(
  config: MemoryLlmConfig,
  systemPrompt: string,
  userPayload: unknown,
  maxTokens: number,
) {
  if (config.MEMORY_LLM_PROTOCOL === "anthropic") {
    return [buildAnthropicBody(config, systemPrompt, userPayload, maxTokens)];
  }

  if (config.MEMORY_LLM_PROTOCOL === "openai-responses") {
    return [
      buildOpenAiResponsesBody(config, systemPrompt, userPayload, maxTokens, {
        includeTextFormat: true,
        includeReasoningEffort: true,
      }),
      buildOpenAiResponsesBody(config, systemPrompt, userPayload, maxTokens, {
        includeTextFormat: true,
        includeReasoningEffort: false,
      }),
      buildOpenAiResponsesBody(config, systemPrompt, userPayload, maxTokens, {
        includeTextFormat: false,
        includeReasoningEffort: false,
      }),
    ];
  }

  if (config.MEMORY_LLM_PROTOCOL === "ollama") {
    return [buildOllamaBody(config, systemPrompt, userPayload)];
  }

  return [
    buildOpenAiBody(config, systemPrompt, userPayload, maxTokens, {
      includeResponseFormat: true,
      includeReasoningEffort: true,
    }),
    buildOpenAiBody(config, systemPrompt, userPayload, maxTokens, {
      includeResponseFormat: false,
      includeReasoningEffort: true,
    }),
    buildOpenAiBody(config, systemPrompt, userPayload, maxTokens, {
      includeResponseFormat: false,
      includeReasoningEffort: false,
    }),
  ];
}

function shouldTryNextRequestBody(protocol: MemoryLlmConfig["MEMORY_LLM_PROTOCOL"]) {
  return protocol === "openai-compatible" || protocol === "openai-responses";
}

export function parseMemoryLlmJsonPayload(text: string): unknown {
  const direct = tryParseJson(text);
  if (direct !== undefined) {
    return direct;
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fencedMatch?.[1]) {
    const fenced = tryParseJson(fencedMatch[1]);
    if (fenced !== undefined) {
      return fenced;
    }
  }

  throw new Error("memory llm response did not contain valid JSON");
}

function mapOpenAiReasoningEffort(
  effort: "low" | "medium" | "high" | "xhigh" | "max" | undefined,
): "low" | "medium" | "high" | undefined {
  if (!effort) {
    return undefined;
  }

  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
  }

  return "high";
}

function mapAnthropicThinking(
  effort: "low" | "medium" | "high" | "xhigh" | "max" | undefined,
): { type: "enabled"; budget_tokens: number } | undefined {
  if (!effort) {
    return undefined;
  }

  const budgetMap = {
    low: 1024,
    medium: 2048,
    high: 4096,
    xhigh: 8192,
    max: 16384,
  } as const;

  return {
    type: "enabled",
    budget_tokens: budgetMap[effort],
  };
}

function buildAnthropicBody(
  config: MemoryLlmConfig,
  systemPrompt: string,
  userPayload: unknown,
  maxTokens: number,
) {
  return {
    model: config.MEMORY_LLM_MODEL,
    system: `${JSON_OBJECT_SYSTEM_PREFIX}\n${systemPrompt}`,
    max_tokens: maxTokens,
    thinking: mapAnthropicThinking(config.MEMORY_LLM_EFFORT),
    messages: [
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
  };
}

function buildOpenAiBody(
  config: MemoryLlmConfig,
  systemPrompt: string,
  userPayload: unknown,
  maxTokens: number,
  options: {
    includeResponseFormat: boolean;
    includeReasoningEffort: boolean;
  },
) {
  return {
    model: config.MEMORY_LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `${JSON_OBJECT_SYSTEM_PREFIX}\n${systemPrompt}`,
      },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
    ...(options.includeResponseFormat
      ? {
          response_format: {
            type: "json_object",
          },
        }
      : {}),
    max_tokens: maxTokens,
    ...(options.includeReasoningEffort
      ? {
          reasoning_effort: mapOpenAiReasoningEffort(config.MEMORY_LLM_EFFORT),
        }
      : {}),
  };
}

function buildOpenAiResponsesBody(
  config: MemoryLlmConfig,
  systemPrompt: string,
  userPayload: unknown,
  maxTokens: number,
  options: {
    includeTextFormat: boolean;
    includeReasoningEffort: boolean;
  },
) {
  const reasoningEffort = mapOpenAiReasoningEffort(config.MEMORY_LLM_EFFORT);

  return {
    model: config.MEMORY_LLM_MODEL,
    instructions: `${JSON_OBJECT_SYSTEM_PREFIX}\n${systemPrompt}`,
    input: `${JSON_OBJECT_INPUT_PREFIX}\n${JSON.stringify(userPayload)}`,
    max_output_tokens: maxTokens,
    store: false,
    ...(options.includeTextFormat
      ? {
          text: {
            format: {
              type: "json_object",
            },
          },
        }
      : {}),
    ...(options.includeReasoningEffort && reasoningEffort
      ? {
          reasoning: {
            effort: reasoningEffort,
          },
        }
      : {}),
  };
}

function buildOllamaBody(
  config: MemoryLlmConfig,
  systemPrompt: string,
  userPayload: unknown,
) {
  return {
    model: config.MEMORY_LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `${JSON_OBJECT_SYSTEM_PREFIX}\n${systemPrompt}`,
      },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
    stream: false,
  };
}

function extractResponseText(payload: AnthropicMessagesPayload | OpenAiChatPayload | OpenAiResponsesPayload | OllamaChatPayload): string {
  if ("output_text" in payload && typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if ("output" in payload && Array.isArray(payload.output)) {
    const textParts = payload.output
      .flatMap((item) => item.content ?? [])
      .filter((part) => (part?.type === "output_text" || part?.type === "text") && typeof part.text === "string")
      .map((part) => part.text ?? "");
    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  if ("content" in payload) {
    const textParts = (payload.content ?? [])
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text ?? "");

    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  if (isOpenAiChatPayload(payload)) {
    const choiceContent = payload.choices?.[0]?.message?.content;
    if (typeof choiceContent === "string" && choiceContent.trim()) {
      return choiceContent;
    }

    if (Array.isArray(choiceContent)) {
      const textParts = choiceContent
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text ?? "");
      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }
  }

  if ("message" in payload && typeof payload.message?.content === "string" && payload.message.content.trim()) {
    return payload.message.content;
  }

  if ("response" in payload && typeof payload.response === "string" && payload.response.trim()) {
    return payload.response;
  }

  throw new Error("memory llm response did not include text content");
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isTransientMemoryLlmError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("memory_llm_timeout")
    || error.message.includes("fetch failed")
    || error.message.includes("ECONNRESET")
    || error.message.includes("ETIMEDOUT")
    || error.message.includes("503")
    || error.message.includes("502")
    || error.message.includes("504");
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

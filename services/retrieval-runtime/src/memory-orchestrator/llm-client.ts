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

function isOpenAiChatPayload(payload: AnthropicMessagesPayload | OpenAiChatPayload): payload is OpenAiChatPayload {
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
  const requestUrl =
    protocol === "anthropic"
      ? new URL("/v1/messages", config.MEMORY_LLM_BASE_URL)
      : new URL("/v1/chat/completions", config.MEMORY_LLM_BASE_URL);
  const headers =
    protocol === "anthropic"
      ? {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(config.MEMORY_LLM_API_KEY ? { "x-api-key": config.MEMORY_LLM_API_KEY } : {}),
        }
      : {
          "content-type": "application/json",
          ...(config.MEMORY_LLM_API_KEY
            ? { authorization: `Bearer ${config.MEMORY_LLM_API_KEY}` }
            : {}),
        };

  const requestBodies =
    protocol === "anthropic"
      ? [buildAnthropicBody(config, systemPrompt, userPayload, maxTokens)]
      : [
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

        if (protocol !== "openai-compatible") {
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

      const payload = (await response.json()) as AnthropicMessagesPayload | OpenAiChatPayload;
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
    system: systemPrompt,
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
        content: systemPrompt,
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

function extractResponseText(payload: AnthropicMessagesPayload | OpenAiChatPayload): string {
  if ("output_text" in payload && typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
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

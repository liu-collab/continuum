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

export async function callMemoryLlm(
  config: MemoryLlmConfig,
  systemPrompt: string,
  userPayload: unknown,
  maxTokens: number,
): Promise<string> {
  if (!config.MEMORY_LLM_BASE_URL) {
    throw new Error("MEMORY_LLM_BASE_URL is not configured");
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort("memory_llm_timeout");
  }, config.MEMORY_LLM_TIMEOUT_MS);

  try {
    const protocol = config.MEMORY_LLM_PROTOCOL;
    const requestUrl =
      protocol === "anthropic"
        ? new URL("/v1/messages", config.MEMORY_LLM_BASE_URL)
        : new URL("/v1/chat/completions", config.MEMORY_LLM_BASE_URL);
    const response = await fetch(requestUrl, {
      method: "POST",
      headers:
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
            },
      body: JSON.stringify(
        protocol === "anthropic"
          ? {
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
            }
          : {
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
              response_format: {
                type: "json_object",
              },
              max_tokens: maxTokens,
              reasoning_effort: mapOpenAiReasoningEffort(config.MEMORY_LLM_EFFORT),
            },
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`memory llm request failed with ${response.status}`);
    }

    const payload = (await response.json()) as AnthropicMessagesPayload | OpenAiChatPayload;
    return extractResponseText(payload);
  } finally {
    clearTimeout(timeoutHandle);
  }
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

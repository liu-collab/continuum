import { z } from "zod";

import type { AppConfig } from "../config.js";
import { WRITEBACK_REFINE_SYSTEM_PROMPT } from "./llm-refiner-prompt.js";

const llmCandidateSchema = z.object({
  candidate_type: z.enum(["fact_preference", "task_state", "episodic"]),
  scope: z.enum(["workspace", "user", "task", "session"]),
  summary: z.string().min(1),
  importance: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  write_reason: z.string().min(1),
});

const llmExtractionResultSchema = z.object({
  candidates: z.array(llmCandidateSchema),
});

export type LlmExtractionCandidate = z.infer<typeof llmCandidateSchema>;

export interface LlmExtractionResult {
  candidates: LlmExtractionCandidate[];
}

const ruleIndexPattern = /^rule_index:\d+$/;

const llmRefineItemSchema = z.object({
  source: z.union([z.literal("llm_new"), z.string().regex(ruleIndexPattern)]),
  action: z.enum(["keep", "drop", "merge", "new"]),
  summary: z.string().min(1).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  confidence: z.number().min(0).max(1).optional(),
  scope: z.enum(["workspace", "user", "task", "session"]).optional(),
  candidate_type: z.enum(["fact_preference", "task_state", "episodic"]).optional(),
  merge_with: z.array(z.string().regex(ruleIndexPattern)).optional(),
  reason: z.string().min(1),
});

const llmRefineResultSchema = z.object({
  refined_candidates: z.array(llmRefineItemSchema),
});

export type LlmRefineItem = z.infer<typeof llmRefineItemSchema>;
export type LlmRefineResult = z.infer<typeof llmRefineResultSchema>;

export interface RuleCandidateDigest {
  index: number;
  candidate_type: LlmExtractionCandidate["candidate_type"];
  scope: LlmExtractionCandidate["scope"];
  summary: string;
  importance: number;
  confidence: number;
  write_reason: string;
}

export interface LlmRefineInput {
  current_input: string;
  assistant_output: string;
  tool_results_summary?: string;
  task_id?: string;
  rule_candidates: RuleCandidateDigest[];
}

export interface LlmExtractor {
  extract(input: {
    current_input: string;
    assistant_output: string;
    tool_results_summary?: string;
    task_id?: string;
  }): Promise<LlmExtractionResult>;
  refine(input: LlmRefineInput): Promise<LlmRefineResult>;
  healthCheck?(): Promise<void>;
}

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

const WRITEBACK_EXTRACTION_SYSTEM_PROMPT = `
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
`.trim();

export type WritebackLlmConfig = Pick<
  AppConfig,
  | "MEMORY_LLM_BASE_URL"
  | "MEMORY_LLM_MODEL"
  | "MEMORY_LLM_API_KEY"
  | "MEMORY_LLM_PROTOCOL"
  | "MEMORY_LLM_TIMEOUT_MS"
  | "MEMORY_LLM_EFFORT"
>;

export async function callWritebackLlm(
  config: WritebackLlmConfig,
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

export class HttpLlmExtractor implements LlmExtractor {
  constructor(private readonly config: AppConfig) {}

  async healthCheck(): Promise<void> {
    await callWritebackLlm(
      this.config,
      WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      {
        current_input: "health check",
        assistant_output: "health check",
        tool_results_summary: "",
        task_id: null,
      },
      64,
    );
  }

  async extract(input: {
    current_input: string;
    assistant_output: string;
    tool_results_summary?: string;
    task_id?: string;
  }): Promise<LlmExtractionResult> {
    const text = await callWritebackLlm(
      this.config,
      WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      {
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary ?? "",
        task_id: input.task_id ?? null,
      },
      this.config.MEMORY_LLM_MAX_TOKENS ?? 600,
    );
    const parsedJson = parseJsonPayload(text);
    const parsed = llmExtractionResultSchema.safeParse(parsedJson);

    if (!parsed.success) {
      throw new Error("memory llm response did not match extraction schema");
    }

    return {
      candidates: parsed.data.candidates.slice(0, this.config.WRITEBACK_MAX_CANDIDATES),
    };
  }

  async refine(input: LlmRefineInput): Promise<LlmRefineResult> {
    const text = await callWritebackLlm(
      this.config,
      WRITEBACK_REFINE_SYSTEM_PROMPT,
      {
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary ?? "",
        task_id: input.task_id ?? null,
        rule_candidates: input.rule_candidates,
      },
      this.config.WRITEBACK_LLM_REFINE_MAX_TOKENS,
    );
    const parsedJson = parseJsonPayload(text);
    const parsed = llmRefineResultSchema.safeParse(parsedJson);

    if (!parsed.success) {
      throw new Error("memory llm refine response did not match schema");
    }

    const cap = this.config.WRITEBACK_MAX_CANDIDATES * 3;
    return {
      refined_candidates: parsed.data.refined_candidates.slice(0, cap),
    };
  }
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

export function parseJsonPayload(text: string): unknown {
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

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

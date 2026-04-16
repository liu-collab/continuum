import { z } from "zod";

import type { AppConfig } from "../config.js";

const llmCandidateSchema = z.object({
  candidate_type: z.enum(["fact_preference", "task_state", "episodic"]),
  scope: z.enum(["user", "task", "session"]),
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

export interface LlmExtractor {
  extract(input: {
    current_input: string;
    assistant_output: string;
    tool_results_summary?: string;
    task_id?: string;
  }): Promise<LlmExtractionResult>;
}

const WRITEBACK_EXTRACTION_SYSTEM_PROMPT = `
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "user" | "task" | "session"
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
- Return at most 5 candidates.
`.trim();

export class HttpLlmExtractor implements LlmExtractor {
  constructor(private readonly config: AppConfig) {}

  async extract(input: {
    current_input: string;
    assistant_output: string;
    tool_results_summary?: string;
    task_id?: string;
  }): Promise<LlmExtractionResult> {
    if (!this.config.WRITEBACK_LLM_BASE_URL) {
      throw new Error("WRITEBACK_LLM_BASE_URL is not configured");
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort("writeback_llm_timeout");
    }, this.config.WRITEBACK_LLM_TIMEOUT_MS);

    try {
      const response = await fetch(new URL("/v1/messages", this.config.WRITEBACK_LLM_BASE_URL), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(this.config.WRITEBACK_LLM_API_KEY ? { "x-api-key": this.config.WRITEBACK_LLM_API_KEY } : {}),
        },
        body: JSON.stringify({
          model: this.config.WRITEBACK_LLM_MODEL,
          system: WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
          max_tokens: 600,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                current_input: input.current_input,
                assistant_output: input.assistant_output,
                tool_results_summary: input.tool_results_summary ?? "",
                task_id: input.task_id ?? null,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`writeback llm request failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        output_text?: string;
      };
      const text = extractResponseText(payload);
      const parsedJson = parseJsonPayload(text);
      const parsed = llmExtractionResultSchema.safeParse(parsedJson);

      if (!parsed.success) {
        throw new Error("writeback llm response did not match extraction schema");
      }

      return {
        candidates: parsed.data.candidates.slice(0, this.config.WRITEBACK_MAX_CANDIDATES),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

function extractResponseText(payload: { content?: Array<{ type?: string; text?: string }>; output_text?: string }): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const textParts = (payload.content ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "");

  if (textParts.length === 0) {
    throw new Error("writeback llm response did not include text content");
  }

  return textParts.join("\n");
}

function parseJsonPayload(text: string): unknown {
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

  throw new Error("writeback llm response did not contain valid JSON");
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

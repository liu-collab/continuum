import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import {
  MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
} from "../prompts.js";
import {
  memoryWritebackExtractionSchema,
  memoryWritebackRefineSchema,
} from "../schemas.js";
import type { WritebackExtractionResult, WritebackPlanner, WritebackRefineInput, WritebackRefineResult } from "../types.js";

type WritebackPlannerConfig = MemoryLlmConfig &
  Pick<AppConfig, "MEMORY_LLM_MAX_TOKENS" | "WRITEBACK_LLM_REFINE_MAX_TOKENS" | "WRITEBACK_MAX_CANDIDATES">;

export class HttpMemoryWritebackPlanner implements WritebackPlanner {
  constructor(private readonly config: WritebackPlannerConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
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
  }): Promise<WritebackExtractionResult> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      {
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary ?? "",
        task_id: input.task_id ?? null,
      },
      this.config.MEMORY_LLM_MAX_TOKENS ?? 600,
    );
    const parsed = memoryWritebackExtractionSchema.safeParse(parseMemoryLlmJsonPayload(text));

    if (!parsed.success) {
      throw new Error("memory llm response did not match extraction schema");
    }

    return {
      candidates: parsed.data.candidates.slice(0, this.config.WRITEBACK_MAX_CANDIDATES),
    };
  }

  async refine(input: WritebackRefineInput): Promise<WritebackRefineResult> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      {
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary ?? "",
        task_id: input.task_id ?? null,
        rule_candidates: input.rule_candidates,
      },
      this.config.WRITEBACK_LLM_REFINE_MAX_TOKENS,
    );
    const parsed = memoryWritebackRefineSchema.safeParse(parseMemoryLlmJsonPayload(text));

    if (!parsed.success) {
      throw new Error("memory llm refine response did not match schema");
    }

    const cap = this.config.WRITEBACK_MAX_CANDIDATES * 3;
    return {
      refined_candidates: parsed.data.refined_candidates.slice(0, cap),
    };
  }
}

import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT } from "../prompts.js";
import { memoryIntentAnalyzerSchema } from "../schemas.js";
import type { IntentAnalyzer, IntentAnalyzerInput, IntentAnalyzerOutput } from "../types.js";

type IntentAnalyzerConfig = MemoryLlmConfig &
  Pick<AppConfig, "RECALL_LLM_JUDGE_MAX_TOKENS">;

export class HttpMemoryIntentAnalyzer implements IntentAnalyzer {
  constructor(private readonly config: IntentAnalyzerConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      {
        current_input: "继续之前那个重构任务",
        session_context: {
          session_id: "health-check-session",
          workspace_id: "health-check-workspace",
          recent_turns: [],
        },
      },
      64,
    );
  }

  async analyze(input: IntentAnalyzerInput): Promise<IntentAnalyzerOutput> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      input,
      this.config.RECALL_LLM_JUDGE_MAX_TOKENS,
    );
    const parsed = memoryIntentAnalyzerSchema.safeParse(parseMemoryLlmJsonPayload(text));
    if (!parsed.success) {
      throw new Error("memory intent analyzer response did not match schema");
    }
    return parsed.data;
  }
}

import type { AppConfig } from "../config.js";
import { HttpMemoryRecallInjectionPlanner } from "../memory-orchestrator/recall/injection-planner.js";
import { HttpMemoryRecallSearchPlanner } from "../memory-orchestrator/recall/search-planner.js";
import type {
  RecallInjectionInput as LlmRecallInjectionInput,
  RecallInjectionPlan as LlmRecallPlan,
  RecallInjectionPlanner as LlmRecallInjectionPlanner,
  RecallSearchInput as LlmRecallSearchInput,
  RecallSearchPlan as LlmRecallSearchPlan,
  RecallSearchPlanner as LlmRecallSearchPlanner,
} from "../memory-orchestrator/types.js";

export type {
  RecallInjectionInput as LlmRecallInjectionInput,
  RecallInjectionPlan as LlmRecallPlan,
  RecallSearchInput as LlmRecallSearchInput,
  RecallSearchPlan as LlmRecallSearchPlan,
} from "../memory-orchestrator/types.js";

export interface LlmRecallPlanner {
  planSearch(input: LlmRecallSearchInput): Promise<LlmRecallSearchPlan>;
  planInjection(input: LlmRecallInjectionInput): Promise<LlmRecallPlan>;
  healthCheck?(): Promise<void>;
}

export class HttpLlmRecallPlanner implements LlmRecallPlanner {
  private readonly searchPlanner: LlmRecallSearchPlanner;
  private readonly injectionPlanner: LlmRecallInjectionPlanner;

  constructor(config: Pick<
    AppConfig,
    | "MEMORY_LLM_BASE_URL"
    | "MEMORY_LLM_MODEL"
    | "MEMORY_LLM_API_KEY"
    | "MEMORY_LLM_PROTOCOL"
    | "MEMORY_LLM_TIMEOUT_MS"
    | "MEMORY_LLM_EFFORT"
    | "RECALL_LLM_JUDGE_MAX_TOKENS"
    | "RECALL_LLM_CANDIDATE_LIMIT"
  >) {
    this.searchPlanner = new HttpMemoryRecallSearchPlanner(config);
    this.injectionPlanner = new HttpMemoryRecallInjectionPlanner(config);
  }

  async healthCheck(): Promise<void> {
    await this.searchPlanner.healthCheck?.();
  }

  async planSearch(input: LlmRecallSearchInput): Promise<LlmRecallSearchPlan> {
    return this.searchPlanner.plan(input);
  }

  async planInjection(input: LlmRecallInjectionInput): Promise<LlmRecallPlan> {
    return this.injectionPlanner.plan(input);
  }
}

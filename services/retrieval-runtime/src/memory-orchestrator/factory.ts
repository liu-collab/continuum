import type { AppConfig } from "../config.js";
import type { LlmRecallPlanner } from "../trigger/llm-recall-judge.js";
import type { LlmExtractor } from "../writeback/llm-extractor.js";
import type { GovernanceVerifier } from "../writeback/llm-governance-verifier.js";
import type { LlmMaintenancePlanner } from "../writeback/llm-maintenance-planner.js";
import type { MemoryOrchestrator } from "./types.js";

export function createMemoryOrchestrator(input: {
  config: AppConfig;
  recallPlanner?: LlmRecallPlanner;
  writebackPlanner?: LlmExtractor;
  governancePlanner?: LlmMaintenancePlanner;
  governanceVerifier?: GovernanceVerifier;
}): MemoryOrchestrator | undefined {
  if (
    !input.recallPlanner
    && !input.writebackPlanner
    && !input.governancePlanner
    && !input.governanceVerifier
  ) {
    return undefined;
  }

  return {
    recall: input.recallPlanner
      ? {
          search: {
            plan: (args) => input.recallPlanner!.planSearch(args),
            healthCheck: () => input.recallPlanner!.healthCheck?.(),
          },
          injection: {
            plan: (args) => input.recallPlanner!.planInjection(args),
            healthCheck: () => input.recallPlanner!.healthCheck?.(),
          },
        }
      : undefined,
    writeback: input.writebackPlanner
      ? {
          extract: (args) => input.writebackPlanner!.extract(args),
          refine: (args) => input.writebackPlanner!.refine(args),
          healthCheck: () => input.writebackPlanner!.healthCheck?.(),
        }
      : undefined,
    governance:
      input.governancePlanner || input.governanceVerifier
        ? {
            planner: input.governancePlanner
              ? {
                  plan: (args) => input.governancePlanner!.plan(args),
                  healthCheck: () => input.governancePlanner!.healthCheck?.(),
                }
              : undefined,
            verifier: input.governanceVerifier
              ? {
                  verify: (args) => input.governanceVerifier!.verify(args),
                }
              : undefined,
          }
        : undefined,
  };
}

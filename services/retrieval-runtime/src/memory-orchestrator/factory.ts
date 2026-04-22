import type { AppConfig } from "../config.js";
import type {
  GovernancePlanner,
  GovernanceVerifier,
  MemoryOrchestrator,
  RecallInjectionPlanner,
  RecallSearchPlanner,
  WritebackPlanner,
} from "./types.js";

export function createMemoryOrchestrator(input: {
  config: AppConfig;
  recallPlanner?: {
    search: RecallSearchPlanner;
    injection: RecallInjectionPlanner;
  };
  writebackPlanner?: WritebackPlanner;
  governancePlanner?: GovernancePlanner;
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
          search: input.recallPlanner.search,
          injection: input.recallPlanner.injection,
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

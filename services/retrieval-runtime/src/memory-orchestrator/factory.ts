import type { AppConfig } from "../config.js";
import type {
  GovernancePlanner,
  GovernanceVerifier,
  IntentAnalyzer,
  MemoryOrchestrator,
  ProactiveRecommender,
  QualityAssessor,
  RecallEffectivenessEvaluator,
  RecallInjectionPlanner,
  RelationDiscoverer,
  RecallSearchPlanner,
  WritebackPlanner,
  EvolutionPlanner,
} from "./types.js";

export function createMemoryOrchestrator(input: {
  config: AppConfig;
  intentAnalyzer?: IntentAnalyzer;
  recallPlanner?: {
    search: RecallSearchPlanner;
    injection: RecallInjectionPlanner;
  };
  recallEffectivenessEvaluator?: RecallEffectivenessEvaluator;
  writebackPlanner?: WritebackPlanner;
  qualityAssessor?: QualityAssessor;
  relationDiscoverer?: RelationDiscoverer;
  proactiveRecommender?: ProactiveRecommender;
  governancePlanner?: GovernancePlanner;
  governanceVerifier?: GovernanceVerifier;
  evolutionPlanner?: EvolutionPlanner;
}): MemoryOrchestrator | undefined {
  if (
    !input.intentAnalyzer
    && !input.recallPlanner
    && !input.recallEffectivenessEvaluator
    && !input.writebackPlanner
    && !input.qualityAssessor
    && !input.relationDiscoverer
    && !input.proactiveRecommender
    && !input.governancePlanner
    && !input.governanceVerifier
    && !input.evolutionPlanner
  ) {
    return undefined;
  }

  return {
    intent: input.intentAnalyzer
      ? {
          analyze: (args) => input.intentAnalyzer!.analyze(args),
          healthCheck: () => input.intentAnalyzer!.healthCheck?.(),
        }
      : undefined,
    recall: input.recallPlanner
      ? {
          search: input.recallPlanner.search,
          injection: input.recallPlanner.injection,
          effectiveness: input.recallEffectivenessEvaluator
            ? {
                evaluate: (args) => input.recallEffectivenessEvaluator!.evaluate(args),
                healthCheck: () => input.recallEffectivenessEvaluator!.healthCheck?.(),
              }
            : undefined,
        }
      : input.recallEffectivenessEvaluator
        ? {
            effectiveness: {
              evaluate: (args) => input.recallEffectivenessEvaluator!.evaluate(args),
              healthCheck: () => input.recallEffectivenessEvaluator!.healthCheck?.(),
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
    quality: input.qualityAssessor
      ? {
          assess: (args) => input.qualityAssessor!.assess(args),
          healthCheck: () => input.qualityAssessor!.healthCheck?.(),
        }
      : undefined,
    relation: input.relationDiscoverer
      ? {
          discover: (args) => input.relationDiscoverer!.discover(args),
          healthCheck: () => input.relationDiscoverer!.healthCheck?.(),
        }
      : undefined,
    recommendation: input.proactiveRecommender
      ? {
          recommend: (args) => input.proactiveRecommender!.recommend(args),
          healthCheck: () => input.proactiveRecommender!.healthCheck?.(),
        }
      : undefined,
    governance:
      input.governancePlanner || input.governanceVerifier || input.evolutionPlanner
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
            evolution: input.evolutionPlanner
              ? {
                  plan: (args) => input.evolutionPlanner!.plan(args),
                  healthCheck: () => input.evolutionPlanner!.healthCheck?.(),
                }
              : undefined,
          }
        : undefined,
  };
}

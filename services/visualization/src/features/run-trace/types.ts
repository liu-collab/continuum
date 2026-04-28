import type {
  RuntimeDependencyRecord,
  RuntimeInjectionRecord,
  RuntimeMemoryPlanRecord,
  RuntimeRecallRecord,
  RuntimeTriggerRecord,
  RuntimeTurnRecord,
  RuntimeWritebackRecord
} from "@/lib/server/runtime-observe-client";

export type RunAggregate = {
  turn: RuntimeTurnRecord;
  turns: RuntimeTurnRecord[];
  triggerRuns: RuntimeTriggerRecord[];
  recallRuns: RuntimeRecallRecord[];
  injectionRuns: RuntimeInjectionRecord[];
  memoryPlanRuns: RuntimeMemoryPlanRecord[];
  writeBackRuns: RuntimeWritebackRecord[];
  dependencyStatus: RuntimeDependencyRecord[];
};

export type PhaseAggregate = {
  phase: string;
  turn?: RuntimeTurnRecord;
  triggerRun?: RuntimeTriggerRecord;
  recallRun?: RuntimeRecallRecord;
  injectionRun?: RuntimeInjectionRecord;
  memoryPlanRuns: RuntimeMemoryPlanRecord[];
  writeBackRun?: RuntimeWritebackRecord;
};

export type ResidentInjectionContext = {
  traceId: string;
  injectedCount: number;
  createdAt: string | null;
};

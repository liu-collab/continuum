import { describe, expect, it } from "vitest";

import { buildNarrative, buildPhaseNarratives, describeRunTraceEmptyState } from "@/features/run-trace/service";
import { RunTraceResponse } from "@/lib/contracts";

describe("run trace narrative", () => {
  const baseDetail = {
    turn: {
      traceId: "trace-1",
      turnId: "turn-1",
      workspaceId: null,
      userId: null,
      taskId: null,
      sessionId: null,
      threadId: null,
      host: null,
      phase: "before_response",
      currentInput: "Input",
      assistantOutput: null,
      createdAt: null
    },
    turns: [],
    triggerRuns: [],
    recallRuns: [],
    injectionRuns: [],
    memoryPlanRuns: [],
    writeBackRuns: [],
    dependencyStatus: []
  };

  it("explains missing trigger", () => {
    const narrative = buildNarrative(baseDetail);

    expect(narrative.outcomeCode).toBe("no_trigger");
    expect(narrative.explanation).toContain("跳过了检索");
  });

  it("explains empty recall", () => {
    const narrative = buildNarrative({
      ...baseDetail,
      triggerRuns: [
        {
          traceId: "trace-1",
          phase: "before_response",
          triggerHit: true,
          triggerType: "history_reference",
          triggerReason: "reason",
          memoryMode: "workspace_plus_global" as const,
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: ["workspace", "user"],
          scopeDecision: "Selected workspace and global scope.",
          scopeLimit: ["workspace", "user"],
          importanceThreshold: 3,
          cooldownApplied: false,
          semanticScore: null,
          durationMs: 10,
          createdAt: null
        }
      ],
      recallRuns: [
        {
          traceId: "trace-1",
          phase: "before_response",
          triggerType: "history_reference",
          triggerHit: true,
          triggerReason: "reason",
          memoryMode: "workspace_plus_global" as const,
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: [],
          scopeHitCounts: [],
          selectedRecordIds: [],
          queryScope: "scope=workspace,user",
          candidateCount: 0,
          selectedCount: 0,
          resultState: "empty",
          emptyReason: "No records matched.",
          durationMs: 120,
          degraded: false,
          degradationReason: null,
          createdAt: null
        }
      ]
    });

    expect(narrative.outcomeCode).toBe("empty_recall");
  });

  it("explains found but not injected", () => {
    const narrative = buildNarrative({
      ...baseDetail,
      triggerRuns: [
        {
          traceId: "trace-1",
          phase: "before_response",
          triggerHit: true,
          triggerType: "history_reference",
          triggerReason: "reason",
          memoryMode: "workspace_plus_global" as const,
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: ["workspace", "user"],
          scopeDecision: "Selected workspace and global scope.",
          scopeLimit: ["workspace", "user"],
          importanceThreshold: 3,
          cooldownApplied: false,
          semanticScore: null,
          durationMs: 10,
          createdAt: null
        }
      ],
      recallRuns: [
        {
          traceId: "trace-1",
          phase: "before_response",
          triggerType: "history_reference",
          triggerHit: true,
          triggerReason: "reason",
          memoryMode: "workspace_plus_global" as const,
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: ["workspace", "user"],
          scopeHitCounts: [
            { scope: "workspace", count: 1 },
            { scope: "user", count: 1 }
          ],
          selectedRecordIds: ["a", "b"],
          queryScope: "scope=workspace,user",
          candidateCount: 3,
          selectedCount: 2,
          resultState: "matched",
          emptyReason: null,
          durationMs: 120,
          degraded: false,
          degradationReason: null,
          createdAt: null
        }
      ],
      injectionRuns: [
        {
          traceId: "trace-1",
          phase: "before_response",
          injected: false,
          injectedCount: 0,
          memoryMode: "workspace_plus_global" as const,
          requestedScopes: ["workspace", "user"],
          selectedScopes: [],
          keptRecordIds: [],
          injectionReason: "Token budget exceeded.",
          memorySummary: null,
          tokenEstimate: 250,
          trimmedRecordIds: ["a", "b"],
          trimReasons: ["token budget"],
          resultState: "trimmed_to_zero",
          durationMs: 20,
          createdAt: null
        }
      ],
      writeBackRuns: [
        {
          traceId: "trace-1",
          phase: "after_response",
          memoryMode: "workspace_plus_global" as const,
          resultState: "submitted",
          candidateCount: 1,
          submittedCount: 1,
          submittedJobIds: ["job-1"],
          candidateSummaries: ["summary"],
          scopeDecisions: [
            { scope: "workspace", count: 1, reason: "Project-specific memory." }
          ],
          filteredCount: 0,
          filteredReasons: [],
          degraded: false,
          degradationReason: null,
          durationMs: 10,
          createdAt: null
        }
      ]
    });

    expect(narrative.outcomeCode).toBe("found_but_not_injected");
  });

  it("builds phase narratives for each recorded phase instead of collapsing to the first item", () => {
    const narratives = buildPhaseNarratives({
      ...baseDetail,
      turns: [
        {
          ...baseDetail.turn,
          phase: "task_start",
          currentInput: "开始任务"
        },
        {
          ...baseDetail.turn,
          phase: "before_response",
          currentInput: "继续回答"
        }
      ],
      triggerRuns: [
        {
          traceId: "trace-1",
          phase: "task_start",
          triggerHit: true,
          triggerType: "phase",
          triggerReason: "task_start is mandatory",
          memoryMode: "workspace_plus_global",
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace"],
          selectedScopes: [],
          scopeDecision: "phase trigger",
          scopeLimit: [],
          importanceThreshold: 3,
          cooldownApplied: false,
          semanticScore: null,
          durationMs: 10,
          createdAt: null
        },
        {
          traceId: "trace-1",
          phase: "before_response",
          triggerHit: true,
          triggerType: "history_reference",
          triggerReason: "history reference",
          memoryMode: "workspace_plus_global",
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: [],
          scopeDecision: "history trigger",
          scopeLimit: [],
          importanceThreshold: 3,
          cooldownApplied: false,
          semanticScore: null,
          durationMs: 10,
          createdAt: null
        }
      ],
      recallRuns: [
        {
          traceId: "trace-1",
          phase: "before_response",
          triggerType: "history_reference",
          triggerHit: true,
          triggerReason: "reason",
          memoryMode: "workspace_plus_global",
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: ["user"],
          scopeHitCounts: [{ scope: "user", count: 1 }],
          selectedRecordIds: ["memory-1"],
          queryScope: "scope=user",
          candidateCount: 1,
          selectedCount: 1,
          resultState: "matched",
          emptyReason: null,
          durationMs: 12,
          degraded: false,
          degradationReason: null,
          createdAt: null
        }
      ],
      memoryPlanRuns: [
        {
          traceId: "trace-1",
          phase: "before_response",
          planKind: "memory_search_plan",
          inputSummary: "input=继续回答",
          outputSummary: "hit=true",
          promptVersion: "memory-recall-search-v1",
          schemaVersion: "memory-plan-schema-v1",
          degraded: false,
          degradationReason: null,
          resultState: "planned",
          durationMs: 4,
          createdAt: null
        }
      ],
      injectionRuns: [],
      writeBackRuns: [],
      dependencyStatus: []
    });

    expect(narratives.some((item) => item.title === "Turn / task_start")).toBe(true);
    expect(narratives.some((item) => item.title === "Recall / before_response")).toBe(true);
    expect(narratives.some((item) => item.title === "Plan / before_response")).toBe(true);
  });

  it("describes governance plan-only traces", () => {
    const narrative = buildNarrative({
      ...baseDetail,
      memoryPlanRuns: [
        {
          traceId: "trace-plan",
          phase: "after_response",
          planKind: "memory_governance_plan",
          inputSummary: "workspace=ws",
          outputSummary: "actions=1",
          promptVersion: "memory-governance-plan-v1",
          schemaVersion: "memory-plan-schema-v1",
          degraded: false,
          degradationReason: null,
          resultState: "planned",
          durationMs: 10,
          createdAt: null
        }
      ]
    });

    expect(narrative.outcomeCode).toBe("plan_only");
  });

  it("summarizes newly added plan kinds in phase narratives", () => {
    const narratives = buildPhaseNarratives({
      ...baseDetail,
      memoryPlanRuns: [
        {
          traceId: "trace-plan",
          phase: "before_response",
          planKind: "memory_intent_plan",
          inputSummary: "input=继续上次任务",
          outputSummary: "needs_memory=true",
          promptVersion: "memory-intent-plan-v1",
          schemaVersion: "memory-plan-schema-v1",
          degraded: false,
          degradationReason: null,
          resultState: "planned",
          durationMs: 3,
          createdAt: null
        },
        {
          traceId: "trace-plan",
          phase: "before_response",
          planKind: "memory_relation_plan",
          inputSummary: "seed=mem-task",
          outputSummary: "relations=1",
          promptVersion: "memory-relation-plan-v1",
          schemaVersion: "memory-plan-schema-v1",
          degraded: false,
          degradationReason: null,
          resultState: "planned",
          durationMs: 2,
          createdAt: null
        },
        {
          traceId: "trace-plan",
          phase: "session_start",
          planKind: "memory_recommendation_plan",
          inputSummary: "available=3",
          outputSummary: "recommendations=1",
          promptVersion: "memory-recommendation-plan-v1",
          schemaVersion: "memory-plan-schema-v1",
          degraded: false,
          degradationReason: null,
          resultState: "planned",
          durationMs: 4,
          createdAt: null
        },
        {
          traceId: "trace-plan",
          phase: "after_response",
          planKind: "memory_evolution_plan",
          inputSummary: "workspace=ws",
          outputSummary: "knowledge=1",
          promptVersion: "memory-evolution-plan-v1",
          schemaVersion: "memory-plan-schema-v1",
          degraded: false,
          degradationReason: null,
          resultState: "planned",
          durationMs: 5,
          createdAt: null
        }
      ]
    });

    const planNarratives = narratives.filter((item) => item.key === "plan");
    expect(planNarratives.some((item) => item.summary.includes("memory_intent_plan"))).toBe(true);
    expect(planNarratives.some((item) => item.summary.includes("memory_recommendation_plan"))).toBe(true);
    expect(planNarratives.some((item) => item.details.some((detail) => detail.includes("memory_evolution_plan")))).toBe(true);
  });
});

describe("run trace empty state", () => {
  it("returns source unavailable explanation when runtime source failed", () => {
    const response = {
      items: [],
      total: 0,
      selectedTurn: null,
      appliedFilters: {
        turnId: "turn-1",
        sessionId: undefined,
        traceId: undefined,
        page: 1,
        pageSize: 20
      },
      sourceStatus: {
        name: "runtime_api",
        label: "Runtime observe API",
        kind: "dependency",
        status: "timeout",
        checkedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        lastOkAt: null,
        lastError: "timeout",
        responseTimeMs: 2000,
        detail: "Timed out after 2000 ms.",
        activeConnections: null,
        connectionLimit: null
      }
    } satisfies RunTraceResponse;

    const state = describeRunTraceEmptyState(response);
    expect(state.title).toContain("运行时数据源暂不可用");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRuntimeRunsMock } = vi.hoisted(() => ({
  fetchRuntimeRunsMock: vi.fn<() => Promise<any>>()
}));

vi.mock("@/lib/server/runtime-observe-client", () => ({
  fetchRuntimeRuns: fetchRuntimeRunsMock
}));

import { buildNarrative, buildPhaseNarratives, describeRunTraceEmptyState, getRunTrace } from "@/features/run-trace/service";
import { RunTraceResponse } from "@/lib/contracts";

const healthyStatus = {
  name: "runtime_api",
  label: "Runtime observe API",
  kind: "dependency" as const,
  status: "healthy" as const,
  checkedAt: new Date().toISOString(),
  lastCheckedAt: new Date().toISOString(),
  lastOkAt: new Date().toISOString(),
  lastError: null,
  responseTimeMs: 20,
  detail: null,
  activeConnections: null,
  connectionLimit: null
};

const emptyRuntimeRuns = {
  turns: [],
  triggerRuns: [],
  recallRuns: [],
  injectionRuns: [],
  memoryPlanRuns: [],
  writeBackRuns: [],
  dependencyStatus: []
};

describe("run trace narrative", () => {
  beforeEach(() => {
    fetchRuntimeRunsMock.mockReset();
  });

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
          requestedTypes: ["preference"],
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
          requestedTypes: ["preference"],
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

  it("explains recall candidates that are intentionally not injected", () => {
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
          requestedTypes: ["preference"],
          requestedScopes: ["user", "session"],
          selectedScopes: [],
          scopeDecision: "Selected user and session scope.",
          scopeLimit: ["user", "session"],
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
          requestedTypes: ["preference"],
          requestedScopes: ["user", "session"],
          selectedScopes: [],
          scopeHitCounts: [{ scope: "user", count: 1 }],
          selectedRecordIds: [],
          queryScope: "scope=user,session",
          candidateCount: 1,
          selectedCount: 0,
          resultState: "empty",
          emptyReason: null,
          durationMs: 120,
          degraded: false,
          degradationReason: null,
          createdAt: null
        }
      ],
      memoryPlanRuns: [
        {
          traceId: "trace-1",
          phase: "before_response",
          planKind: "memory_injection_plan",
          inputSummary: "input=你是谁; candidate_count=1",
          outputSummary: "should_inject=false; reason=当前问题自包含，虽有称呼偏好但非回答所必需; candidate_count=1; summary=",
          promptVersion: "memory-recall-injection-v1",
          schemaVersion: "memory-plan-schema-v1",
          degraded: false,
          degradationReason: null,
          resultState: "skipped",
          durationMs: 20,
          createdAt: null
        }
      ]
    });

    expect(narrative.outcomeCode).toBe("candidate_not_selected");
    expect(narrative.explanation).toContain("查到了 1 条候选记忆");
    expect(narrative.explanation).toContain("当前问题自包含");
    expect(narrative.explanation).not.toContain("本轮不需要放入提示词");
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
          requestedTypes: ["preference"],
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
          requestedTypes: ["preference"],
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
          requestedTypes: ["preference"],
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
          requestedTypes: ["preference"],
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
          requestedTypes: ["preference"],
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

    expect(narratives.some((item) => item.title === "轮次 / task_start")).toBe(true);
    expect(narratives.some((item) => item.title === "召回 / before_response")).toBe(true);
    expect(narratives.some((item) => item.title === "计划 / before_response")).toBe(true);
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

  it("falls back to trace_id when a legacy turn_id query contains a trace id", async () => {
    const traceId = "a048c6c0-900a-443e-9d34-d8db2981c2bf";
    fetchRuntimeRunsMock
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: emptyRuntimeRuns
      })
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          memoryPlanRuns: [
            {
              traceId,
              phase: "before_response",
              planKind: "memory_intent_plan",
              inputSummary: "input=继续",
              outputSummary: "needs_memory=true",
              promptVersion: "memory-intent-plan-v1",
              schemaVersion: "memory-plan-schema-v1",
              degraded: false,
              degradationReason: null,
              resultState: "planned",
              durationMs: 3,
              createdAt: "2026-04-22T00:00:00Z"
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          memoryPlanRuns: [
            {
              traceId,
              phase: "before_response",
              planKind: "memory_intent_plan",
              inputSummary: "input=继续",
              outputSummary: "needs_memory=true",
              promptVersion: "memory-intent-plan-v1",
              schemaVersion: "memory-plan-schema-v1",
              degraded: false,
              degradationReason: null,
              resultState: "planned",
              durationMs: 3,
              createdAt: "2026-04-22T00:00:00Z"
            }
          ]
        }
      });

    const response = await getRunTrace({
      turnId: traceId,
      sessionId: undefined,
      traceId: undefined,
      page: 1,
      pageSize: 20
    });

    expect(fetchRuntimeRunsMock).toHaveBeenNthCalledWith(1, `turn_id=${traceId}&page=1&page_size=20`, { locale: "zh-CN" });
    expect(fetchRuntimeRunsMock).toHaveBeenNthCalledWith(2, `trace_id=${traceId}&page=1&page_size=20`, { locale: "zh-CN" });
    expect(fetchRuntimeRunsMock).toHaveBeenNthCalledWith(3, "page=1&page_size=20", { locale: "zh-CN" });
    expect(fetchRuntimeRunsMock).toHaveBeenCalledTimes(3);
    expect(response.selectedTurn?.turn.traceId).toBe(traceId);
    expect(response.selectedTurn?.narrative.outcomeCode).toBe("plan_only");
  });

  it("keeps the recent run list when a trace is selected", async () => {
    fetchRuntimeRunsMock
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          memoryPlanRuns: [
            {
              traceId: "trace-selected",
              phase: "before_response",
              planKind: "memory_intent_plan",
              inputSummary: "selected input",
              outputSummary: "selected output",
              promptVersion: "memory-intent-plan-v1",
              schemaVersion: "memory-plan-schema-v1",
              degraded: false,
              degradationReason: null,
              resultState: "planned",
              durationMs: 3,
              createdAt: "2026-04-22T00:00:00Z"
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          memoryPlanRuns: [
            {
              traceId: "trace-newer",
              phase: "before_response",
              planKind: "memory_intent_plan",
              inputSummary: "newer input",
              outputSummary: "newer output",
              promptVersion: "memory-intent-plan-v1",
              schemaVersion: "memory-plan-schema-v1",
              degraded: false,
              degradationReason: null,
              resultState: "planned",
              durationMs: 3,
              createdAt: "2026-04-23T00:00:00Z"
            },
            {
              traceId: "trace-selected",
              phase: "before_response",
              planKind: "memory_intent_plan",
              inputSummary: "selected input",
              outputSummary: "selected output",
              promptVersion: "memory-intent-plan-v1",
              schemaVersion: "memory-plan-schema-v1",
              degraded: false,
              degradationReason: null,
              resultState: "planned",
              durationMs: 3,
              createdAt: "2026-04-22T00:00:00Z"
            }
          ]
        }
      });

    const response = await getRunTrace({
      turnId: undefined,
      sessionId: undefined,
      traceId: "trace-selected",
      page: 1,
      pageSize: 20
    });

    expect(fetchRuntimeRunsMock).toHaveBeenNthCalledWith(1, "trace_id=trace-selected&page=1&page_size=20", { locale: "zh-CN" });
    expect(fetchRuntimeRunsMock).toHaveBeenNthCalledWith(2, "page=1&page_size=20", { locale: "zh-CN" });
    expect(fetchRuntimeRunsMock).toHaveBeenCalledTimes(2);
    expect(response.selectedTurn?.turn.traceId).toBe("trace-selected");
    expect(response.items.map((item) => item.traceId)).toEqual(["trace-newer", "trace-selected"]);
  });

  it("attributes skipped current-turn injection to resident session memory", async () => {
    fetchRuntimeRunsMock
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          turns: [
            {
              traceId: "trace-selected",
              turnId: "turn-selected",
              workspaceId: "workspace-1",
              taskId: null,
              sessionId: "session-1",
              threadId: null,
              host: "memory_native_agent",
              phase: "before_response",
              currentInput: "你是谁",
              assistantOutput: null,
              createdAt: "2026-04-28T02:52:12.000Z"
            }
          ],
          triggerRuns: [
            {
              traceId: "trace-selected",
              phase: "before_response",
              triggerHit: true,
              triggerType: "history_reference",
              triggerReason: "当前输入明确引用了历史上下文或既有偏好。",
              memoryMode: "workspace_plus_global",
              requestedTypes: ["preference"],
              requestedScopes: ["user", "session"],
              selectedScopes: [],
              scopeDecision: null,
              scopeLimit: ["user", "session"],
              importanceThreshold: 3,
              cooldownApplied: false,
              semanticScore: null,
              durationMs: 10,
              createdAt: "2026-04-28T02:52:02.000Z"
            }
          ],
          recallRuns: [
            {
              traceId: "trace-selected",
              phase: "before_response",
              triggerType: "history_reference",
              triggerHit: true,
              triggerReason: "reason",
              memoryMode: "workspace_plus_global",
              requestedTypes: ["preference"],
              requestedScopes: ["user", "session"],
              selectedScopes: [],
              scopeHitCounts: [{ scope: "user", count: 1 }],
              selectedRecordIds: [],
              queryScope: "scope=user,session",
              candidateCount: 1,
              selectedCount: 0,
              resultState: "empty",
              emptyReason: null,
              durationMs: 120,
              degraded: false,
              degradationReason: null,
              createdAt: "2026-04-28T02:52:11.000Z"
            }
          ],
          injectionRuns: [
            {
              traceId: "trace-selected",
              phase: "before_response",
              injected: false,
              injectedCount: 0,
              memoryMode: "workspace_plus_global",
              requestedScopes: ["user", "session"],
              selectedScopes: [],
              keptRecordIds: [],
              injectionReason: null,
              memorySummary: null,
              tokenEstimate: 0,
              trimmedRecordIds: [],
              trimReasons: [],
              resultState: "no_records",
              durationMs: 0,
              createdAt: "2026-04-28T02:52:11.000Z"
            }
          ],
          memoryPlanRuns: [
            {
              traceId: "trace-selected",
              phase: "before_response",
              planKind: "memory_injection_plan",
              inputSummary: "input=你是谁; candidate_count=1",
              outputSummary: "should_inject=false; reason=当前问题自包含，虽有称呼偏好但非回答所必需; candidate_count=1; summary=",
              promptVersion: "memory-recall-injection-v1",
              schemaVersion: "memory-plan-schema-v1",
              degraded: false,
              degradationReason: null,
              resultState: "skipped",
              durationMs: 20,
              createdAt: "2026-04-28T02:52:11.000Z"
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          turns: [
            {
              traceId: "trace-selected",
              turnId: "turn-selected",
              workspaceId: "workspace-1",
              taskId: null,
              sessionId: "session-1",
              threadId: null,
              host: "memory_native_agent",
              phase: "before_response",
              currentInput: "你是谁",
              assistantOutput: null,
              createdAt: "2026-04-28T02:52:12.000Z"
            },
            {
              traceId: "trace-session-start",
              turnId: null,
              workspaceId: "workspace-1",
              taskId: null,
              sessionId: "session-1",
              threadId: null,
              host: "memory_native_agent",
              phase: "session_start",
              currentInput: "session start",
              assistantOutput: null,
              createdAt: "2026-04-28T02:48:31.000Z"
            }
          ],
          injectionRuns: [
            {
              traceId: "trace-session-start",
              phase: "session_start",
              injected: true,
              injectedCount: 1,
              memoryMode: "workspace_plus_global",
              requestedScopes: ["workspace", "user"],
              selectedScopes: ["user"],
              keptRecordIds: [],
              injectionReason: null,
              memorySummary: null,
              tokenEstimate: 47,
              trimmedRecordIds: [],
              trimReasons: [],
              resultState: "injected",
              durationMs: 0,
              createdAt: "2026-04-28T02:48:41.000Z"
            }
          ]
        }
      });

    const response = await getRunTrace({
      turnId: undefined,
      sessionId: undefined,
      traceId: "trace-selected",
      page: 1,
      pageSize: 20
    });

    expect(response.selectedTurn?.narrative.outcomeCode).toBe("resident_memory_used");
    expect(response.selectedTurn?.narrative.outcomeLabel).toBe("常驻记忆已生效");
    expect(response.selectedTurn?.narrative.explanation).toContain("同一会话启动时已经注入 1 条常驻记忆");
    expect(response.selectedTurn?.narrative.explanation).toContain("当前回复仍会带着这部分记忆");
    expect(response.selectedTurn?.phaseNarratives.find((item) => item.title === "召回 / before_response")?.summary)
      .toContain("本轮再次命中 1 条候选");
    expect(response.selectedTurn?.phaseNarratives.find((item) => item.title === "注入 / before_response")?.summary)
      .toContain("本轮没有重复注入");
  });

  it("looks up resident session memory when the recent list does not include session start", async () => {
    fetchRuntimeRunsMock
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          turns: [
            {
              traceId: "trace-selected",
              turnId: "turn-selected",
              workspaceId: "workspace-1",
              taskId: null,
              sessionId: "session-1",
              threadId: null,
              host: "memory_native_agent",
              phase: "before_response",
              currentInput: "你是谁",
              assistantOutput: null,
              createdAt: "2026-04-28T02:52:12.000Z"
            }
          ],
          triggerRuns: [
            {
              traceId: "trace-selected",
              phase: "before_response",
              triggerHit: true,
              triggerType: "history_reference",
              triggerReason: "reason",
              memoryMode: "workspace_plus_global",
              requestedTypes: ["preference"],
              requestedScopes: ["user", "session"],
              selectedScopes: [],
              scopeDecision: null,
              scopeLimit: ["user", "session"],
              importanceThreshold: 3,
              cooldownApplied: false,
              semanticScore: null,
              durationMs: 10,
              createdAt: "2026-04-28T02:52:02.000Z"
            }
          ],
          recallRuns: [
            {
              traceId: "trace-selected",
              phase: "before_response",
              triggerType: "history_reference",
              triggerHit: true,
              triggerReason: "reason",
              memoryMode: "workspace_plus_global",
              requestedTypes: ["preference"],
              requestedScopes: ["user", "session"],
              selectedScopes: [],
              scopeHitCounts: [{ scope: "user", count: 1 }],
              selectedRecordIds: [],
              queryScope: "scope=user,session",
              candidateCount: 1,
              selectedCount: 0,
              resultState: "empty",
              emptyReason: null,
              durationMs: 120,
              degraded: false,
              degradationReason: null,
              createdAt: "2026-04-28T02:52:11.000Z"
            }
          ],
          injectionRuns: [],
          memoryPlanRuns: [
            {
              traceId: "trace-selected",
              phase: "before_response",
              planKind: "memory_injection_plan",
              inputSummary: "input=你是谁; candidate_count=1",
              outputSummary: "should_inject=false; reason=当前问题自包含，虽有称呼偏好但非回答所必需; candidate_count=1; summary=",
              promptVersion: "memory-recall-injection-v1",
              schemaVersion: "memory-plan-schema-v1",
              degraded: false,
              degradationReason: null,
              resultState: "skipped",
              durationMs: 20,
              createdAt: "2026-04-28T02:52:11.000Z"
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          turns: [
            {
              traceId: "trace-selected",
              turnId: "turn-selected",
              workspaceId: "workspace-1",
              taskId: null,
              sessionId: "session-1",
              threadId: null,
              host: "memory_native_agent",
              phase: "before_response",
              currentInput: "你是谁",
              assistantOutput: null,
              createdAt: "2026-04-28T02:52:12.000Z"
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        status: healthyStatus,
        data: {
          ...emptyRuntimeRuns,
          turns: [
            {
              traceId: "trace-session-start",
              turnId: null,
              workspaceId: "workspace-1",
              taskId: null,
              sessionId: "session-1",
              threadId: null,
              host: "memory_native_agent",
              phase: "session_start",
              currentInput: "session start",
              assistantOutput: null,
              createdAt: "2026-04-28T02:48:31.000Z"
            }
          ],
          injectionRuns: [
            {
              traceId: "trace-session-start",
              phase: "session_start",
              injected: true,
              injectedCount: 1,
              memoryMode: "workspace_plus_global",
              requestedScopes: ["workspace", "user"],
              selectedScopes: ["user"],
              keptRecordIds: [],
              injectionReason: null,
              memorySummary: null,
              tokenEstimate: 47,
              trimmedRecordIds: [],
              trimReasons: [],
              resultState: "injected",
              durationMs: 0,
              createdAt: "2026-04-28T02:48:41.000Z"
            }
          ]
        }
      });

    const response = await getRunTrace({
      turnId: undefined,
      sessionId: undefined,
      traceId: "trace-selected",
      page: 1,
      pageSize: 20
    });

    expect(fetchRuntimeRunsMock).toHaveBeenNthCalledWith(3, "session_id=session-1&page=1&page_size=100", { locale: "zh-CN" });
    expect(response.selectedTurn?.narrative.outcomeCode).toBe("resident_memory_used");
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

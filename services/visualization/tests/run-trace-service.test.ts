import { describe, expect, it } from "vitest";

import { buildNarrative, describeRunTraceEmptyState } from "@/features/run-trace/service";
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
    writeBackRuns: [],
    dependencyStatus: []
  };

  it("explains missing trigger", () => {
    const narrative = buildNarrative(baseDetail);

    expect(narrative.outcomeCode).toBe("no_trigger");
    expect(narrative.explanation).toContain("skipped retrieval");
  });

  it("explains empty recall", () => {
    const narrative = buildNarrative({
      ...baseDetail,
      triggerRuns: [
        {
          traceId: "trace-1",
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
        detail: "Timed out after 2000 ms."
      }
    } satisfies RunTraceResponse;

    const state = describeRunTraceEmptyState(response);
    expect(state.title).toContain("Runtime source unavailable");
  });
});

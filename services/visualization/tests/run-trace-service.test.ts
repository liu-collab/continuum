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
          requestedTypes: ["fact_preference"],
          scopeLimit: ["user"],
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
          requestedTypes: ["fact_preference"],
          queryScope: "scope=user",
          candidateCount: 0,
          selectedCount: 0,
          resultState: "empty",
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
          requestedTypes: ["fact_preference"],
          scopeLimit: ["user"],
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
          requestedTypes: ["fact_preference"],
          queryScope: "scope=user",
          candidateCount: 3,
          selectedCount: 2,
          resultState: "matched",
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
          resultState: "submitted",
          candidateCount: 1,
          submittedCount: 1,
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
        threadId: undefined,
        workspaceId: undefined,
        taskId: undefined,
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

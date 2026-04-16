import "server-only";

import { RunTraceFilters, RunTraceResponse } from "@/lib/contracts";
import { toRunTraceQuery } from "@/lib/query-params";
import {
  RuntimeDependencyRecord,
  RuntimeInjectionRecord,
  RuntimeObserveRunsSnapshot,
  RuntimeRecallRecord,
  RuntimeTriggerRecord,
  RuntimeTurnRecord,
  RuntimeWritebackRecord,
  fetchRuntimeRuns
} from "@/lib/server/runtime-observe-client";

type RunAggregate = {
  turn: RuntimeTurnRecord;
  turns: RuntimeTurnRecord[];
  triggerRuns: RuntimeTriggerRecord[];
  recallRuns: RuntimeRecallRecord[];
  injectionRuns: RuntimeInjectionRecord[];
  writeBackRuns: RuntimeWritebackRecord[];
  dependencyStatus: RuntimeDependencyRecord[];
};

function groupByTrace(data: RuntimeObserveRunsSnapshot) {
  const traceIds = new Set([
    ...data.turns.map((item) => item.traceId),
    ...data.triggerRuns.map((item) => item.traceId),
    ...data.recallRuns.map((item) => item.traceId),
    ...data.injectionRuns.map((item) => item.traceId),
    ...data.writeBackRuns.map((item) => item.traceId)
  ]);

  return Array.from(traceIds).map((traceId) => {
    const turns = data.turns.filter((item) => item.traceId === traceId);
    const turn = turns[0] ?? {
      traceId,
      turnId: null,
      workspaceId: null,
      userId: null,
      taskId: null,
      sessionId: null,
      threadId: null,
      host: null,
      phase: null,
      currentInput: null,
      assistantOutput: null,
      createdAt: null
    };

    return {
      turn,
      turns,
      triggerRuns: data.triggerRuns.filter((item) => item.traceId === traceId),
      recallRuns: data.recallRuns.filter((item) => item.traceId === traceId),
      injectionRuns: data.injectionRuns.filter((item) => item.traceId === traceId),
      writeBackRuns: data.writeBackRuns.filter((item) => item.traceId === traceId),
      dependencyStatus: data.dependencyStatus
    } satisfies RunAggregate;
  });
}

export function buildNarrative(detail: RunAggregate) {
  const triggerRun = detail.triggerRuns[0];
  const recallRun = detail.recallRuns[0];
  const injectionRun = detail.injectionRuns[0];
  const writeBackRun = detail.writeBackRuns[0];
  const incomplete =
    detail.triggerRuns.length === 0 ||
    detail.recallRuns.length === 0 ||
    detail.injectionRuns.length === 0 ||
    detail.writeBackRuns.length === 0;

  if (!triggerRun || !triggerRun.triggerHit) {
    return {
      outcomeCode: "no_trigger",
      outcomeLabel: "No trigger",
      explanation: "This turn did not hit a recall trigger, so the memory system skipped retrieval.",
      incomplete
    };
  }

  if (!recallRun || recallRun.resultState === "empty" || recallRun.selectedCount === 0) {
    return {
      outcomeCode: "empty_recall",
      outcomeLabel: "Empty recall",
      explanation:
        "A trigger fired, but the recall stage returned no eligible memory records for the requested types and scope.",
      incomplete
    };
  }

  if (
    injectionRun &&
    (injectionRun.resultState === "trimmed_to_zero" || injectionRun.trimmedRecordIds.length > 0) &&
    !injectionRun.injected
  ) {
    return {
      outcomeCode: "found_but_not_injected",
      outcomeLabel: "Found but not injected",
      explanation:
        "Relevant memories were found, but they were trimmed away before prompt injection due to the active token budget or trim rules.",
      incomplete
    };
  }

  if (injectionRun && injectionRun.trimmedRecordIds.length > 0) {
    return {
      outcomeCode: "injection_trimmed",
      outcomeLabel: "Injection trimmed",
      explanation:
        "Relevant memories were found and injected, but part of the candidate set was trimmed to fit the context budget.",
      incomplete
    };
  }

  if (writeBackRun?.resultState === "failed") {
    return {
      outcomeCode: "writeback_failed",
      outcomeLabel: "Write-back failed",
      explanation:
        "This turn produced write-back work, but submission or dependency handling failed before storage could accept it.",
      incomplete
    };
  }

  if (writeBackRun?.resultState === "no_candidates") {
    return {
      outcomeCode: "no_writeback",
      outcomeLabel: "No write-back candidate",
      explanation:
        "This turn completed recall and injection, but no candidate met the threshold for structured write-back.",
      incomplete
    };
  }

  if (recallRun.degraded || writeBackRun?.degraded) {
    return {
      outcomeCode: "dependency_unavailable",
      outcomeLabel: "Dependency degraded",
      explanation:
        "The runtime service completed this trace in degraded mode because one of its dependencies was unavailable or slow.",
      incomplete
    };
  }

  return {
    outcomeCode: "completed",
    outcomeLabel: "Trace completed",
    explanation:
      "This trace completed the turn, trigger, recall, injection, and write-back stages without a dominant anomaly.",
    incomplete
  };
}

function buildListItem(detail: RunAggregate) {
  const triggerRun = detail.triggerRuns[0];
  const recallRun = detail.recallRuns[0];
  const injectionRun = detail.injectionRuns[0];
  const writeBackRun = detail.writeBackRuns[0];

  return {
    turnId: detail.turn.turnId ?? detail.turn.traceId,
    phase: detail.turn.phase,
    createdAt: detail.turn.createdAt,
    triggerLabel: triggerRun?.triggerType
      ? `${triggerRun.triggerType}${triggerRun.triggerHit ? "" : " (miss)"}`
      : "No trigger record",
    recallOutcome:
      !recallRun
        ? "No recall record"
        : recallRun.resultState === "empty"
          ? "Triggered but empty"
          : `${recallRun.selectedCount} records selected`,
    injectedCount: injectionRun?.injectedCount ?? 0,
    writeBackStatus: writeBackRun?.resultState ?? "not_recorded",
    degraded: recallRun?.degraded ?? writeBackRun?.degraded ?? false,
    summary:
      detail.turn.currentInput ??
      detail.turn.assistantOutput ??
      "No input or output summary was captured for this turn."
  };
}

function toDependencyStatus(dependencies: RuntimeDependencyRecord[]) {
  const labelByName: Record<string, string> = {
    read_model: "Runtime read model",
    embeddings: "Runtime embeddings",
    storage_writeback: "Runtime storage writeback"
  };

  return dependencies.map((dependency) => ({
    name: dependency.name,
    label: labelByName[dependency.name] ?? dependency.name,
    status: dependency.status,
    detail: dependency.detail,
    checkedAt: dependency.checkedAt
  }));
}

export async function getRunTrace(filters: RunTraceFilters): Promise<RunTraceResponse> {
  const result = await fetchRuntimeRuns(toRunTraceQuery(filters));
  const grouped = groupByTrace(result.data).sort((left, right) =>
    (right.turn.createdAt ?? "").localeCompare(left.turn.createdAt ?? "")
  );

  const selected =
    filters.turnId
      ? grouped.find((item) => item.turn.turnId === filters.turnId) ??
        grouped.find((item) => item.turn.traceId === filters.turnId) ??
        null
      : grouped[0] ?? null;

  return {
    items: grouped.map((item) => buildListItem(item)),
    total: grouped.length,
    selectedTurn: selected
      ? {
          turn: {
            traceId: selected.turn.traceId,
            turnId: selected.turn.turnId ?? selected.turn.traceId,
            workspaceId: selected.turn.workspaceId,
            userId: selected.turn.userId,
            taskId: selected.turn.taskId,
            sessionId: selected.turn.sessionId,
            threadId: selected.turn.threadId,
            phase: selected.turn.phase,
            inputSummary: selected.turn.currentInput,
            assistantOutputSummary: selected.turn.assistantOutput,
            turnStatus: null,
            createdAt: selected.turn.createdAt,
            completedAt: null
          },
          turns: selected.turns.map((turn) => ({
            traceId: turn.traceId,
            turnId: turn.turnId ?? turn.traceId,
            workspaceId: turn.workspaceId,
            userId: turn.userId,
            taskId: turn.taskId,
            sessionId: turn.sessionId,
            threadId: turn.threadId,
            phase: turn.phase,
            inputSummary: turn.currentInput,
            assistantOutputSummary: turn.assistantOutput,
            turnStatus: null,
            createdAt: turn.createdAt,
            completedAt: null
          })),
          triggerRuns: selected.triggerRuns.map((run) => ({
            traceId: run.traceId,
            triggerHit: run.triggerHit,
            triggerType: run.triggerType,
            triggerReason: run.triggerReason,
            requestedTypes: run.requestedTypes,
            scopeLimit: run.scopeLimit,
            importanceThreshold: run.importanceThreshold,
            cooldownApplied: run.cooldownApplied,
            semanticScore: run.semanticScore,
            latencyMs: run.durationMs,
            createdAt: run.createdAt
          })),
          recallRuns: selected.recallRuns.map((run) => ({
            traceId: run.traceId,
            triggerType: run.triggerType,
            triggerHit: run.triggerHit,
            triggerReason: run.triggerReason,
            requestedTypes: run.requestedTypes,
            queryScope: run.queryScope,
            candidateCount: run.candidateCount,
            selectedCount: run.selectedCount,
            resultState: run.resultState,
            latencyMs: run.durationMs,
            degraded: run.degraded,
            degradationReason: run.degradationReason,
            createdAt: run.createdAt
          })),
          injectionRuns: selected.injectionRuns.map((run) => ({
            traceId: run.traceId,
            injected: run.injected,
            injectedCount: run.injectedCount,
            resultState: run.resultState,
            dropReasons: run.trimReasons,
            tokenEstimate: run.tokenEstimate,
            droppedRecordIds: run.trimmedRecordIds,
            latencyMs: run.durationMs,
            createdAt: run.createdAt
          })),
          writeBackRuns: selected.writeBackRuns.map((run) => ({
            traceId: run.traceId,
            resultState: run.resultState,
            candidateCount: run.candidateCount,
            submittedCount: run.submittedCount,
            filteredCount: run.filteredCount,
            filteredReasons: run.filteredReasons,
            degraded: run.degraded,
            degradationReason: run.degradationReason,
            latencyMs: run.durationMs,
            createdAt: run.createdAt
          })),
          dependencyStatus: toDependencyStatus(selected.dependencyStatus),
          narrative: buildNarrative(selected)
        }
      : null,
    appliedFilters: filters,
    sourceStatus: result.status
  };
}

export function describeRunTraceEmptyState(response: RunTraceResponse) {
  if (response.sourceStatus.status !== "healthy") {
    return {
      title: "Runtime source unavailable",
      description:
        response.sourceStatus.detail ??
        "The runtime observe API could not be queried, so trace data is temporarily unavailable."
    };
  }

  if (response.appliedFilters.turnId) {
    return {
      title: "No trace found for this turn",
      description:
        "The runtime observe API is reachable, but it did not return a trace for the requested turn id."
    };
  }

  return {
    title: "Enter a turn id to inspect a trace",
    description:
      "Recent traces can still be listed below, but the main trace view is keyed by turn id."
  };
}

import "server-only";

import { RunTraceFilters, RunTracePhaseNarrative, RunTraceResponse, Scope } from "@/lib/contracts";
import { formatSessionReference, formatSourceReference, memoryModeSummary, scopeExplanation, scopeLabel } from "@/lib/format";
import { createTranslator, joinLocalizedList, type AppLocale } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";
import { toRunTraceQuery } from "@/lib/query-params";
import {
  RuntimeDependencyRecord,
  RuntimeInjectionRecord,
  RuntimeMemoryPlanRecord,
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
  memoryPlanRuns: RuntimeMemoryPlanRecord[];
  writeBackRuns: RuntimeWritebackRecord[];
  dependencyStatus: RuntimeDependencyRecord[];
};

type PhaseAggregate = {
  phase: string;
  turn?: RuntimeTurnRecord;
  triggerRun?: RuntimeTriggerRecord;
  recallRun?: RuntimeRecallRecord;
  injectionRun?: RuntimeInjectionRecord;
  memoryPlanRuns: RuntimeMemoryPlanRecord[];
  writeBackRun?: RuntimeWritebackRecord;
};

type ResidentInjectionContext = {
  traceId: string;
  injectedCount: number;
  createdAt: string | null;
};

const phasePriority = ["before_response", "before_plan", "task_switch", "task_start", "session_start", "after_response"];

function uniqueScopes(scopes: Scope[]) {
  return Array.from(new Set(scopes));
}

function formatScopeList(scopes: Scope[], locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);

  if (scopes.length === 0) {
    return t("service.runs.scopesMissing");
  }

  return joinLocalizedList(locale, uniqueScopes(scopes).map((scope) => scopeLabel(scope, locale)));
}

function isResidentMemoryContinuation(run?: RuntimeRecallRecord, residentContext: ResidentInjectionContext | null = null) {
  return Boolean(residentContext && run && run.candidateCount > 0 && run.selectedCount === 0);
}

function summarizeRecall(
  run?: RuntimeRecallRecord,
  residentContext: ResidentInjectionContext | null = null,
  locale: AppLocale = "zh-CN"
) {
  const t = createTranslator(locale);

  if (!run) {
    return t("service.runs.recallMissing");
  }

  if (isResidentMemoryContinuation(run, residentContext)) {
    return t("service.runs.residentRecall", { candidateCount: run.candidateCount });
  }

  if (run.candidateCount > 0 && run.selectedCount === 0) {
    return t("service.runs.candidateNotInjected", { candidateCount: run.candidateCount });
  }

  if (run.resultState === "empty" || run.selectedCount === 0) {
    return run.emptyReason
      ? t("service.runs.triggeredEmptyWithReason", { reason: run.emptyReason })
      : t("service.runs.triggeredEmpty");
  }

  return t("service.runs.selectedRecords", {
    scopes: formatScopeList(run.selectedScopes, locale),
    count: run.selectedCount
  });
}

function summarizePlanRuns(runs: RuntimeMemoryPlanRecord[], locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);

  if (runs.length === 0) {
    return t("service.runs.planMissing");
  }

  return t("service.runs.planSummary", {
    count: runs.length,
    kinds: joinLocalizedList(locale, runs.map((run) => run.planKind))
  });
}

function summarizeScopes(detail: RunAggregate, locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);
  const primary = pickPrimaryPhase(detail);
  const triggerRun = primary?.triggerRun;
  const recallRun = primary?.recallRun;
  const injectionRun = primary?.injectionRun;

  const requested = triggerRun?.requestedScopes ?? recallRun?.requestedScopes ?? [];
  const selected = injectionRun?.selectedScopes ?? recallRun?.selectedScopes ?? [];

  if (requested.length === 0 && selected.length === 0) {
    return t("service.runs.scopeDecisionMissing");
  }

  return t("service.runs.scopeDecisionSummary", {
    requested: formatScopeList(requested, locale),
    selected: formatScopeList(selected, locale)
  });
}

function findInjectionSkipReason(detail: RunAggregate) {
  const outputSummary = detail.memoryPlanRuns.find(
    (run) => run.planKind === "memory_injection_plan" && run.outputSummary?.includes("should_inject=false")
  )?.outputSummary;

  if (!outputSummary) {
    return null;
  }

  const reason = outputSummary.match(/(?:^|;\s*)reason=([^;]+)/)?.[1]?.trim();
  return reason && reason.length > 0 ? reason : null;
}

function findResidentInjectionContext(detail: RunAggregate, candidates: RunAggregate[]) {
  const sessionId = detail.turn.sessionId;
  if (!sessionId) {
    return null;
  }

  const selectedCreatedAt = detail.turn.createdAt;
  const residentInjections = candidates.flatMap((candidate) => {
    if (candidate.turn.traceId === detail.turn.traceId || candidate.turn.sessionId !== sessionId) {
      return [];
    }

    return candidate.injectionRuns
      .filter((run) => run.phase === "session_start" && run.injected)
      .map((run) => ({
        traceId: candidate.turn.traceId,
        injectedCount: run.injectedCount,
        createdAt: run.createdAt
      }));
  });

  return residentInjections
    .filter((item) => !selectedCreatedAt || !item.createdAt || item.createdAt <= selectedCreatedAt)
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0] ?? null;
}

async function resolveResidentInjectionContext(
  detail: RunAggregate,
  candidates: RunAggregate[],
  filters: RunTraceFilters,
  locale: AppLocale
) {
  const existing = findResidentInjectionContext(detail, candidates);
  if (existing || !detail.turn.sessionId) {
    return existing;
  }

  const sessionResult = await fetchRuntimeRuns(toRunTraceQuery({
    ...filters,
    turnId: undefined,
    traceId: undefined,
    sessionId: detail.turn.sessionId,
    page: 1,
    pageSize: 100
  }), { locale });
  const sessionGrouped = groupByTrace(sessionResult.data);
  return findResidentInjectionContext(detail, sessionGrouped);
}

function groupByPhase(detail: RunAggregate): PhaseAggregate[] {
  const phases = new Set(
    [
      ...detail.turns.map((item) => item.phase),
      ...detail.triggerRuns.map((item) => item.phase),
      ...detail.recallRuns.map((item) => item.phase),
      ...detail.injectionRuns.map((item) => item.phase),
      ...detail.memoryPlanRuns.map((item) => item.phase),
      ...detail.writeBackRuns.map((item) => item.phase)
    ].filter((item): item is string => Boolean(item))
  );

  return Array.from(phases)
    .map((phase) => ({
      phase,
      turn: detail.turns.find((item) => item.phase === phase),
      triggerRun: detail.triggerRuns.find((item) => item.phase === phase),
      recallRun: detail.recallRuns.find((item) => item.phase === phase),
      injectionRun: detail.injectionRuns.find((item) => item.phase === phase),
      memoryPlanRuns: detail.memoryPlanRuns.filter((item) => item.phase === phase),
      writeBackRun: detail.writeBackRuns.find((item) => item.phase === phase)
    }))
    .sort((left, right) => {
      const leftIndex = phasePriority.indexOf(left.phase);
      const rightIndex = phasePriority.indexOf(right.phase);
      if (leftIndex === -1 && rightIndex === -1) {
        return right.phase.localeCompare(left.phase);
      }
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    });
}

function pickPrimaryPhase(detail: RunAggregate) {
  return groupByPhase(detail)[0];
}

function groupByTrace(data: RuntimeObserveRunsSnapshot) {
  const traceIds = new Set([
    ...data.turns.map((item) => item.traceId),
    ...data.triggerRuns.map((item) => item.traceId),
    ...data.recallRuns.map((item) => item.traceId),
    ...data.injectionRuns.map((item) => item.traceId),
    ...data.memoryPlanRuns.map((item) => item.traceId),
    ...data.writeBackRuns.map((item) => item.traceId)
  ]);

  return Array.from(traceIds).map((traceId) => {
    const turns = data.turns.filter((item) => item.traceId === traceId);
    const planRuns = data.memoryPlanRuns.filter((item) => item.traceId === traceId);
    const turn = turns[0] ?? {
      traceId,
      turnId: traceId,
      workspaceId: null,
      taskId: null,
      sessionId: null,
      threadId: null,
      host: "retrieval-runtime",
      phase: planRuns[0]?.phase ?? null,
      currentInput: planRuns[0]?.inputSummary ?? null,
      assistantOutput: planRuns[0]?.outputSummary ?? null,
      createdAt: planRuns[0]?.createdAt ?? null
    };

    return {
      turn,
      turns,
      triggerRuns: data.triggerRuns.filter((item) => item.traceId === traceId),
      recallRuns: data.recallRuns.filter((item) => item.traceId === traceId),
      injectionRuns: data.injectionRuns.filter((item) => item.traceId === traceId),
      memoryPlanRuns: planRuns,
      writeBackRuns: data.writeBackRuns.filter((item) => item.traceId === traceId),
      dependencyStatus: data.dependencyStatus
    } satisfies RunAggregate;
  });
}

export function buildNarrative(
  detail: RunAggregate,
  residentContext: ResidentInjectionContext | null = null,
  locale: AppLocale = "zh-CN"
) {
  const t = createTranslator(locale);
  const primary = pickPrimaryPhase(detail);
  const triggerRun = primary?.triggerRun;
  const recallRun = primary?.recallRun;
  const injectionRun = primary?.injectionRun;
  const writeBackRun = primary?.writeBackRun;
  const hasPlanOnlyTrace =
    detail.memoryPlanRuns.length > 0 &&
    detail.triggerRuns.length === 0 &&
    detail.recallRuns.length === 0 &&
    detail.injectionRuns.length === 0 &&
    detail.writeBackRuns.length === 0;
  const incomplete =
    detail.triggerRuns.length === 0 ||
    detail.recallRuns.length === 0 ||
    detail.injectionRuns.length === 0 ||
    detail.writeBackRuns.length === 0;

  if (hasPlanOnlyTrace) {
    return {
      outcomeCode: "plan_only",
      outcomeLabel: t("service.runs.planOnlyLabel"),
      explanation: t("service.runs.planOnlyExplanation"),
      incomplete: false
    };
  }

  if (!triggerRun || !triggerRun.triggerHit) {
    return {
      outcomeCode: "no_trigger",
      outcomeLabel: t("service.runs.noTriggerLabel"),
      explanation: t("service.runs.noTriggerExplanation"),
      incomplete
    };
  }

  if (recallRun && recallRun.candidateCount > 0 && recallRun.selectedCount === 0) {
    const skipReason = findInjectionSkipReason(detail);

    if (residentContext) {
      return {
        outcomeCode: "resident_memory_used",
        outcomeLabel: t("service.runs.residentMemoryLabel"),
        explanation: skipReason
          ? t("service.runs.residentMemoryExplanationWithReason", {
              candidateCount: recallRun.candidateCount,
              injectedCount: residentContext.injectedCount,
              reason: skipReason
            })
          : t("service.runs.residentMemoryExplanation", {
              candidateCount: recallRun.candidateCount,
              injectedCount: residentContext.injectedCount
            }),
        incomplete
      };
    }

    return {
      outcomeCode: "candidate_not_selected",
      outcomeLabel: t("service.runs.candidateNotSelectedLabel"),
      explanation: skipReason
        ? t("service.runs.candidateNotSelectedWithReason", {
            candidateCount: recallRun.candidateCount,
            reason: skipReason
          })
        : t("service.runs.candidateNotSelected", { candidateCount: recallRun.candidateCount }),
      incomplete
    };
  }

  if (!recallRun || recallRun.resultState === "empty" || recallRun.selectedCount === 0) {
    return {
      outcomeCode: "empty_recall",
      outcomeLabel: t("service.runs.emptyRecallLabel"),
      explanation: t("service.runs.emptyRecallExplanation"),
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
      outcomeLabel: t("service.runs.foundNotInjectedLabel"),
      explanation: t("service.runs.foundNotInjectedExplanation"),
      incomplete
    };
  }

  if (injectionRun && injectionRun.trimmedRecordIds.length > 0) {
    return {
      outcomeCode: "injection_trimmed",
      outcomeLabel: t("service.runs.injectionTrimmedLabel"),
      explanation: t("service.runs.injectionTrimmedExplanation"),
      incomplete
    };
  }

  if (writeBackRun?.resultState === "failed") {
    return {
      outcomeCode: "writeback_failed",
      outcomeLabel: t("service.runs.writebackFailedLabel"),
      explanation: t("service.runs.writebackFailedExplanation"),
      incomplete
    };
  }

  if (writeBackRun?.resultState === "no_candidates") {
    return {
      outcomeCode: "no_writeback",
      outcomeLabel: t("service.runs.noWritebackLabel"),
      explanation: t("service.runs.noWritebackExplanation"),
      incomplete
    };
  }

  if (recallRun?.degraded || writeBackRun?.degraded) {
    return {
      outcomeCode: "dependency_unavailable",
      outcomeLabel: t("service.runs.dependencyUnavailableLabel"),
      explanation: t("service.runs.dependencyUnavailableExplanation"),
      incomplete
    };
  }

  return {
    outcomeCode: "completed",
    outcomeLabel: t("service.runs.completedLabel"),
    explanation: t("service.runs.completedExplanation"),
    incomplete
  };
}

function buildPhaseNarratives(
  detail: RunAggregate,
  residentContext: ResidentInjectionContext | null = null,
  locale: AppLocale = "zh-CN"
): RunTracePhaseNarrative[] {
  const t = createTranslator(locale);
  const phases = groupByPhase(detail);

  return phases.flatMap((phase) => {
    const turn = phase.turn ?? detail.turn;
    const residentContinuation = isResidentMemoryContinuation(phase.recallRun, residentContext);
    return [
      {
        key: "turn" as const,
        title: t("service.runs.turnTitle", { phase: phase.phase }),
        summary: t("service.runs.turnSummary", {
          turn: formatSourceReference(turn.turnId ?? turn.traceId, locale),
          phase: phase.phase
        }),
        details: [
          formatSessionReference(turn.sessionId, locale),
          t("service.runs.currentInput", { value: turn.currentInput ?? t("common.notRecorded") }),
          t("service.runs.assistantOutput", { value: turn.assistantOutput ?? t("common.notRecorded") })
        ]
      },
      {
        key: "trigger" as const,
        title: t("service.runs.triggerPhaseTitle", { phase: phase.phase }),
        summary: phase.triggerRun?.triggerHit
          ? t("service.runs.triggerHitSummary", {
              mode: memoryModeSummary(phase.triggerRun.memoryMode, locale),
              reason: phase.triggerRun.triggerReason ?? t("service.runs.defaultTriggerReason")
            })
          : t("service.runs.triggerMissSummary", {
              reason: phase.triggerRun?.triggerReason ?? t("service.runs.triggerReasonMissing")
            }),
        details: [
          t("service.runs.requestedScopes", { scopes: formatScopeList(phase.triggerRun?.requestedScopes ?? [], locale) }),
          t("service.runs.selectedScopes", { scopes: formatScopeList(phase.triggerRun?.selectedScopes ?? [], locale) }),
          phase.triggerRun?.scopeDecision ?? t("service.runs.scopeDecisionMissing")
        ]
      },
      {
        key: "recall" as const,
        title: t("service.runs.recallPhaseTitle", { phase: phase.phase }),
        summary: summarizeRecall(phase.recallRun, residentContext, locale),
        details: [
          t("service.runs.memoryMode", { mode: memoryModeSummary(phase.recallRun?.memoryMode, locale) }),
          t("service.runs.requestedScopes", { scopes: formatScopeList(phase.recallRun?.requestedScopes ?? [], locale) }),
          t("service.runs.selectedScopes", { scopes: formatScopeList(phase.recallRun?.selectedScopes ?? [], locale) }),
          ...(phase.recallRun?.scopeHitCounts.map(
            (item) => t("service.runs.hitScope", { scope: scopeLabel(item.scope, locale), count: item.count })
          ) ?? []),
          phase.recallRun?.emptyReason ?? t("service.runs.emptyRecallReasonMissing")
        ]
      },
      {
        key: "injection" as const,
        title: t("service.runs.injectionPhaseTitle", { phase: phase.phase }),
        summary: residentContinuation
          ? t("service.runs.injectionResidentSummary", { count: residentContext?.injectedCount ?? 0 })
          : phase.injectionRun?.injected
            ? phase.injectionRun.memorySummary ?? t("service.runs.injectionDone")
            : phase.injectionRun?.resultState ?? t("service.runs.injectionMissing"),
        details: [
          t("service.runs.selectedScopes", { scopes: formatScopeList(phase.injectionRun?.selectedScopes ?? [], locale) }),
          t("service.runs.keptRecords", { records: phase.injectionRun?.keptRecordIds.join(", ") || t("common.notRecorded") }),
          t("service.runs.trimmedRecords", { records: phase.injectionRun?.trimmedRecordIds.join(", ") || t("common.notRecorded") }),
          t("service.runs.trimReasons", { reasons: phase.injectionRun?.trimReasons.join(", ") || t("common.notRecorded") })
        ]
      },
      {
        key: "plan" as const,
        title: t("service.runs.planPhaseTitle", { phase: phase.phase }),
        summary: summarizePlanRuns(phase.memoryPlanRuns, locale),
        details: phase.memoryPlanRuns.flatMap((run) => [
          t("service.runs.planRunSummary", {
            kind: run.planKind,
            state: run.resultState,
            degraded: run.degraded ? t("service.runs.degradedMark") : ""
          }),
          t("service.runs.inputSummary", { value: run.inputSummary ?? t("common.notRecorded") }),
          t("service.runs.outputSummary", { value: run.outputSummary ?? t("common.notRecorded") }),
          t("service.runs.version", {
            prompt: run.promptVersion ?? t("common.notRecorded"),
            schema: run.schemaVersion ?? t("common.notRecorded")
          })
        ])
      },
      {
        key: "writeback" as const,
        title: t("service.runs.writebackPhaseTitle", { phase: phase.phase }),
        summary: phase.writeBackRun
          ? t("service.runs.writebackSummary", {
              state: phase.writeBackRun.resultState,
              mode: memoryModeSummary(phase.writeBackRun.memoryMode, locale)
            })
          : t("service.runs.writebackMissing"),
        details: [
          t("service.runs.submittedJobs", { jobs: phase.writeBackRun?.submittedJobIds.join(", ") || t("common.notRecorded") }),
          t("service.runs.candidateSummaries", { summaries: phase.writeBackRun?.candidateSummaries.join(" | ") || t("common.notRecorded") }),
          ...(phase.writeBackRun?.scopeDecisions.map(
            (item) => t("service.runs.scopeDecisionItem", {
              scope: scopeLabel(item.scope, locale),
              count: item.count,
              reason: item.reason
            })
          ) ?? []),
          t("service.runs.filteredReasons", { reasons: phase.writeBackRun?.filteredReasons.join(", ") || t("common.notRecorded") })
        ]
      }
    ];
  });
}

function buildListItem(detail: RunAggregate, locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);
  const primary = pickPrimaryPhase(detail);
  const triggerRun = primary?.triggerRun;
  const recallRun = primary?.recallRun;
  const injectionRun = primary?.injectionRun;
  const writeBackRun = primary?.writeBackRun;
  const turn = primary?.turn ?? detail.turn;

  return {
    turnId: turn.turnId ?? detail.turn.traceId,
    traceId: detail.turn.traceId,
    phase: primary?.phase ?? turn.phase,
    createdAt: turn.createdAt,
    memoryMode:
      triggerRun?.memoryMode ??
      recallRun?.memoryMode ??
      injectionRun?.memoryMode ??
      writeBackRun?.memoryMode ??
      null,
    scopeSummary: summarizeScopes(detail, locale),
    triggerLabel: triggerRun?.triggerType
      ? `${triggerRun.triggerType}${triggerRun.triggerHit ? "" : ` (${t("service.runs.triggerMissMark")})`}`
      : t("service.runs.triggerMissing"),
    recallOutcome: summarizeRecall(recallRun, null, locale),
    injectedCount: injectionRun?.injectedCount ?? 0,
    writeBackStatus: writeBackRun?.resultState ?? "not_recorded",
    degraded: recallRun?.degraded ?? writeBackRun?.degraded ?? false,
    summary:
      turn.currentInput ??
      turn.assistantOutput ??
      t("service.runs.noSummary")
  };
}

function toDependencyStatus(dependencies: RuntimeDependencyRecord[], locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);
  const labelByName: Record<string, string> = {
    read_model: t("service.runs.dependencyReadModel"),
    embeddings: t("service.runs.dependencyEmbeddings"),
    storage_writeback: t("service.runs.dependencyStorageWriteback"),
    memory_llm: t("service.runs.dependencyMemoryLlm")
  };

  return dependencies.map((dependency) => ({
    name: dependency.name,
    label: labelByName[dependency.name] ?? dependency.name,
    status: dependency.status,
    detail: dependency.detail,
    checkedAt: dependency.checkedAt
  }));
}

function hasRunRecords(data: RuntimeObserveRunsSnapshot) {
  return (
    data.turns.length > 0 ||
    data.triggerRuns.length > 0 ||
    data.recallRuns.length > 0 ||
    data.injectionRuns.length > 0 ||
    data.memoryPlanRuns.length > 0 ||
    data.writeBackRuns.length > 0
  );
}

export async function getRunTrace(filters: RunTraceFilters): Promise<RunTraceResponse> {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const hasSelectionFilter = Boolean(filters.turnId || filters.traceId);
  const listFilters = hasSelectionFilter
    ? {
        ...filters,
        turnId: undefined,
        traceId: undefined
      }
    : filters;

  let result = await fetchRuntimeRuns(toRunTraceQuery(filters), { locale });
  let selectionFilters = filters;

  if (filters.turnId && !filters.traceId && !hasRunRecords(result.data)) {
    const fallbackFilters = {
      ...filters,
      turnId: undefined,
      traceId: filters.turnId
    };
    const fallbackResult = await fetchRuntimeRuns(toRunTraceQuery(fallbackFilters), { locale });
    if (hasRunRecords(fallbackResult.data)) {
      result = fallbackResult;
      selectionFilters = fallbackFilters;
    }
  }

  const listResult = hasSelectionFilter ? await fetchRuntimeRuns(toRunTraceQuery(listFilters), { locale }) : result;
  const listGrouped = groupByTrace(listResult.data).sort((left, right) =>
    (right.turn.createdAt ?? "").localeCompare(left.turn.createdAt ?? "")
  );
  const grouped = groupByTrace(result.data).sort((left, right) =>
    (right.turn.createdAt ?? "").localeCompare(left.turn.createdAt ?? "")
  );

  const selected =
    selectionFilters.turnId
      ? grouped.find((item) => item.turn.turnId === selectionFilters.turnId) ?? null
      : selectionFilters.traceId
        ? grouped.find((item) => item.turn.traceId === selectionFilters.traceId) ?? null
        : grouped[0] ?? null;
  const residentContext = selected
    ? await resolveResidentInjectionContext(selected, listGrouped, filters, locale)
    : null;

  return {
    items: listGrouped.map((item) => buildListItem(item, locale)),
    total: listGrouped.length,
    selectedTurn: selected
      ? {
          turn: {
            traceId: selected.turn.traceId,
            turnId: selected.turn.turnId ?? selected.turn.traceId,
            workspaceId: selected.turn.workspaceId,
            taskId: selected.turn.taskId,
            sessionId: selected.turn.sessionId,
            threadId: selected.turn.threadId,
            host: selected.turn.host,
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
            taskId: turn.taskId,
            sessionId: turn.sessionId,
            threadId: turn.threadId,
            host: turn.host,
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
            memoryMode: run.memoryMode,
            requestedTypes: run.requestedTypes,
            requestedScopes: run.requestedScopes,
            selectedScopes: run.selectedScopes,
            scopeDecision:
              run.scopeDecision ??
              (run.selectedScopes.length > 0
                ? t("service.runs.scopeSelected", { scopes: formatScopeList(run.selectedScopes, locale) })
                : t("service.runs.scopeDecisionMissing")),
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
            memoryMode: run.memoryMode,
            requestedTypes: run.requestedTypes,
            requestedScopes: run.requestedScopes,
            selectedScopes: run.selectedScopes,
            scopeHitCounts: run.scopeHitCounts.map((item) => ({
              scope: item.scope,
              scopeLabel: scopeLabel(item.scope, locale),
              count: item.count
            })),
            selectedRecordIds: run.selectedRecordIds,
            queryScope: run.queryScope,
            candidateCount: run.candidateCount,
            selectedCount: run.selectedCount,
            resultState: run.resultState,
            emptyReason: run.emptyReason,
            latencyMs: run.durationMs,
            degraded: run.degraded,
            degradationReason: run.degradationReason,
            createdAt: run.createdAt
          })),
          injectionRuns: selected.injectionRuns.map((run) => ({
            traceId: run.traceId,
            injected: run.injected,
            injectedCount: run.injectedCount,
            memoryMode: run.memoryMode,
            requestedScopes: run.requestedScopes,
            selectedScopes: run.selectedScopes,
            keptRecordIds: run.keptRecordIds,
            injectionReason: run.injectionReason,
            memorySummary: run.memorySummary,
            resultState: run.resultState,
            dropReasons: run.trimReasons,
            tokenEstimate: run.tokenEstimate,
            droppedRecordIds: run.trimmedRecordIds,
            latencyMs: run.durationMs,
            createdAt: run.createdAt
          })),
          memoryPlanRuns: selected.memoryPlanRuns.map((run) => ({
            traceId: run.traceId,
            phase: run.phase,
            planKind: run.planKind,
            inputSummary: run.inputSummary,
            outputSummary: run.outputSummary,
            promptVersion: run.promptVersion,
            schemaVersion: run.schemaVersion,
            degraded: run.degraded,
            degradationReason: run.degradationReason,
            resultState: run.resultState,
            latencyMs: run.durationMs,
            createdAt: run.createdAt
          })),
          writeBackRuns: selected.writeBackRuns.map((run) => ({
            traceId: run.traceId,
            memoryMode: run.memoryMode,
            resultState: run.resultState,
            candidateCount: run.candidateCount,
            submittedCount: run.submittedCount,
            submittedJobIds: run.submittedJobIds,
            candidateSummaries: run.candidateSummaries,
            scopeDecisions: run.scopeDecisions.map((item) => ({
              scope: item.scope,
              scopeLabel: scopeLabel(item.scope, locale),
              count: item.count,
              reason: item.reason
            })),
            filteredCount: run.filteredCount,
            filteredReasons: run.filteredReasons,
            degraded: run.degraded,
            degradationReason: run.degradationReason,
            latencyMs: run.durationMs,
            createdAt: run.createdAt
          })),
          dependencyStatus: toDependencyStatus(selected.dependencyStatus, locale),
          phaseNarratives: buildPhaseNarratives(selected, residentContext, locale),
          narrative: buildNarrative(selected, residentContext, locale)
        }
      : null,
    appliedFilters: filters,
    sourceStatus: result.status
  };
}

export function describeRunTraceEmptyState(response: RunTraceResponse, locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);

  if (response.sourceStatus.status !== "healthy") {
    return {
      title: t("service.runs.sourceUnavailableTitle"),
      description:
        response.sourceStatus.detail ??
        t("service.runs.sourceUnavailableDescription")
    };
  }

  if (response.appliedFilters.turnId || response.appliedFilters.traceId) {
    return {
      title: t("service.runs.emptySelectionTitle"),
      description:
        t("service.runs.emptySelectionDescription")
    };
  }

  return {
    title: t("service.runs.emptyPromptTitle"),
    description:
      t("service.runs.emptyPromptDescription")
  };
}

export { summarizeScopes, buildPhaseNarratives, formatScopeList, scopeExplanation };

import type { RunTracePhaseNarrative } from "@/lib/contracts";
import { formatSessionReference, formatSourceReference, memoryModeSummary, scopeLabel } from "@/lib/format";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";

import { formatScopeList, groupByPhase, pickPrimaryPhase } from "./context-resolver";
import type { ResidentInjectionContext, RunAggregate } from "./types";

function isResidentMemoryContinuation(run?: RunAggregate["recallRuns"][number], residentContext: ResidentInjectionContext | null = null) {
  return Boolean(residentContext && run && run.candidateCount > 0 && run.selectedCount === 0);
}

export function summarizeRecall(
  run?: RunAggregate["recallRuns"][number],
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

function summarizePlanRuns(runs: RunAggregate["memoryPlanRuns"], locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);

  if (runs.length === 0) {
    return t("service.runs.planMissing");
  }

  return t("service.runs.planSummary", {
    count: runs.length,
    kinds: runs.map((run) => run.planKind).join(locale === "zh-CN" ? "、" : ", ")
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

export function buildPhaseNarratives(
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

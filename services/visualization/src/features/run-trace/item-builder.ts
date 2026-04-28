import { memoryModeSummary } from "@/lib/format";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";

import { formatScopeList, pickPrimaryPhase } from "./context-resolver";
import { summarizeRecall } from "./phase-narrator";
import type { RunAggregate } from "./types";

export function summarizeScopes(detail: RunAggregate, locale: AppLocale = "zh-CN") {
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

export function buildListItem(detail: RunAggregate, locale: AppLocale = "zh-CN") {
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

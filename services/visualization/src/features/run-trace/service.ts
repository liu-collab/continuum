import "server-only";

import type { RunTraceFilters, RunTraceResponse } from "@/lib/contracts";
import { scopeExplanation, scopeLabel } from "@/lib/format";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";
import { toRunTraceQuery } from "@/lib/query-params";
import { fetchRuntimeRuns } from "@/lib/server/runtime-observe-client";

import {
  formatScopeList,
  groupByTrace,
  hasRunRecords,
  resolveResidentInjectionContext,
  toDependencyStatus
} from "./context-resolver";
import { buildListItem, summarizeScopes } from "./item-builder";
import { buildNarrative, buildPhaseNarratives } from "./phase-narrator";

export { formatScopeList } from "./context-resolver";
export { summarizeScopes } from "./item-builder";
export { buildNarrative, buildPhaseNarratives } from "./phase-narrator";
export { scopeExplanation };

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
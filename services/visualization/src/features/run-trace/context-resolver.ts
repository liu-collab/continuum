import type { Scope } from "@/lib/contracts";
import { scopeLabel } from "@/lib/format";
import { createTranslator, joinLocalizedList, type AppLocale } from "@/lib/i18n/messages";
import { toRunTraceQuery } from "@/lib/query-params";
import { fetchRuntimeRuns, type RuntimeDependencyRecord, type RuntimeObserveRunsSnapshot } from "@/lib/server/runtime-observe-client";
import type { RunTraceFilters } from "@/lib/contracts";

import type { PhaseAggregate, ResidentInjectionContext, RunAggregate } from "./types";

const phasePriority = ["before_response", "before_plan", "task_switch", "task_start", "session_start", "after_response"];

function uniqueScopes(scopes: Scope[]) {
  return Array.from(new Set(scopes));
}

export function formatScopeList(scopes: Scope[], locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);

  if (scopes.length === 0) {
    return t("service.runs.scopesMissing");
  }

  return joinLocalizedList(locale, uniqueScopes(scopes).map((scope) => scopeLabel(scope, locale)));
}

export function groupByPhase(detail: RunAggregate): PhaseAggregate[] {
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

export function pickPrimaryPhase(detail: RunAggregate) {
  return groupByPhase(detail)[0];
}

export function groupByTrace(data: RuntimeObserveRunsSnapshot) {
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

export async function resolveResidentInjectionContext(
  detail: RunAggregate,
  candidates: RunAggregate[],
  filters: RunTraceFilters,
  locale: AppLocale
): Promise<ResidentInjectionContext | null> {
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

export function toDependencyStatus(dependencies: RuntimeDependencyRecord[], locale: AppLocale = "zh-CN") {
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

export function hasRunRecords(data: RuntimeObserveRunsSnapshot) {
  return (
    data.turns.length > 0 ||
    data.triggerRuns.length > 0 ||
    data.recallRuns.length > 0 ||
    data.injectionRuns.length > 0 ||
    data.memoryPlanRuns.length > 0 ||
    data.writeBackRuns.length > 0
  );
}

import "server-only";

import { RunTraceFilters, RunTracePhaseNarrative, RunTraceResponse, Scope } from "@/lib/contracts";
import { formatSessionReference, formatSourceReference, memoryModeSummary, scopeExplanation, scopeLabel } from "@/lib/format";
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

const phasePriority = ["before_response", "before_plan", "task_switch", "task_start", "session_start", "after_response"];

function uniqueScopes(scopes: Scope[]) {
  return Array.from(new Set(scopes));
}

function formatScopeList(scopes: Scope[]) {
  if (scopes.length === 0) {
    return "未记录";
  }

  return uniqueScopes(scopes)
    .map((scope) => scopeLabel(scope))
    .join(", ");
}

function summarizeRecall(run?: RuntimeRecallRecord) {
  if (!run) {
    return "未记录召回阶段";
  }

  if (run.resultState === "empty" || run.selectedCount === 0) {
    return run.emptyReason ? `已触发但为空：${run.emptyReason}` : "已触发但为空";
  }

  return `从 ${formatScopeList(run.selectedScopes)} 中选中了 ${run.selectedCount} 条记录`;
}

function summarizePlanRuns(runs: RuntimeMemoryPlanRecord[]) {
  if (runs.length === 0) {
    return "未记录 plan 级事件。";
  }

  return `记录了 ${runs.length} 条 plan 级事件：${runs.map((run) => run.planKind).join("、")}。`;
}

function summarizeScopes(detail: RunAggregate) {
  const primary = pickPrimaryPhase(detail);
  const triggerRun = primary?.triggerRun;
  const recallRun = primary?.recallRun;
  const injectionRun = primary?.injectionRun;

  const requested = triggerRun?.requestedScopes ?? recallRun?.requestedScopes ?? [];
  const selected = injectionRun?.selectedScopes ?? recallRun?.selectedScopes ?? [];

  if (requested.length === 0 && selected.length === 0) {
    return "未记录作用域决策";
  }

  return `请求作用域：${formatScopeList(requested)}；最终选择：${formatScopeList(selected)}。`;
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

export function buildNarrative(detail: RunAggregate) {
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
      outcomeLabel: "仅计划轨迹",
      explanation: "这条轨迹主要记录了 plan 级观测事件，用来调试治理或编排决策。",
      incomplete: false
    };
  }

  if (!triggerRun || !triggerRun.triggerHit) {
    return {
      outcomeCode: "no_trigger",
      outcomeLabel: "未触发",
      explanation: "这一轮没有命中召回触发条件，所以记忆系统跳过了检索。",
      incomplete
    };
  }

  if (!recallRun || recallRun.resultState === "empty" || recallRun.selectedCount === 0) {
    return {
      outcomeCode: "empty_recall",
      outcomeLabel: "空召回",
      explanation:
        "虽然已经触发召回，但在请求的作用域和记忆类型下，没有找到可用的记忆记录。",
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
      outcomeLabel: "找到了但未注入",
      explanation:
        "虽然找到了相关记忆，但在提示词注入前被预算或裁剪规则全部裁掉了。",
      incomplete
    };
  }

  if (injectionRun && injectionRun.trimmedRecordIds.length > 0) {
    return {
      outcomeCode: "injection_trimmed",
      outcomeLabel: "注入被裁剪",
      explanation:
        "相关记忆已经找到并部分注入，但候选集里有一部分在最终注入前被裁剪掉了。",
      incomplete
    };
  }

  if (writeBackRun?.resultState === "failed") {
    return {
      outcomeCode: "writeback_failed",
      outcomeLabel: "写回失败",
      explanation:
        "这一轮生成了写回内容，但在存储真正接收之前，提交或依赖处理失败了。",
      incomplete
    };
  }

  if (writeBackRun?.resultState === "no_candidates") {
    return {
      outcomeCode: "no_writeback",
      outcomeLabel: "没有写回候选",
      explanation:
        "这一轮已经完成召回和注入，但没有候选内容达到结构化写回阈值。",
      incomplete
    };
  }

  if (recallRun?.degraded || writeBackRun?.degraded) {
    return {
      outcomeCode: "dependency_unavailable",
      outcomeLabel: "依赖降级",
      explanation:
        "运行时以降级模式完成了这条轨迹，因为至少有一个依赖不可用或过慢。",
      incomplete
    };
  }

  return {
    outcomeCode: "completed",
    outcomeLabel: "轨迹完成",
    explanation:
      "这条轨迹完成了 turn、trigger、recall、injection 和 write-back 阶段，没有出现明显主导异常。",
    incomplete
  };
}

function buildPhaseNarratives(detail: RunAggregate): RunTracePhaseNarrative[] {
  const phases = groupByPhase(detail);

  return phases.flatMap((phase) => {
    const turn = phase.turn ?? detail.turn;
    return [
      {
        key: "turn" as const,
        title: `轮次 / ${phase.phase}`,
        summary: `${formatSourceReference(turn.turnId ?? turn.traceId)} 运行在 ${phase.phase}。`,
        details: [
          formatSessionReference(turn.sessionId),
          `当前输入：${turn.currentInput ?? "未记录"}`,
          `助手输出：${turn.assistantOutput ?? "未记录"}`
        ]
      },
      {
        key: "trigger" as const,
        title: `Trigger / ${phase.phase}`,
        summary: phase.triggerRun?.triggerHit
          ? `${memoryModeSummary(phase.triggerRun.memoryMode)} 触发条件已命中。原因：${phase.triggerRun.triggerReason ?? "运行时记录到了触发命中"}。`
          : `这一阶段没有触发。${phase.triggerRun?.triggerReason ?? "未记录触发原因。"} `,
        details: [
          `请求作用域：${formatScopeList(phase.triggerRun?.requestedScopes ?? [])}`,
          `选中作用域：${formatScopeList(phase.triggerRun?.selectedScopes ?? [])}`,
          phase.triggerRun?.scopeDecision ?? "未记录作用域决策说明。"
        ]
      },
      {
        key: "recall" as const,
        title: `Recall / ${phase.phase}`,
        summary: summarizeRecall(phase.recallRun),
        details: [
          `记忆模式：${memoryModeSummary(phase.recallRun?.memoryMode)}`,
          `请求作用域：${formatScopeList(phase.recallRun?.requestedScopes ?? [])}`,
          `命中作用域：${formatScopeList(phase.recallRun?.selectedScopes ?? [])}`,
          ...(phase.recallRun?.scopeHitCounts.map(
            (item) => `${scopeLabel(item.scope)} 命中：${item.count}`
          ) ?? []),
          phase.recallRun?.emptyReason ?? "未记录空召回说明。"
        ]
      },
      {
        key: "injection" as const,
        title: `Injection / ${phase.phase}`,
        summary: phase.injectionRun?.injected
          ? phase.injectionRun.memorySummary ?? "注入已完成。"
          : phase.injectionRun?.resultState ?? "未记录注入阶段",
        details: [
          `选中作用域：${formatScopeList(phase.injectionRun?.selectedScopes ?? [])}`,
          `保留记录：${phase.injectionRun?.keptRecordIds.join(", ") || "未记录"}`,
          `裁剪记录：${phase.injectionRun?.trimmedRecordIds.join(", ") || "未记录"}`,
          `裁剪原因：${phase.injectionRun?.trimReasons.join(", ") || "未记录"}`
        ]
      },
      {
        key: "plan" as const,
        title: `Plan / ${phase.phase}`,
        summary: summarizePlanRuns(phase.memoryPlanRuns),
        details: phase.memoryPlanRuns.flatMap((run) => [
          `${run.planKind}：${run.resultState}${run.degraded ? "（降级）" : ""}`,
          `输入摘要：${run.inputSummary ?? "未记录"}`,
          `输出摘要：${run.outputSummary ?? "未记录"}`,
          `版本：prompt=${run.promptVersion ?? "未记录"} / schema=${run.schemaVersion ?? "未记录"}`
        ])
      },
      {
        key: "writeback" as const,
        title: `Write-back / ${phase.phase}`,
        summary: phase.writeBackRun
          ? `写回状态：${phase.writeBackRun.resultState}。${memoryModeSummary(phase.writeBackRun.memoryMode)}`
          : "未记录写回阶段。",
        details: [
          `已提交作业：${phase.writeBackRun?.submittedJobIds.join(", ") || "未记录"}`,
          `候选摘要：${phase.writeBackRun?.candidateSummaries.join(" | ") || "未记录"}`,
          ...(phase.writeBackRun?.scopeDecisions.map(
            (item) => `${scopeLabel(item.scope)} x${item.count}：${item.reason}`
          ) ?? []),
          `过滤原因：${phase.writeBackRun?.filteredReasons.join(", ") || "未记录"}`
        ]
      }
    ];
  });
}

function buildListItem(detail: RunAggregate) {
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
    scopeSummary: summarizeScopes(detail),
    triggerLabel: triggerRun?.triggerType
      ? `${triggerRun.triggerType}${triggerRun.triggerHit ? "" : " (miss)"}`
      : "未记录触发阶段",
    recallOutcome: summarizeRecall(recallRun),
    injectedCount: injectionRun?.injectedCount ?? 0,
    writeBackStatus: writeBackRun?.resultState ?? "not_recorded",
    degraded: recallRun?.degraded ?? writeBackRun?.degraded ?? false,
    summary:
      turn.currentInput ??
      turn.assistantOutput ??
      "这一轮没有记录输入或输出摘要。"
  };
}

function toDependencyStatus(dependencies: RuntimeDependencyRecord[]) {
  const labelByName: Record<string, string> = {
    read_model: "运行时读模型",
    embeddings: "运行时向量依赖",
    storage_writeback: "运行时存储写回",
    memory_llm: "记忆模型"
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
  let result = await fetchRuntimeRuns(toRunTraceQuery(filters));
  let selectionFilters = filters;

  if (filters.turnId && !filters.traceId && !hasRunRecords(result.data)) {
    const fallbackFilters = {
      ...filters,
      turnId: undefined,
      traceId: filters.turnId
    };
    const fallbackResult = await fetchRuntimeRuns(toRunTraceQuery(fallbackFilters));
    if (hasRunRecords(fallbackResult.data)) {
      result = fallbackResult;
      selectionFilters = fallbackFilters;
    }
  }

  const grouped = groupByTrace(result.data).sort((left, right) =>
    (right.turn.createdAt ?? "").localeCompare(left.turn.createdAt ?? "")
  );

  const selected =
    selectionFilters.turnId
      ? grouped.find((item) => item.turn.turnId === selectionFilters.turnId) ?? null
      : selectionFilters.traceId
        ? grouped.find((item) => item.turn.traceId === selectionFilters.traceId) ?? null
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
                ? `已选择 ${formatScopeList(run.selectedScopes)}。`
                : "未记录作用域决策说明。"),
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
              scopeLabel: scopeLabel(item.scope),
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
              scopeLabel: scopeLabel(item.scope),
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
          dependencyStatus: toDependencyStatus(selected.dependencyStatus),
          phaseNarratives: buildPhaseNarratives(selected),
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
      title: "运行时数据源暂不可用",
      description:
        response.sourceStatus.detail ??
        "运行时观测接口当前不可查询，所以轨迹数据暂时不可用。"
    };
  }

  if (response.appliedFilters.turnId || response.appliedFilters.traceId) {
    return {
      title: "当前筛选条件下没有找到轨迹",
      description:
        "运行时观测接口可访问，但没有返回对应轮次或调试标识的轨迹。"
    };
  }

  return {
    title: "请输入轮次或调试标识查看轨迹",
    description:
      "下方仍然可以列出最近轨迹，但主详情视图仍然由轮次或调试标识驱动。"
  };
}

export { summarizeScopes, buildPhaseNarratives, formatScopeList, scopeExplanation };

import "server-only";

import {
  DashboardDiagnosis,
  DashboardDiagnosisCard,
  DashboardMetric,
  DashboardResponse,
  DashboardTrend
} from "@/lib/contracts";
import { getCachedValue } from "@/lib/cache";
import { getAppConfig } from "@/lib/env";
import { formatMetricValue } from "@/lib/format";
import { fetchRuntimeMetrics, fetchRuntimeRuns } from "@/lib/server/runtime-observe-client";
import { fetchGovernanceExecutions } from "@/lib/server/storage-governance-executions-client";
import { fetchStorageMetrics, fetchStorageWriteJobs } from "@/lib/server/storage-observe-client";

type TrendSource = {
  current: number | null;
  previous: number | null;
  points: Array<number | null>;
};

function metric(
  key: string,
  label: string,
  value: number | null,
  unit: DashboardMetric["unit"],
  source: DashboardMetric["source"],
  description: string,
  warningAt?: number,
  dangerAt?: number
): DashboardMetric {
  let severity: DashboardMetric["severity"] = "unknown";

  if (value !== null) {
    severity = "normal";

    if (dangerAt !== undefined && value >= dangerAt) {
      severity = "danger";
    } else if (warningAt !== undefined && value >= warningAt) {
      severity = "warning";
    }
  }

  return {
    key,
    label,
    value,
    unit,
    source,
    description,
    severity,
    formattedValue: formatMetricValue(value, unit)
  };
}

function parseWindow(window: string) {
  if (window === "15m") return 15;
  if (window === "30m") return 30;
  if (window === "1h") return 60;
  if (window === "6h") return 360;
  if (window === "24h") return 1440;
  return 30;
}

function buildPointLabels(window: string) {
  if (window === "15m") return ["-15m", "-10m", "-5m", "now"];
  if (window === "30m") return ["-30m", "-20m", "-10m", "now"];
  if (window === "1h") return ["-60m", "-40m", "-20m", "now"];
  if (window === "6h") return ["-6h", "-4h", "-2h", "now"];
  if (window === "24h") return ["-24h", "-16h", "-8h", "now"];
  return ["-30m", "-20m", "-10m", "now"];
}

function deltaFormatted(current: number | null, previous: number | null, unit: DashboardMetric["unit"]) {
  if (current === null || previous === null) {
    return "不可用";
  }

  const delta = current - previous;

  if (unit === "percent") {
    return `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pts`;
  }

  if (unit === "ms") {
    return `${delta >= 0 ? "+" : ""}${Math.round(delta)} ms`;
  }

  return `${delta >= 0 ? "+" : ""}${Math.round(delta)}`;
}

function trendSeverity(current: number | null, warningAt?: number, dangerAt?: number): DashboardTrend["severity"] {
  if (current === null) {
    return "unknown";
  }

  if (dangerAt !== undefined && current >= dangerAt) {
    return "danger";
  }

  if (warningAt !== undefined && current >= warningAt) {
    return "warning";
  }

  return "normal";
}

function seriesFromPair(current: number | null, previous: number | null): TrendSource {
  return {
    current,
    previous,
    points:
      current === null && previous === null
        ? [null, null, null, null]
        : [previous, previous, current, current]
  };
}

function ratio(numerator: number, denominator: number) {
  if (denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function pointSeries(current: number | null, previous: number | null, currentTail?: number | null) {
  return {
    current,
    previous,
    points: [previous, previous, currentTail ?? current, current]
  };
}

type GovernanceExecutionItem = Awaited<ReturnType<typeof fetchGovernanceExecutions>>["items"][number];

function countExecutionsInRange(
  items: GovernanceExecutionItem[],
  startInclusive: number,
  endExclusive?: number
) {
  return items.filter((item) => {
    const startedAt = timeOf(item.startedAt);
    if (startedAt < startInclusive) {
      return false;
    }
    if (endExclusive !== undefined && startedAt >= endExclusive) {
      return false;
    }
    return true;
  });
}

function hasGovernanceFollowupHit(
  executionTime: number,
  targetRecordIds: string[],
  recallRuns: Awaited<ReturnType<typeof fetchRuntimeRuns>>["data"]["recallRuns"],
  windowMs = 6 * 60 * 60 * 1000
) {
  if (targetRecordIds.length === 0) {
    return false;
  }

  return recallRuns.some((run) => {
    const createdAt = timeOf(run.createdAt);
    if (createdAt <= executionTime || createdAt > executionTime + windowMs) {
      return false;
    }

    return run.selectedRecordIds.some((recordId) => targetRecordIds.includes(recordId));
  });
}

function computeGovernanceWindowTrend(
  window: string,
  executions: GovernanceExecutionItem[],
  recallRuns: Awaited<ReturnType<typeof fetchRuntimeRuns>>["data"]["recallRuns"]
) {
  const { currentStart, previousStart, now } = getCutoffBounds(window);
  const currentExecutions = countExecutionsInRange(executions, currentStart, now);
  const previousExecutions = countExecutionsInRange(executions, previousStart, currentStart);

  const currentVerifierRequired = currentExecutions.filter((item) => item.verifierRequired).length;
  const previousVerifierRequired = previousExecutions.filter((item) => item.verifierRequired).length;
  const currentVerifierApproved = currentExecutions.filter(
    (item) => item.verifierRequired && item.verifierDecision === "approve"
  ).length;
  const previousVerifierApproved = previousExecutions.filter(
    (item) => item.verifierRequired && item.verifierDecision === "approve"
  ).length;
  const currentExecuted = currentExecutions.filter((item) => item.executionStatus === "executed").length;
  const previousExecuted = previousExecutions.filter((item) => item.executionStatus === "executed").length;
  const currentRetries = Math.max(
    currentExecutions.length - new Set(currentExecutions.map((item) => item.proposalId)).size,
    0
  );
  const previousRetries = Math.max(
    previousExecutions.length - new Set(previousExecutions.map((item) => item.proposalId)).size,
    0
  );

  const buildRecallHitRate = (items: typeof currentExecutions) => {
    const executedItems = items.filter((item) => item.executionStatus === "executed");
    if (executedItems.length === 0) {
      return null;
    }

    const hits = executedItems.filter((item) => {
      const executionTime = timeOf(item.finishedAt ?? item.startedAt);

      return hasGovernanceFollowupHit(executionTime, item.targetRecordIds, recallRuns);
    }).length;

    return ratio(hits, executedItems.length);
  };

  return {
    proposalVolume: seriesFromPair(currentExecutions.length, previousExecutions.length),
    verificationPassRate: pointSeries(
      ratio(currentVerifierApproved, currentVerifierRequired),
      ratio(previousVerifierApproved, previousVerifierRequired)
    ),
    executionSuccessRate: pointSeries(
      ratio(currentExecuted, currentExecutions.length),
      ratio(previousExecuted, previousExecutions.length)
    ),
    retryRate: pointSeries(
      ratio(currentRetries, currentExecutions.length),
      ratio(previousRetries, previousExecutions.length)
    ),
    recallHitRateAfterGovernance: pointSeries(
      buildRecallHitRate(currentExecutions),
      buildRecallHitRate(previousExecutions)
    )
  };
}

function getCutoffBounds(window: string) {
  const minutes = parseWindow(window);
  const now = Date.now();
  const currentStart = now - (minutes / 2) * 60_000;
  const previousStart = now - minutes * 60_000;

  return { now, currentStart, previousStart };
}

function timeOf(value: string | null) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function computeRuntimeWindowTrend(
  window: string,
  runtimeRuns: Awaited<ReturnType<typeof fetchRuntimeRuns>>["data"]
) {
  const { currentStart, previousStart } = getCutoffBounds(window);
  const currentRecall = runtimeRuns.recallRuns.filter((run) => timeOf(run.createdAt) >= currentStart);
  const previousRecall = runtimeRuns.recallRuns.filter(
    (run) => timeOf(run.createdAt) >= previousStart && timeOf(run.createdAt) < currentStart
  );
  const currentTrigger = runtimeRuns.triggerRuns.filter((run) => timeOf(run.createdAt) >= currentStart);
  const previousTrigger = runtimeRuns.triggerRuns.filter(
    (run) => timeOf(run.createdAt) >= previousStart && timeOf(run.createdAt) < currentStart
  );
  const currentScopeHits = currentRecall.flatMap((run) => run.scopeHitCounts);
  const previousScopeHits = previousRecall.flatMap((run) => run.scopeHitCounts);

  const currentEmptyRate = ratio(
    currentRecall.filter((run) => run.resultState === "empty").length,
    currentRecall.length
  );
  const previousEmptyRate = ratio(
    previousRecall.filter((run) => run.resultState === "empty").length,
    previousRecall.length
  );

  const currentRecallP95 = currentRecall.length
    ? [...currentRecall.map((run) => run.durationMs ?? 0)].sort((a, b) => a - b)[
        Math.max(Math.ceil(currentRecall.length * 0.95) - 1, 0)
      ]
    : null;
  const previousRecallP95 = previousRecall.length
    ? [...previousRecall.map((run) => run.durationMs ?? 0)].sort((a, b) => a - b)[
        Math.max(Math.ceil(previousRecall.length * 0.95) - 1, 0)
      ]
    : null;
  const currentScopeTotal = currentScopeHits.reduce((sum, item) => sum + item.count, 0);
  const previousScopeTotal = previousScopeHits.reduce((sum, item) => sum + item.count, 0);
  const currentGlobalScope = currentScopeHits
    .filter((item) => item.scope === "user")
    .reduce((sum, item) => sum + item.count, 0);
  const previousGlobalScope = previousScopeHits
    .filter((item) => item.scope === "user")
    .reduce((sum, item) => sum + item.count, 0);

  return {
    emptyRecall: pointSeries(currentEmptyRate, previousEmptyRate),
    recallLatency: pointSeries(currentRecallP95, previousRecallP95),
    triggerRate: pointSeries(
      ratio(currentTrigger.filter((run) => run.triggerHit).length, currentTrigger.length),
      ratio(previousTrigger.filter((run) => run.triggerHit).length, previousTrigger.length)
    ),
    globalScopeShare: pointSeries(
      currentScopeTotal > 0 ? currentGlobalScope / currentScopeTotal : null,
      previousScopeTotal > 0 ? previousGlobalScope / previousScopeTotal : null
    )
  };
}

function buildTrend(
  key: string,
  title: string,
  summary: string,
  source: DashboardTrend["source"],
  unit: DashboardTrend["unit"],
  values: TrendSource,
  window: string,
  warningAt?: number,
  dangerAt?: number
): DashboardTrend {
  const labels = buildPointLabels(window);

  return {
    key,
    title,
    summary,
    source,
    unit,
    currentValue: values.current,
    previousValue: values.previous,
    currentFormatted: formatMetricValue(values.current, unit),
    previousFormatted: formatMetricValue(values.previous, unit),
    deltaFormatted: deltaFormatted(values.current, values.previous, unit),
    severity: trendSeverity(values.current, warningAt, dangerAt),
    points: labels.map((label, index) => ({
      label,
      value: values.points[index] ?? null
    }))
  };
}

function diagnosisCard(
  key: string,
  source: DashboardDiagnosisCard["source"],
  title: string,
  summary: string,
  severity: DashboardDiagnosisCard["severity"]
): DashboardDiagnosisCard {
  return { key, source, title, summary, severity };
}

export function estimateStorageTrend(window: string, jobs: Awaited<ReturnType<typeof fetchStorageWriteJobs>>["jobs"]) {
  const minutes = parseWindow(window);
  const now = Date.now();
  const midpoint = now - minutes * 60_000;
  const currentStart = now - (minutes / 2) * 60_000;
  const items = jobs?.items ?? [];

  const currentWindow = items.filter((item) => {
    const receivedAt = item.receivedAt ? new Date(item.receivedAt).getTime() : 0;
    return receivedAt >= currentStart;
  });
  const previousWindow = items.filter((item) => {
    const receivedAt = item.receivedAt ? new Date(item.receivedAt).getTime() : 0;
    return receivedAt >= midpoint && receivedAt < currentStart;
  });

  const countWhere = (collection: typeof currentWindow, predicate: (item: typeof currentWindow[number]) => boolean) =>
    collection.filter(predicate).length;

  return {
    backlog: seriesFromPair(
      countWhere(currentWindow, (item) => item.status === "queued" || item.status === "processing"),
      countWhere(previousWindow, (item) => item.status === "queued" || item.status === "processing")
    ),
    conflict: seriesFromPair(
      countWhere(currentWindow, (item) => item.resultStatus === "open_conflict"),
      countWhere(previousWindow, (item) => item.resultStatus === "open_conflict")
    )
  };
}

export function buildDashboardDiagnosis(
  retrievalMetrics: DashboardMetric[],
  storageMetrics: DashboardMetric[],
  degradedSources: string[]
): DashboardDiagnosis {
  if (degradedSources.length > 0) {
    return {
      title: "当前主要问题来自依赖",
      summary: `一个或多个上游数据源已经降级：${degradedSources.join("、")}。`,
      severity: "danger"
    };
  }

  const emptyRecall = retrievalMetrics.find((item) => item.key === "empty_recall_rate")?.value ?? null;
  const conflictRate = storageMetrics.find((item) => item.key === "conflict_rate")?.value ?? null;
  const recallP95 = retrievalMetrics.find((item) => item.key === "recall_p95_ms")?.value ?? null;
  const writeP95 = storageMetrics.find((item) => item.key === "write_p95_ms")?.value ?? null;

  if (emptyRecall !== null && emptyRecall >= 0.35) {
    return {
      title: "Recall strategy likely needs attention",
      summary:
        "依赖都健康，但空召回比例依然偏高，通常意味着触发条件或作用域选择过窄。",
      severity: "warning"
    };
  }

  if (conflictRate !== null && conflictRate >= 0.15) {
    return {
      title: "Stored memory quality is drifting",
      summary:
        "冲突率正在升高，通常意味着写回候选重叠，或者缺少合并规则。",
      severity: "warning"
    };
  }

  if ((recallP95 ?? 0) >= 1200 || (writeP95 ?? 0) >= 1500) {
    return {
      title: "延迟是当前主要问题",
      summary:
        "P95 延迟已经高于目标区间，所以用户更可能感知到的是变慢，而不是策略漂移。",
      severity: "warning"
    };
  }

  return {
    title: "当前没有明显主导异常",
    summary:
      "当前指标没有指向单一主要故障模式。可以继续结合趋势区和依赖健康查看局部回退。",
    severity: "info"
  };
}

function buildDiagnosisCards(
  retrievalMetrics: DashboardMetric[],
  storageMetrics: DashboardMetric[],
  runtimeTrend: ReturnType<typeof computeRuntimeWindowTrend>,
  storageTrend: ReturnType<typeof estimateStorageTrend>,
  governanceTrend: ReturnType<typeof computeGovernanceWindowTrend>,
  degradedSources: string[]
) {
  const emptyRecall = retrievalMetrics.find((item) => item.key === "empty_recall_rate")?.value ?? null;
  const conflictRate = storageMetrics.find((item) => item.key === "conflict_rate")?.value ?? null;
  const workspaceOnlyRate = retrievalMetrics.find((item) => item.key === "workspace_only_rate")?.value ?? null;
  const globalShare = retrievalMetrics.find((item) => item.key === "global_scope_share")?.value ?? null;
  const workspaceShare = retrievalMetrics.find((item) => item.key === "workspace_scope_share")?.value ?? null;
  const governanceSuccessRate =
    storageMetrics.find((item) => item.key === "governance_execution_success_rate")?.value ?? null;
  const governanceRetryRate =
    storageMetrics.find((item) => item.key === "governance_retry_rate")?.value ?? null;

  return [
    diagnosisCard(
      "empty_recall_trend",
      "runtime",
      "空召回趋势",
      degradedSources.length > 0
        ? `运行时数据源已降级：${degradedSources.join("、")}。`
        : emptyRecall !== null && emptyRecall >= 0.35
          ? "最近召回经常返回空结果，需要检查当前触发规则和作用域选择。"
          : "空召回仍然处在当前预期范围内。",
      degradedSources.length > 0 ? "danger" : emptyRecall !== null && emptyRecall >= 0.35 ? "warning" : "info"
    ),
    diagnosisCard(
      "scope_mix",
      "cross",
      "全局 / 工作区使用情况",
      workspaceOnlyRate === 1
        ? "最近几轮一直停留在仅工作区模式，所以不应该出现全局记忆。"
        : globalShare !== null && workspaceShare !== null
          ? `最近选中作用域里，全局占 ${formatMetricValue(globalShare, "percent")}，工作区占 ${formatMetricValue(workspaceShare, "percent")}。`
          : "运行时还没有暴露足够的作用域数据，所以这张卡片目前只能用部分信号。",
      workspaceOnlyRate === 1 ? "info" : globalShare !== null && globalShare > 0.6 ? "warning" : "info"
    ),
    diagnosisCard(
      "writeback_backlog",
      "storage",
      "写回积压",
      storageTrend.backlog.current !== null && storageTrend.backlog.current > 5
        ? "当前半窗口内，排队和处理中作业正在积压。"
        : "最近写回作业没有看到明显积压增长。",
      storageTrend.backlog.current !== null && storageTrend.backlog.current > 5 ? "warning" : "info"
    ),
    diagnosisCard(
      "conflict_pressure",
      "storage",
      "冲突压力",
      conflictRate !== null && conflictRate >= 0.15
        ? "当前冲突率偏高，需要关注治理策略或合并规则。"
        : "当前冲突压力比较稳定。",
      conflictRate !== null && conflictRate >= 0.15 ? "warning" : "info"
    ),
    diagnosisCard(
      "governance_execution",
      "storage",
      "治理执行稳定性",
      governanceRetryRate !== null && governanceRetryRate >= 0.15
        ? "最近治理重试比例偏高，优先检查执行链路稳定性。"
        : governanceSuccessRate !== null && governanceSuccessRate < 0.8
          ? "最近治理执行成功率偏低，需要先排查执行失败原因。"
          : governanceTrend.recallHitRateAfterGovernance.current !== null
            ? `近窗治理后召回命中率约为 ${formatMetricValue(governanceTrend.recallHitRateAfterGovernance.current, "percent")}。`
            : "当前治理执行整体稳定，但治理后召回命中样本还不够。",
      governanceRetryRate !== null && governanceRetryRate >= 0.15
        ? "warning"
        : governanceSuccessRate !== null && governanceSuccessRate < 0.8
          ? "warning"
          : "info"
    )
  ];
}

export async function getDashboard(window: string): Promise<DashboardResponse> {
  const { values } = getAppConfig();

  return getCachedValue(`dashboard:${window}`, values.DASHBOARD_CACHE_MS, async () => {
    const [runtimeCurrent, runtimeRuns, storageCurrent, jobs, governance] = await Promise.all([
      fetchRuntimeMetrics(),
      fetchRuntimeRuns(""),
      fetchStorageMetrics(),
      fetchStorageWriteJobs(),
      fetchGovernanceExecutions({ limit: 100 })
    ]);

    const runtimeTrend = computeRuntimeWindowTrend(window, runtimeRuns.data);
    const storageTrend = estimateStorageTrend(window, jobs.jobs);
    const governanceTrend = computeGovernanceWindowTrend(window, governance.items, runtimeRuns.data.recallRuns);

    const triggerRuns = runtimeRuns.data.triggerRuns;
    const recallRuns = runtimeRuns.data.recallRuns;
    const selectedScopeCounts = recallRuns.flatMap((run) => run.scopeHitCounts);
    const totalSelectedScopeHits = selectedScopeCounts.reduce((sum, item) => sum + item.count, 0);
    const globalScopeHits = selectedScopeCounts
      .filter((item) => item.scope === "user")
      .reduce((sum, item) => sum + item.count, 0);
    const workspaceScopeHits = selectedScopeCounts
      .filter((item) => item.scope === "workspace")
      .reduce((sum, item) => sum + item.count, 0);
    const workspaceOnlyTurns = triggerRuns.filter((run) => run.memoryMode === "workspace_only").length;

    const retrievalMetrics = [
      metric(
        "trigger_rate",
        "触发率",
        runtimeCurrent.metrics?.triggerRate ?? null,
        "percent",
        "runtime",
        "触发记忆检索的轮次占比。",
        0.7,
        0.9
      ),
      metric(
        "recall_hit_rate",
        "召回命中率",
        runtimeCurrent.metrics?.recallHitRate ?? null,
        "percent",
        "runtime",
        "已触发召回里，至少找到一条记录的占比。"
      ),
      metric(
        "empty_recall_rate",
        "空召回率",
        runtimeCurrent.metrics?.emptyRecallRate ?? null,
        "percent",
        "runtime",
        "已触发召回里，返回零条可用记录的占比。",
        0.2,
        0.35
      ),
      metric(
        "injection_rate",
        "实际注入率",
        runtimeCurrent.metrics?.injectionRate ?? null,
        "percent",
        "runtime",
        "真正把记忆块注入到提示词中的轮次占比。"
      ),
      metric(
        "trim_rate",
        "注入裁剪率",
        runtimeCurrent.metrics?.trimRate ?? null,
        "percent",
        "runtime",
        "因为 token 预算被裁掉记录的注入占比。",
        0.15,
        0.3
      ),
      metric(
        "recall_p95_ms",
        "召回 P95",
        runtimeCurrent.metrics?.recallP95Ms ?? null,
        "ms",
        "runtime",
        "运行时召回查询的 P95 延迟。",
        800,
        1200
      ),
      metric(
        "injection_p95_ms",
        "注入 P95",
        runtimeCurrent.metrics?.injectionP95Ms ?? null,
        "ms",
        "runtime",
        "生成注入块的 P95 延迟。",
        400,
        700
      ),
      metric(
        "writeback_submit_rate",
        "写回提交率",
        runtimeCurrent.metrics?.writeBackSubmitRate ?? null,
        "percent",
        "runtime",
        "产生并成功提交写回候选的轮次占比。"
      ),
      metric(
        "runtime_outbox_pending_count",
        "运行时待补提交",
        runtimeCurrent.metrics?.outboxPendingCount ?? null,
        "count",
        "runtime",
        "同步快路径失败后仍留在 runtime 本地 outbox 的候选数。",
        1,
        5
      ),
      metric(
        "runtime_outbox_dead_letter_count",
        "运行时死信候选",
        runtimeCurrent.metrics?.outboxDeadLetterCount ?? null,
        "count",
        "runtime",
        "runtime outbox 重试耗尽后进入死信的候选数。",
        1,
        3
      ),
      metric(
        "global_scope_share",
        "全局记忆占比",
        totalSelectedScopeHits > 0 ? globalScopeHits / totalSelectedScopeHits : null,
        "percent",
        "runtime",
        "最近召回命中里来自全局记忆的占比。",
        0.5,
        0.7
      ),
      metric(
        "workspace_scope_share",
        "工作区记忆占比",
        totalSelectedScopeHits > 0 ? workspaceScopeHits / totalSelectedScopeHits : null,
        "percent",
        "runtime",
        "最近召回命中里来自工作区记忆的占比。"
      ),
      metric(
        "workspace_only_rate",
        "仅工作区模式占比",
        triggerRuns.length > 0 ? workspaceOnlyTurns / triggerRuns.length : null,
        "percent",
        "runtime",
        "最近以仅工作区模式运行的轮次占比。"
      )
    ];

    const storageMetrics = [
      metric(
        "write_accepted",
        "已接收写入",
        storageCurrent.metrics?.writeAccepted ?? null,
        "count",
        "storage",
        "选定窗口内已接收的写回作业数量。"
      ),
      metric(
        "write_succeeded",
        "写入成功数",
        storageCurrent.metrics?.writeSucceeded ?? null,
        "count",
        "storage",
        "成功完成的写回作业数量。"
      ),
      metric(
        "duplicate_ignored_rate",
        "重复忽略率",
        storageCurrent.metrics?.duplicateIgnoredRate ?? null,
        "percent",
        "storage",
        "被判定为重复而忽略的写回候选占比。",
        0.25,
        0.45
      ),
      metric(
        "merge_rate",
        "合并率",
        storageCurrent.metrics?.mergeRate ?? null,
        "percent",
        "storage",
        "被合并到已有记录中的写入占比。"
      ),
      metric(
        "conflict_rate",
        "冲突率",
        storageCurrent.metrics?.conflictRate ?? null,
        "percent",
        "storage",
        "最终进入待确认或冲突状态的写入占比。",
        0.08,
        0.15
      ),
      metric(
        "dead_letter_jobs",
        "死信作业数",
        storageCurrent.metrics?.deadLetterJobs ?? jobs.jobs?.deadLetter ?? null,
        "count",
        "storage",
        "耗尽重试次数后进入死信队列的作业数。",
        1,
        5
      ),
      metric(
        "refresh_failure_rate",
        "读模型刷新失败率",
        storageCurrent.metrics?.refreshFailureRate ?? null,
        "percent",
        "storage",
        "读模型刷新作业中失败的占比。",
        0.02,
        0.1
      ),
      metric(
        "write_p95_ms",
        "写入 P95",
        storageCurrent.metrics?.writeP95Ms ?? null,
        "ms",
        "storage",
        "存储侧写入处理的 P95 延迟。",
        1000,
        1500
      ),
      metric(
        "new_pending_embedding_records",
        "新待补向量数",
        storageCurrent.metrics?.newPendingEmbeddingRecords ?? null,
        "count",
        "storage",
        "首次 embedding 失败后进入 pending 的读模型记录数。",
        1,
        10
      ),
      metric(
        "retry_pending_embedding_records",
        "重试待补向量数",
        storageCurrent.metrics?.retryPendingEmbeddingRecords ?? null,
        "count",
        "storage",
        "多次补刷后仍停留在 pending 的读模型记录数。",
        1,
        5
      ),
      metric(
        "oldest_pending_embedding_age_seconds",
        "最老待补向量时长",
        storageCurrent.metrics?.oldestPendingEmbeddingAgeSeconds ?? null,
        "count",
        "storage",
        "当前最老一条 pending 向量记录已经等待的秒数。",
        60,
        300
      ),
      metric(
        "governance_proposal_count",
        "治理提案总量",
        storageCurrent.metrics?.governanceProposalCount ?? null,
        "count",
        "storage",
        "已生成并落库的治理提案数量。"
      ),
      metric(
        "governance_verification_pass_rate",
        "治理复核通过率",
        ratio(
          storageCurrent.metrics?.governanceVerifierApprovedCount ?? 0,
          storageCurrent.metrics?.governanceVerifierRequiredCount ?? 0
        ),
        "percent",
        "storage",
        "需要 verifier 的高影响提案里，通过二次复核的占比。",
        0.8,
        0.95
      ),
      metric(
        "governance_execution_success_rate",
        "治理执行成功率",
        ratio(
          storageCurrent.metrics?.governanceExecutionSuccessCount ?? 0,
          storageCurrent.metrics?.governanceExecutionCount ?? 0
        ),
        "percent",
        "storage",
        "治理执行记录里，最终成功落盘的占比。"
      ),
      metric(
        "governance_soft_delete_rate",
        "软删除占比",
        ratio(
          storageCurrent.metrics?.governanceSoftDeleteCount ?? 0,
          storageCurrent.metrics?.governanceExecutionCount ?? 0
        ),
        "percent",
        "storage",
        "治理执行里软删除动作的占比，用来观察删除策略是否过于激进。",
        0.2,
        0.4
      ),
      metric(
        "governance_retry_rate",
        "治理重试占比",
        ratio(
          storageCurrent.metrics?.governanceRetryCount ?? 0,
          storageCurrent.metrics?.governanceExecutionCount ?? 0
        ),
        "percent",
        "storage",
        "同一 proposal 出现多次执行记录的占比，用来观察执行稳定性。",
        0.05,
        0.15
      ),
      metric(
        "governance_recall_hit_rate_after",
        "治理后召回命中率",
        governanceTrend.recallHitRateAfterGovernance.current,
        "percent",
        "storage",
        "近窗内已执行治理动作后，后续召回再次命中这些目标记录的占比；当前按运行时近期轨迹做估算。"
      )
    ];

    const trends = [
      buildTrend(
        "empty_recall_shift",
        "空召回随时间变化",
        "用来判断最近空召回是否开始变多。",
        "runtime",
        "percent",
        runtimeTrend.emptyRecall,
        window,
        0.2,
        0.35
      ),
      buildTrend(
        "writeback_backlog",
        "写回积压",
        "对比当前半窗口和上一半窗口里的排队与处理中作业数量。",
        "storage",
        "count",
        storageTrend.backlog,
        window,
        5,
        10
      ),
      buildTrend(
        "conflict_spike",
        "冲突压力",
        "判断最近写回工作是否比上一半窗口带来了更多冲突。",
        "storage",
        "count",
        storageTrend.conflict,
        window,
        1,
        3
      ),
      buildTrend(
        "runtime_vs_storage_latency",
        "运行时召回延迟",
        "如果运行时召回延迟升高而存储写入延迟保持平稳，说明更可能是检索策略或检索依赖变慢。",
        "runtime",
        "ms",
        runtimeTrend.recallLatency,
        window,
        800,
        1200
      ),
      buildTrend(
        "scope_mix_shift",
        "全局记忆占比",
        "观察最近召回是更偏向全局记忆，还是大多仍停留在工作区边界内。",
        "runtime",
        "percent",
        runtimeTrend.globalScopeShare,
        window,
        0.5,
        0.7
      ),
      buildTrend(
        "governance_proposal_volume",
        "治理提案量",
        "对比当前半窗口和上一半窗口里的治理提案数量变化。",
        "storage",
        "count",
        governanceTrend.proposalVolume,
        window
      ),
      buildTrend(
        "governance_verification_pass_rate",
        "治理复核通过率",
        "观察高影响治理动作在最近窗口里的 verifier 通过情况。",
        "storage",
        "percent",
        governanceTrend.verificationPassRate,
        window,
        0.8,
        0.95
      ),
      buildTrend(
        "governance_execution_success_rate",
        "治理执行成功率",
        "判断最近治理执行是稳定落盘，还是开始出现更多失败。",
        "storage",
        "percent",
        governanceTrend.executionSuccessRate,
        window,
        0.8,
        0.95
      ),
      buildTrend(
        "governance_retry_rate",
        "治理重试占比",
        "观察同一提案是否开始需要更多次执行才能成功。",
        "storage",
        "percent",
        governanceTrend.retryRate,
        window,
        0.05,
        0.15
      ),
      buildTrend(
        "governance_recall_hit_rate_after",
        "治理后召回命中率",
        "近窗估算治理动作执行后，后续召回再次命中相关记录的比例。",
        "storage",
        "percent",
        governanceTrend.recallHitRateAfterGovernance,
        window
      )
    ];

    const sourceStatus = [runtimeCurrent.status, storageCurrent.status, jobs.status, governance.status];
    const degradedSources = sourceStatus
      .filter((source) => source.status !== "healthy")
      .map((source) => source.label);

    return {
      retrievalMetrics,
      storageMetrics,
      trendWindow: window,
      diagnosis: buildDashboardDiagnosis(retrievalMetrics, storageMetrics, degradedSources),
      diagnosisCards: buildDiagnosisCards(
        retrievalMetrics,
        storageMetrics,
        runtimeTrend,
        storageTrend,
        governanceTrend,
        degradedSources
      ),
      trends,
      sourceStatus
    };
  });
}

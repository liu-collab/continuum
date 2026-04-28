import { DashboardMetric, DashboardTrend } from "@/lib/contracts";
import { formatMetricValue } from "@/lib/format";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";
import type { fetchRuntimeRuns } from "@/lib/server/runtime-observe-client";
import type { fetchGovernanceExecutions } from "@/lib/server/storage-governance-executions-client";
import type { fetchStorageWriteJobs } from "@/lib/server/storage-observe-client";

import { thresholdSeverity, type SeverityDirection } from "./metric-computer";

export type TrendSource = {
  current: number | null;
  previous: number | null;
  points: Array<number | null>;
};

function parseWindow(window: string) {
  if (window === "15m") return 15;
  if (window === "30m") return 30;
  if (window === "1h") return 60;
  if (window === "6h") return 360;
  if (window === "24h") return 1440;
  return 30;
}

function buildPointLabels(window: string, locale: AppLocale = "zh-CN") {
  const now = createTranslator(locale)("service.dashboard.trendLabels.now");
  if (window === "15m") return ["-15m", "-10m", "-5m", now];
  if (window === "30m") return ["-30m", "-20m", "-10m", now];
  if (window === "1h") return ["-60m", "-40m", "-20m", now];
  if (window === "6h") return ["-6h", "-4h", "-2h", now];
  if (window === "24h") return ["-24h", "-16h", "-8h", now];
  return ["-30m", "-20m", "-10m", now];
}

function deltaFormatted(
  current: number | null,
  previous: number | null,
  unit: DashboardMetric["unit"],
  locale: AppLocale = "zh-CN"
) {
  if (current === null || previous === null) {
    return createTranslator(locale)("service.dashboard.deltaUnavailable");
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

function trendSeverity(
  current: number | null,
  warningAt?: number,
  dangerAt?: number,
  direction: SeverityDirection = "higher_is_worse"
): DashboardTrend["severity"] {
  return thresholdSeverity(current, warningAt, dangerAt, direction);
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

export function ratio(numerator: number, denominator: number) {
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

export function computeGovernanceWindowTrend(
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
  dangerAt?: number,
  direction: SeverityDirection = "higher_is_worse",
  locale: AppLocale = "zh-CN"
): DashboardTrend {
  const labels = buildPointLabels(window, locale);

  return {
    key,
    title,
    summary,
    source,
    unit,
    currentValue: values.current,
    previousValue: values.previous,
    currentFormatted: formatMetricValue(values.current, unit, locale),
    previousFormatted: formatMetricValue(values.previous, unit, locale),
    deltaFormatted: deltaFormatted(values.current, values.previous, unit, locale),
    severity: trendSeverity(values.current, warningAt, dangerAt, direction),
    points: labels.map((label, index) => ({
      label,
      value: values.points[index] ?? null
    }))
  };
}

export function localizedTrend(
  key: string,
  source: DashboardTrend["source"],
  unit: DashboardTrend["unit"],
  values: TrendSource,
  window: string,
  warningAt?: number,
  dangerAt?: number,
  direction: SeverityDirection = "higher_is_worse",
  locale: AppLocale = "zh-CN"
) {
  const t = createTranslator(locale);

  return buildTrend(
    key,
    t(`service.dashboard.trendLabels.${key}`),
    t(`service.dashboard.trendSummaries.${key}`),
    source,
    unit,
    values,
    window,
    warningAt,
    dangerAt,
    direction,
    locale
  );
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

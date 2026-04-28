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
import { createTranslator, joinLocalizedList, type AppLocale } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";
import { fetchRuntimeMetrics, fetchRuntimeRuns } from "@/lib/server/runtime-observe-client";
import { fetchGovernanceExecutions } from "@/lib/server/storage-governance-executions-client";
import { fetchStorageMetrics, fetchStorageWriteJobs } from "@/lib/server/storage-observe-client";

type TrendSource = {
  current: number | null;
  previous: number | null;
  points: Array<number | null>;
};

type SeverityDirection = "higher_is_worse" | "lower_is_worse";

function thresholdSeverity(
  value: number | null,
  warningAt: number | undefined,
  dangerAt: number | undefined,
  direction: SeverityDirection
): DashboardMetric["severity"] {
  if (value === null) {
    return "unknown";
  }

  if (direction === "lower_is_worse") {
    if (dangerAt !== undefined && value <= dangerAt) {
      return "danger";
    }
    if (warningAt !== undefined && value <= warningAt) {
      return "warning";
    }
    return "normal";
  }

  if (dangerAt !== undefined && value >= dangerAt) {
    return "danger";
  }
  if (warningAt !== undefined && value >= warningAt) {
    return "warning";
  }
  return "normal";
}

function metric(
  key: string,
  label: string,
  value: number | null,
  unit: DashboardMetric["unit"],
  source: DashboardMetric["source"],
  description: string,
  warningAt?: number,
  dangerAt?: number,
  direction: SeverityDirection = "higher_is_worse",
  locale: AppLocale = "zh-CN"
): DashboardMetric {
  const severity = thresholdSeverity(value, warningAt, dangerAt, direction);

  return {
    key,
    label,
    value,
    unit,
    source,
    description,
    severity,
    formattedValue: formatMetricValue(value, unit, locale)
  };
}

function localizedMetric(
  key: string,
  value: number | null,
  unit: DashboardMetric["unit"],
  source: DashboardMetric["source"],
  warningAt?: number,
  dangerAt?: number,
  direction: SeverityDirection = "higher_is_worse",
  locale: AppLocale = "zh-CN"
) {
  const t = createTranslator(locale);

  return metric(
    key,
    t(`service.dashboard.metricLabels.${key}`),
    value,
    unit,
    source,
    t(`service.dashboard.metricDescriptions.${key}`),
    warningAt,
    dangerAt,
    direction,
    locale
  );
}

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

function localizedTrend(
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
  degradedSources: string[],
  locale: AppLocale = "zh-CN"
): DashboardDiagnosis {
  const t = createTranslator(locale);

  if (degradedSources.length > 0) {
    return {
      title: t("service.dashboard.diagnosisDependencyTitle"),
      summary: t("service.dashboard.diagnosisDependencySummary", {
        sources: joinLocalizedList(locale, degradedSources)
      }),
      severity: "danger"
    };
  }

  const emptyRecall = retrievalMetrics.find((item) => item.key === "empty_recall_rate")?.value ?? null;
  const conflictRate = storageMetrics.find((item) => item.key === "conflict_rate")?.value ?? null;
  const recallP95 = retrievalMetrics.find((item) => item.key === "recall_p95_ms")?.value ?? null;
  const writeP95 = storageMetrics.find((item) => item.key === "write_p95_ms")?.value ?? null;

  if (emptyRecall !== null && emptyRecall >= 0.35) {
    return {
      title: t("service.dashboard.diagnosisRecallTitle"),
      summary: t("service.dashboard.diagnosisRecallSummary"),
      severity: "warning"
    };
  }

  if (conflictRate !== null && conflictRate >= 0.15) {
    return {
      title: t("service.dashboard.diagnosisMemoryQualityTitle"),
      summary: t("service.dashboard.diagnosisMemoryQualitySummary"),
      severity: "warning"
    };
  }

  if ((recallP95 ?? 0) >= 1200 || (writeP95 ?? 0) >= 1500) {
    return {
      title: t("service.dashboard.diagnosisLatencyTitle"),
      summary: t("service.dashboard.diagnosisLatencySummary"),
      severity: "warning"
    };
  }

  return {
    title: t("service.dashboard.diagnosisHealthyTitle"),
    summary: t("service.dashboard.diagnosisHealthySummary"),
    severity: "info"
  };
}

function buildDiagnosisCards(
  retrievalMetrics: DashboardMetric[],
  storageMetrics: DashboardMetric[],
  runtimeTrend: ReturnType<typeof computeRuntimeWindowTrend>,
  storageTrend: ReturnType<typeof estimateStorageTrend>,
  governanceTrend: ReturnType<typeof computeGovernanceWindowTrend>,
  degradedSources: string[],
  locale: AppLocale = "zh-CN"
) {
  const t = createTranslator(locale);
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
      t("service.dashboard.cards.emptyRecallTitle"),
      degradedSources.length > 0
        ? t("service.dashboard.cards.emptyRecallDegraded", {
            sources: joinLocalizedList(locale, degradedSources)
          })
        : emptyRecall !== null && emptyRecall >= 0.35
          ? t("service.dashboard.cards.emptyRecallWarning")
          : t("service.dashboard.cards.emptyRecallOk"),
      degradedSources.length > 0 ? "danger" : emptyRecall !== null && emptyRecall >= 0.35 ? "warning" : "info"
    ),
    diagnosisCard(
      "scope_mix",
      "cross",
      t("service.dashboard.cards.scopeMixTitle"),
      workspaceOnlyRate === 1
        ? t("service.dashboard.cards.scopeWorkspaceOnly")
        : globalShare !== null && workspaceShare !== null
          ? t("service.dashboard.cards.scopeMix", {
              global: formatMetricValue(globalShare, "percent", locale),
              workspace: formatMetricValue(workspaceShare, "percent", locale)
            })
          : t("service.dashboard.cards.scopeInsufficient"),
      workspaceOnlyRate === 1 ? "info" : globalShare !== null && globalShare > 0.6 ? "warning" : "info"
    ),
    diagnosisCard(
      "writeback_backlog",
      "storage",
      t("service.dashboard.cards.backlogTitle"),
      storageTrend.backlog.current !== null && storageTrend.backlog.current > 5
        ? t("service.dashboard.cards.backlogWarning")
        : t("service.dashboard.cards.backlogOk"),
      storageTrend.backlog.current !== null && storageTrend.backlog.current > 5 ? "warning" : "info"
    ),
    diagnosisCard(
      "conflict_pressure",
      "storage",
      t("service.dashboard.cards.conflictTitle"),
      conflictRate !== null && conflictRate >= 0.15
        ? t("service.dashboard.cards.conflictWarning")
        : t("service.dashboard.cards.conflictOk"),
      conflictRate !== null && conflictRate >= 0.15 ? "warning" : "info"
    ),
    diagnosisCard(
      "governance_execution",
      "storage",
      t("service.dashboard.cards.governanceTitle"),
      governanceRetryRate !== null && governanceRetryRate >= 0.15
        ? t("service.dashboard.cards.governanceRetryWarning")
        : governanceSuccessRate !== null && governanceSuccessRate < 0.8
          ? t("service.dashboard.cards.governanceSuccessWarning")
          : governanceTrend.recallHitRateAfterGovernance.current !== null
            ? t("service.dashboard.cards.governanceRecallHit", {
                rate: formatMetricValue(governanceTrend.recallHitRateAfterGovernance.current, "percent", locale)
              })
            : t("service.dashboard.cards.governanceOk"),
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
  const locale = await getRequestLocale();

  return getCachedValue(`dashboard:${locale}:${window}`, values.DASHBOARD_CACHE_MS, async () => {
    const [runtimeCurrent, runtimeRuns, storageCurrent, jobs, governance] = await Promise.all([
      fetchRuntimeMetrics({ locale }),
      fetchRuntimeRuns("", { locale }),
      fetchStorageMetrics({ locale }),
      fetchStorageWriteJobs({ locale }),
      fetchGovernanceExecutions({ limit: 100 }, { locale })
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
      localizedMetric("trigger_rate", runtimeCurrent.metrics?.triggerRate ?? null, "percent", "runtime", 0.7, 0.5, "lower_is_worse", locale),
      localizedMetric("recall_hit_rate", runtimeCurrent.metrics?.recallHitRate ?? null, "percent", "runtime", 0.6, 0.4, "lower_is_worse", locale),
      localizedMetric("empty_recall_rate", runtimeCurrent.metrics?.emptyRecallRate ?? null, "percent", "runtime", 0.2, 0.35, "higher_is_worse", locale),
      localizedMetric("injection_rate", runtimeCurrent.metrics?.injectionRate ?? null, "percent", "runtime", 0.45, 0.25, "lower_is_worse", locale),
      localizedMetric("trim_rate", runtimeCurrent.metrics?.trimRate ?? null, "percent", "runtime", 0.15, 0.3, "higher_is_worse", locale),
      localizedMetric("recall_p95_ms", runtimeCurrent.metrics?.recallP95Ms ?? null, "ms", "runtime", 800, 1200, "higher_is_worse", locale),
      localizedMetric("injection_p95_ms", runtimeCurrent.metrics?.injectionP95Ms ?? null, "ms", "runtime", 400, 700, "higher_is_worse", locale),
      localizedMetric("writeback_submit_rate", runtimeCurrent.metrics?.writeBackSubmitRate ?? null, "percent", "runtime", 0.25, 0.1, "lower_is_worse", locale),
      localizedMetric("runtime_outbox_pending_count", runtimeCurrent.metrics?.outboxPendingCount ?? null, "count", "runtime", 1, 5, "higher_is_worse", locale),
      localizedMetric("runtime_outbox_dead_letter_count", runtimeCurrent.metrics?.outboxDeadLetterCount ?? null, "count", "runtime", 1, 3, "higher_is_worse", locale),
      localizedMetric("global_scope_share", totalSelectedScopeHits > 0 ? globalScopeHits / totalSelectedScopeHits : null, "percent", "runtime", 0.5, 0.7, "higher_is_worse", locale),
      localizedMetric("workspace_scope_share", totalSelectedScopeHits > 0 ? workspaceScopeHits / totalSelectedScopeHits : null, "percent", "runtime", undefined, undefined, "higher_is_worse", locale),
      localizedMetric("workspace_only_rate", triggerRuns.length > 0 ? workspaceOnlyTurns / triggerRuns.length : null, "percent", "runtime", undefined, undefined, "higher_is_worse", locale)
    ];

    const storageMetrics = [
      localizedMetric("write_accepted", storageCurrent.metrics?.writeAccepted ?? null, "count", "storage", undefined, undefined, "higher_is_worse", locale),
      localizedMetric("write_succeeded", storageCurrent.metrics?.writeSucceeded ?? null, "count", "storage", undefined, undefined, "higher_is_worse", locale),
      localizedMetric("duplicate_ignored_rate", storageCurrent.metrics?.duplicateIgnoredRate ?? null, "percent", "storage", 0.25, 0.45, "higher_is_worse", locale),
      localizedMetric("merge_rate", storageCurrent.metrics?.mergeRate ?? null, "percent", "storage", undefined, undefined, "higher_is_worse", locale),
      localizedMetric("conflict_rate", storageCurrent.metrics?.conflictRate ?? null, "percent", "storage", 0.08, 0.15, "higher_is_worse", locale),
      localizedMetric("dead_letter_jobs", storageCurrent.metrics?.deadLetterJobs ?? jobs.jobs?.deadLetter ?? null, "count", "storage", 1, 5, "higher_is_worse", locale),
      localizedMetric("refresh_failure_rate", storageCurrent.metrics?.refreshFailureRate ?? null, "percent", "storage", 0.02, 0.1, "higher_is_worse", locale),
      localizedMetric("write_p95_ms", storageCurrent.metrics?.writeP95Ms ?? null, "ms", "storage", 1000, 1500, "higher_is_worse", locale),
      localizedMetric("new_pending_embedding_records", storageCurrent.metrics?.newPendingEmbeddingRecords ?? null, "count", "storage", 1, 10, "higher_is_worse", locale),
      localizedMetric("retry_pending_embedding_records", storageCurrent.metrics?.retryPendingEmbeddingRecords ?? null, "count", "storage", 1, 5, "higher_is_worse", locale),
      localizedMetric("oldest_pending_embedding_age_seconds", storageCurrent.metrics?.oldestPendingEmbeddingAgeSeconds ?? null, "count", "storage", 60, 300, "higher_is_worse", locale),
      localizedMetric("governance_proposal_count", storageCurrent.metrics?.governanceProposalCount ?? null, "count", "storage", undefined, undefined, "higher_is_worse", locale),
      localizedMetric(
        "governance_verification_pass_rate",
        ratio(storageCurrent.metrics?.governanceVerifierApprovedCount ?? 0, storageCurrent.metrics?.governanceVerifierRequiredCount ?? 0),
        "percent",
        "storage",
        0.8,
        0.6,
        "lower_is_worse",
        locale
      ),
      localizedMetric(
        "governance_execution_success_rate",
        ratio(storageCurrent.metrics?.governanceExecutionSuccessCount ?? 0, storageCurrent.metrics?.governanceExecutionCount ?? 0),
        "percent",
        "storage",
        0.8,
        0.6,
        "lower_is_worse",
        locale
      ),
      localizedMetric(
        "governance_soft_delete_rate",
        ratio(storageCurrent.metrics?.governanceSoftDeleteCount ?? 0, storageCurrent.metrics?.governanceExecutionCount ?? 0),
        "percent",
        "storage",
        0.2,
        0.4,
        "higher_is_worse",
        locale
      ),
      localizedMetric(
        "governance_retry_rate",
        ratio(storageCurrent.metrics?.governanceRetryCount ?? 0, storageCurrent.metrics?.governanceExecutionCount ?? 0),
        "percent",
        "storage",
        0.05,
        0.15,
        "higher_is_worse",
        locale
      ),
      localizedMetric("governance_recall_hit_rate_after", governanceTrend.recallHitRateAfterGovernance.current, "percent", "storage", undefined, undefined, "higher_is_worse", locale)
    ];

    const trends = [
      localizedTrend("empty_recall_shift", "runtime", "percent", runtimeTrend.emptyRecall, window, 0.2, 0.35, "higher_is_worse", locale),
      localizedTrend("writeback_backlog", "storage", "count", storageTrend.backlog, window, 5, 10, "higher_is_worse", locale),
      localizedTrend("conflict_spike", "storage", "count", storageTrend.conflict, window, 1, 3, "higher_is_worse", locale),
      localizedTrend("runtime_vs_storage_latency", "runtime", "ms", runtimeTrend.recallLatency, window, 800, 1200, "higher_is_worse", locale),
      localizedTrend("scope_mix_shift", "runtime", "percent", runtimeTrend.globalScopeShare, window, 0.5, 0.7, "higher_is_worse", locale),
      localizedTrend("governance_proposal_volume", "storage", "count", governanceTrend.proposalVolume, window, undefined, undefined, "higher_is_worse", locale),
      localizedTrend("governance_verification_pass_rate", "storage", "percent", governanceTrend.verificationPassRate, window, 0.8, 0.6, "lower_is_worse", locale),
      localizedTrend("governance_execution_success_rate", "storage", "percent", governanceTrend.executionSuccessRate, window, 0.8, 0.6, "lower_is_worse", locale),
      localizedTrend("governance_retry_rate", "storage", "percent", governanceTrend.retryRate, window, 0.05, 0.15, "higher_is_worse", locale),
      localizedTrend("governance_recall_hit_rate_after", "storage", "percent", governanceTrend.recallHitRateAfterGovernance, window, 0.5, 0.3, "lower_is_worse", locale)
    ];

    const sourceStatus = [runtimeCurrent.status, storageCurrent.status, jobs.status, governance.status];
    const degradedSources = sourceStatus
      .filter((source) => source.status !== "healthy")
      .map((source) => source.label);

    return {
      retrievalMetrics,
      storageMetrics,
      trendWindow: window,
      diagnosis: buildDashboardDiagnosis(retrievalMetrics, storageMetrics, degradedSources, locale),
      diagnosisCards: buildDiagnosisCards(
        retrievalMetrics,
        storageMetrics,
        runtimeTrend,
        storageTrend,
        governanceTrend,
        degradedSources,
        locale
      ),
      trends,
      sourceStatus
    };
  });
}

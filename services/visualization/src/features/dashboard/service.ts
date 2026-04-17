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
    return "Unavailable";
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
      title: "Dependency issue dominates",
      summary: `One or more upstream sources are degraded: ${degradedSources.join(", ")}.`,
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
        "Empty recall rate is high while sources are healthy, which usually points to overly narrow trigger or scope selection.",
      severity: "warning"
    };
  }

  if (conflictRate !== null && conflictRate >= 0.15) {
    return {
      title: "Stored memory quality is drifting",
      summary:
        "Conflict rate is elevated, which usually indicates overlapping write-back candidates or missing merge rules.",
      severity: "warning"
    };
  }

  if ((recallP95 ?? 0) >= 1200 || (writeP95 ?? 0) >= 1500) {
    return {
      title: "Latency is the primary issue",
      summary:
        "P95 latency has moved above the target envelope, so the user-facing symptom is likely slowness rather than policy drift.",
      severity: "warning"
    };
  }

  return {
    title: "No dominant anomaly detected",
    summary:
      "Current metrics do not point to a single major failure mode. Check the trend section and source health for localized regressions.",
    severity: "info"
  };
}

function buildDiagnosisCards(
  retrievalMetrics: DashboardMetric[],
  storageMetrics: DashboardMetric[],
  runtimeTrend: ReturnType<typeof computeRuntimeWindowTrend>,
  storageTrend: ReturnType<typeof estimateStorageTrend>,
  degradedSources: string[]
) {
  const emptyRecall = retrievalMetrics.find((item) => item.key === "empty_recall_rate")?.value ?? null;
  const conflictRate = storageMetrics.find((item) => item.key === "conflict_rate")?.value ?? null;
  const workspaceOnlyRate = retrievalMetrics.find((item) => item.key === "workspace_only_rate")?.value ?? null;
  const globalShare = retrievalMetrics.find((item) => item.key === "global_scope_share")?.value ?? null;
  const workspaceShare = retrievalMetrics.find((item) => item.key === "workspace_scope_share")?.value ?? null;

  return [
    diagnosisCard(
      "empty_recall_trend",
      "runtime",
      "Empty recall trend",
      degradedSources.length > 0
        ? `Runtime source is degraded: ${degradedSources.join(", ")}.`
        : emptyRecall !== null && emptyRecall >= 0.35
          ? "Recent recalls are frequently returning empty. Check current trigger rules and scope selection."
          : "Empty recall remains within the current expected range.",
      degradedSources.length > 0 ? "danger" : emptyRecall !== null && emptyRecall >= 0.35 ? "warning" : "info"
    ),
    diagnosisCard(
      "scope_mix",
      "cross",
      "Global / workspace usage",
      workspaceOnlyRate === 1
        ? "Recent turns stayed in workspace-only mode, so global memory should not appear."
        : globalShare !== null && workspaceShare !== null
          ? `Recent selected scope share is global ${formatMetricValue(globalShare, "percent")} and workspace ${formatMetricValue(workspaceShare, "percent")}.`
          : "Runtime has not yet exposed enough scope data, so this card is using partial scope signals.",
      workspaceOnlyRate === 1 ? "info" : globalShare !== null && globalShare > 0.6 ? "warning" : "info"
    ),
    diagnosisCard(
      "writeback_backlog",
      "storage",
      "Write-back backlog",
      storageTrend.backlog.current !== null && storageTrend.backlog.current > 5
        ? "Queued and processing storage jobs are building up in the current half-window."
        : "No obvious backlog growth is visible in recent write-back jobs.",
      storageTrend.backlog.current !== null && storageTrend.backlog.current > 5 ? "warning" : "info"
    ),
    diagnosisCard(
      "conflict_pressure",
      "storage",
      "Conflict pressure",
      conflictRate !== null && conflictRate >= 0.15
        ? "Conflict rate is elevated. Governance or merge rules may need attention."
        : "Conflict pressure is currently stable.",
      conflictRate !== null && conflictRate >= 0.15 ? "warning" : "info"
    )
  ];
}

export async function getDashboard(window: string): Promise<DashboardResponse> {
  const { values } = getAppConfig();

  return getCachedValue(`dashboard:${window}`, values.DASHBOARD_CACHE_MS, async () => {
    const [runtimeCurrent, runtimeRuns, storageCurrent, jobs] = await Promise.all([
      fetchRuntimeMetrics(),
      fetchRuntimeRuns(""),
      fetchStorageMetrics(),
      fetchStorageWriteJobs()
    ]);

    const runtimeTrend = computeRuntimeWindowTrend(window, runtimeRuns.data);
    const storageTrend = estimateStorageTrend(window, jobs.jobs);

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
        "Trigger rate",
        runtimeCurrent.metrics?.triggerRate ?? null,
        "percent",
        "runtime",
        "Share of turns that triggered retrieval.",
        0.7,
        0.9
      ),
      metric(
        "recall_hit_rate",
        "Recall hit rate",
        runtimeCurrent.metrics?.recallHitRate ?? null,
        "percent",
        "runtime",
        "Share of triggered recalls that found at least one record."
      ),
      metric(
        "empty_recall_rate",
        "Empty recall rate",
        runtimeCurrent.metrics?.emptyRecallRate ?? null,
        "percent",
        "runtime",
        "Share of triggered recalls that returned zero eligible records.",
        0.2,
        0.35
      ),
      metric(
        "injection_rate",
        "Actual injection rate",
        runtimeCurrent.metrics?.injectionRate ?? null,
        "percent",
        "runtime",
        "Share of turns where a memory block actually entered the prompt."
      ),
      metric(
        "trim_rate",
        "Injection trim rate",
        runtimeCurrent.metrics?.trimRate ?? null,
        "percent",
        "runtime",
        "Share of injections that dropped records due to token budget.",
        0.15,
        0.3
      ),
      metric(
        "recall_p95_ms",
        "Recall P95",
        runtimeCurrent.metrics?.recallP95Ms ?? null,
        "ms",
        "runtime",
        "P95 latency for runtime recall queries.",
        800,
        1200
      ),
      metric(
        "injection_p95_ms",
        "Injection P95",
        runtimeCurrent.metrics?.injectionP95Ms ?? null,
        "ms",
        "runtime",
        "P95 latency for injection block generation.",
        400,
        700
      ),
      metric(
        "writeback_submit_rate",
        "Write-back submit rate",
        runtimeCurrent.metrics?.writeBackSubmitRate ?? null,
        "percent",
        "runtime",
        "Share of turns that produced a submitted write-back candidate."
      ),
      metric(
        "global_scope_share",
        "Global memory share",
        totalSelectedScopeHits > 0 ? globalScopeHits / totalSelectedScopeHits : null,
        "percent",
        "runtime",
        "Share of recent recall hits that came from global memory.",
        0.5,
        0.7
      ),
      metric(
        "workspace_scope_share",
        "Workspace memory share",
        totalSelectedScopeHits > 0 ? workspaceScopeHits / totalSelectedScopeHits : null,
        "percent",
        "runtime",
        "Share of recent recall hits that came from workspace memory."
      ),
      metric(
        "workspace_only_rate",
        "Workspace-only mode rate",
        triggerRuns.length > 0 ? workspaceOnlyTurns / triggerRuns.length : null,
        "percent",
        "runtime",
        "Share of recent turns that ran in workspace-only mode."
      )
    ];

    const storageMetrics = [
      metric(
        "write_accepted",
        "Writes accepted",
        storageCurrent.metrics?.writeAccepted ?? null,
        "count",
        "storage",
        "Accepted write-back jobs in the selected window."
      ),
      metric(
        "write_succeeded",
        "Writes succeeded",
        storageCurrent.metrics?.writeSucceeded ?? null,
        "count",
        "storage",
        "Write-back jobs that finished successfully."
      ),
      metric(
        "duplicate_ignored_rate",
        "Duplicate ignored rate",
        storageCurrent.metrics?.duplicateIgnoredRate ?? null,
        "percent",
        "storage",
        "Share of write-back candidates ignored as duplicates.",
        0.25,
        0.45
      ),
      metric(
        "merge_rate",
        "Merge rate",
        storageCurrent.metrics?.mergeRate ?? null,
        "percent",
        "storage",
        "Share of writes merged into an existing record."
      ),
      metric(
        "conflict_rate",
        "Conflict rate",
        storageCurrent.metrics?.conflictRate ?? null,
        "percent",
        "storage",
        "Share of writes that ended in pending confirmation or conflict.",
        0.08,
        0.15
      ),
      metric(
        "dead_letter_jobs",
        "Dead-letter jobs",
        storageCurrent.metrics?.deadLetterJobs ?? jobs.jobs?.deadLetter ?? null,
        "count",
        "storage",
        "Jobs that exhausted retries and moved to dead letter.",
        1,
        5
      ),
      metric(
        "refresh_failure_rate",
        "Read model refresh failure rate",
        storageCurrent.metrics?.refreshFailureRate ?? null,
        "percent",
        "storage",
        "Share of read model refresh jobs that failed.",
        0.02,
        0.1
      ),
      metric(
        "write_p95_ms",
        "Write P95",
        storageCurrent.metrics?.writeP95Ms ?? null,
        "ms",
        "storage",
        "P95 latency for storage-side write processing.",
        1000,
        1500
      )
    ];

    const trends = [
      buildTrend(
        "empty_recall_shift",
        "Empty recalls over time",
        "Use this to see whether recalls recently started returning empty more often.",
        "runtime",
        "percent",
        runtimeTrend.emptyRecall,
        window,
        0.2,
        0.35
      ),
      buildTrend(
        "writeback_backlog",
        "Write-back backlog",
        "Compare queued and processing jobs across the current and previous half-window.",
        "storage",
        "count",
        storageTrend.backlog,
        window,
        5,
        10
      ),
      buildTrend(
        "conflict_spike",
        "Conflict pressure",
        "Shows whether recent write-back work is opening more conflicts than the previous half-window.",
        "storage",
        "count",
        storageTrend.conflict,
        window,
        1,
        3
      ),
      buildTrend(
        "runtime_vs_storage_latency",
        "Runtime recall latency",
        "If runtime recall latency rises while storage write latency stays flat, the slowdown is more likely on retrieval strategy or retrieval dependencies.",
        "runtime",
        "ms",
        runtimeTrend.recallLatency,
        window,
        800,
        1200
      ),
      buildTrend(
        "scope_mix_shift",
        "Global memory share",
        "Tracks whether recent recalls are leaning toward global memory or staying mostly inside the workspace boundary.",
        "runtime",
        "percent",
        runtimeTrend.globalScopeShare,
        window,
        0.5,
        0.7
      )
    ];

    const sourceStatus = [runtimeCurrent.status, storageCurrent.status, jobs.status];
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
        degradedSources
      ),
      trends,
      sourceStatus
    };
  });
}

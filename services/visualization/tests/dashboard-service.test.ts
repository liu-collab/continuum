import { describe, expect, it } from "vitest";

import {
  buildDashboardDiagnosis,
  computeRuntimeWindowTrend,
  estimateStorageTrend,
  getDashboard
} from "@/features/dashboard/service";
import { DashboardMetric } from "@/lib/contracts";

import { vi } from "vitest";

const {
  fetchRuntimeMetricsMock,
  fetchRuntimeRunsMock,
  fetchStorageMetricsMock,
  fetchStorageWriteJobsMock
} = vi.hoisted(() => ({
  fetchRuntimeMetricsMock: vi.fn<() => Promise<any>>(),
  fetchRuntimeRunsMock: vi.fn<() => Promise<any>>(),
  fetchStorageMetricsMock: vi.fn<() => Promise<any>>(),
  fetchStorageWriteJobsMock: vi.fn<() => Promise<any>>()
}));

fetchRuntimeMetricsMock.mockImplementation(async () => ({
  status: {
    name: "runtime_api",
    label: "Runtime observe API",
    kind: "dependency",
    status: "healthy",
    checkedAt: "2026-04-16T00:00:00Z",
    lastCheckedAt: "2026-04-16T00:00:00Z",
    lastOkAt: "2026-04-16T00:00:00Z",
    lastError: null,
    responseTimeMs: 25,
    detail: null
  },
  metrics: {
    triggerRate: 0.8,
    recallHitRate: 0.7,
    emptyRecallRate: 0.1,
    injectionRate: 0.6,
    trimRate: 0.1,
    recallP95Ms: 200,
    injectionP95Ms: 50,
    writeBackSubmitRate: 0.4,
    outboxPendingCount: 1,
    outboxDeadLetterCount: 0,
    outboxSubmitLatencyMs: 25
  }
}));

fetchRuntimeRunsMock.mockImplementation(async () => ({
  status: {
    name: "runtime_api",
    label: "Runtime observe API",
    kind: "dependency",
    status: "healthy",
    checkedAt: "2026-04-16T00:00:00Z",
    lastCheckedAt: "2026-04-16T00:00:00Z",
    lastOkAt: "2026-04-16T00:00:00Z",
    lastError: null,
    responseTimeMs: 25,
    detail: null
  },
  data: {
    turns: [],
    triggerRuns: [],
    recallRuns: [],
    injectionRuns: [],
    writeBackRuns: [],
    dependencyStatus: []
  }
}));

fetchStorageMetricsMock.mockImplementation(async () => ({
  status: {
    name: "storage_api",
    label: "Storage observe API",
    kind: "dependency",
    status: "healthy",
    checkedAt: "2026-04-16T00:00:00Z",
    lastCheckedAt: "2026-04-16T00:00:00Z",
    lastOkAt: "2026-04-16T00:00:00Z",
    lastError: null,
    responseTimeMs: 30,
    detail: null
  },
  metrics: {
    writeAccepted: 10,
    writeSucceeded: 8,
    duplicateIgnoredRate: 0.1,
    mergeRate: 0.2,
    conflictRate: 0.05,
    deadLetterJobs: 0,
    refreshFailureRate: 0.01,
    writeP95Ms: 220,
    newPendingEmbeddingRecords: 1,
    retryPendingEmbeddingRecords: 2,
    oldestPendingEmbeddingAgeSeconds: 180
  }
}));

fetchStorageWriteJobsMock.mockImplementation(async () => ({
  status: {
    name: "storage_write_jobs",
    label: "Storage write jobs",
    kind: "dependency",
    status: "healthy",
    checkedAt: "2026-04-16T00:00:00Z",
    lastCheckedAt: "2026-04-16T00:00:00Z",
    lastOkAt: "2026-04-16T00:00:00Z",
    lastError: null,
    responseTimeMs: 30,
    detail: null
  },
  jobs: {
    queued: 0,
    processing: 0,
    failed: 0,
    deadLetter: 0,
    items: []
  }
}));

vi.mock("@/lib/cache", () => ({
  getCachedValue: (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()
}));

vi.mock("@/lib/env", () => ({
  getAppConfig: () => ({
    values: {
      DASHBOARD_CACHE_MS: 1000
    }
  })
}));

vi.mock("@/lib/server/runtime-observe-client", () => ({
  fetchRuntimeMetrics: fetchRuntimeMetricsMock,
  fetchRuntimeRuns: fetchRuntimeRunsMock
}));

vi.mock("@/lib/server/storage-observe-client", () => ({
  fetchStorageMetrics: fetchStorageMetricsMock,
  fetchStorageWriteJobs: fetchStorageWriteJobsMock
}));

function createMetric(key: string, value: number | null): DashboardMetric {
  return {
    key,
    label: key,
    value,
    unit: "percent",
    description: key,
    source: key.includes("write") ? "storage" : "runtime",
    severity: "normal",
    formattedValue: String(value)
  };
}

describe("dashboard diagnosis", () => {
  it("prioritizes degraded sources", () => {
    const diagnosis = buildDashboardDiagnosis([], [], ["Runtime observe API"]);

    expect(diagnosis.severity).toBe("danger");
    expect(diagnosis.summary).toContain("Runtime observe API");
  });

  it("detects recall strategy issue", () => {
    const diagnosis = buildDashboardDiagnosis(
      [createMetric("empty_recall_rate", 0.41)],
      [],
      []
    );

    expect(diagnosis.title).toContain("Recall strategy");
  });

  it("falls back to no dominant anomaly", () => {
    const diagnosis = buildDashboardDiagnosis(
      [createMetric("empty_recall_rate", 0.1), createMetric("recall_p95_ms", 200)],
      [createMetric("conflict_rate", 0.02), createMetric("write_p95_ms", 300)],
      []
    );

    expect(diagnosis.severity).toBe("info");
  });
});

describe("dashboard trend aggregation", () => {
  it("aggregates runtime trends by window", () => {
    const now = Date.now();
    const current = new Date(now - 5 * 60_000).toISOString();
    const previous = new Date(now - 20 * 60_000).toISOString();

    const trend = computeRuntimeWindowTrend("30m", {
      turns: [],
      triggerRuns: [
        {
          traceId: "trace-current",
          triggerHit: true,
          triggerType: "history_reference",
          triggerReason: "reason",
          memoryMode: "workspace_plus_global",
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: ["workspace", "user"],
          scopeDecision: "Selected workspace and global scope.",
          scopeLimit: ["user"],
          importanceThreshold: 3,
          cooldownApplied: false,
          semanticScore: null,
          durationMs: 5,
          createdAt: current
        },
        {
          traceId: "trace-previous",
          triggerHit: true,
          triggerType: "history_reference",
          triggerReason: "reason",
          memoryMode: "workspace_plus_global",
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: ["workspace", "user"],
          scopeDecision: "Selected workspace and global scope.",
          scopeLimit: ["user"],
          importanceThreshold: 3,
          cooldownApplied: false,
          semanticScore: null,
          durationMs: 5,
          createdAt: previous
        }
      ],
      recallRuns: [
        {
          traceId: "trace-current",
          triggerHit: true,
          triggerType: "history_reference",
          triggerReason: "reason",
          memoryMode: "workspace_plus_global",
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: [],
          scopeHitCounts: [],
          selectedRecordIds: [],
          queryScope: "scope=user",
          candidateCount: 1,
          selectedCount: 0,
          resultState: "empty",
          emptyReason: "No records matched.",
          degraded: false,
          degradationReason: null,
          durationMs: 1400,
          createdAt: current
        },
        {
          traceId: "trace-previous",
          triggerHit: true,
          triggerType: "history_reference",
          triggerReason: "reason",
          memoryMode: "workspace_plus_global",
          requestedTypes: ["fact_preference"],
          requestedScopes: ["workspace", "user"],
          selectedScopes: ["user"],
          scopeHitCounts: [{ scope: "user", count: 1 }],
          selectedRecordIds: ["memory-1"],
          queryScope: "scope=user",
          candidateCount: 1,
          selectedCount: 1,
          resultState: "matched",
          emptyReason: null,
          degraded: false,
          degradationReason: null,
          durationMs: 200,
          createdAt: previous
        }
      ],
      injectionRuns: [],
      writeBackRuns: [],
      dependencyStatus: []
    });

    expect(trend.emptyRecall.current).toBe(1);
    expect(trend.emptyRecall.previous).toBe(0);
    expect(trend.recallLatency.current).toBe(1400);
    expect(trend.recallLatency.previous).toBe(200);
  });

  it("aggregates storage backlog and conflict pressure", () => {
    const now = Date.now();
    const current = new Date(now - 2 * 60_000).toISOString();
    const previous = new Date(now - 20 * 60_000).toISOString();

    const trend = estimateStorageTrend("30m", {
      queued: 1,
      processing: 1,
      failed: 0,
      deadLetter: 0,
      items: [
        {
          id: "job-current",
          status: "queued",
          resultStatus: "open_conflict",
          receivedAt: current,
          startedAt: null,
          finishedAt: null,
          errorMessage: null
        },
        {
          id: "job-previous",
          status: "processing",
          resultStatus: null,
          receivedAt: previous,
          startedAt: null,
          finishedAt: null,
          errorMessage: null
        }
      ]
    });

    expect(trend.backlog.current).toBe(1);
    expect(trend.backlog.previous).toBe(1);
    expect(trend.conflict.current).toBe(1);
    expect(trend.conflict.previous).toBe(0);
  });
});

describe("dashboard window selection", () => {
  it("keeps the requested 1h trend window", async () => {
    const result = await getDashboard("1h");
    expect(result.trendWindow).toBe("1h");
  });

  it("keeps the requested 24h trend window", async () => {
    const result = await getDashboard("24h");
    expect(result.trendWindow).toBe("24h");
  });

  it("includes runtime outbox and storage pending embedding metrics", async () => {
    const result = await getDashboard("30m");

    expect(result.retrievalMetrics.some((item) => item.key === "runtime_outbox_pending_count")).toBe(true);
    expect(result.storageMetrics.some((item) => item.key === "new_pending_embedding_records")).toBe(true);
    expect(result.storageMetrics.some((item) => item.key === "oldest_pending_embedding_age_seconds")).toBe(true);
  });

  it("does not fetch runtime or storage metrics twice for trend comparison", async () => {
    fetchRuntimeMetricsMock.mockClear();
    fetchStorageMetricsMock.mockClear();

    await getDashboard("30m");

    expect(fetchRuntimeMetricsMock).toHaveBeenCalledTimes(1);
    expect(fetchStorageMetricsMock).toHaveBeenCalledTimes(1);
  });
});

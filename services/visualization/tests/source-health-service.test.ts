import { describe, expect, it, vi, beforeEach } from "vitest";

import { SourceStatus } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  pingMemoryReadModel: vi.fn<() => Promise<SourceStatus>>(async () => ({
    name: "storage_read_model",
    label: "Storage read model",
    kind: "dependency",
    status: "unavailable",
    checkedAt: "2026-04-15T12:00:00.000Z",
    lastCheckedAt: "2026-04-15T12:00:00.000Z",
    lastOkAt: null,
    lastError: "database offline",
    responseTimeMs: 120,
    detail: "database offline"
  })),
  fetchStorageMetrics: vi.fn<() => Promise<{ status: SourceStatus }>>(async () => ({
    status: {
      name: "storage_api",
      label: "Storage observe API",
      kind: "dependency",
      status: "healthy",
      checkedAt: "2026-04-15T12:00:00.000Z",
      lastCheckedAt: "2026-04-15T12:00:00.000Z",
      lastOkAt: "2026-04-15T12:00:00.000Z",
      lastError: null,
      responseTimeMs: 40,
      detail: null
    }
  })),
  fetchRuntimeMetrics: vi.fn<() => Promise<{ status: SourceStatus }>>(async () => ({
    status: {
      name: "runtime_api",
      label: "Runtime observe API",
      kind: "dependency",
      status: "timeout",
      checkedAt: "2026-04-15T12:00:00.000Z",
      lastCheckedAt: "2026-04-15T12:00:00.000Z",
      lastOkAt: null,
      lastError: "timeout",
      responseTimeMs: 2000,
      detail: "timeout"
    }
  }))
}));

vi.mock("@/lib/cache", () => ({
  getCachedValue: (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()
}));

vi.mock("@/lib/env", () => ({
  getAppConfig: () => ({
    values: {
      SOURCE_HEALTH_CACHE_MS: 1000
    }
  })
}));

vi.mock("@/lib/server/storage-read-model-client", () => ({
  pingMemoryReadModel: mocks.pingMemoryReadModel
}));

vi.mock("@/lib/server/storage-observe-client", () => ({
  fetchStorageMetrics: mocks.fetchStorageMetrics
}));

vi.mock("@/lib/server/runtime-observe-client", () => ({
  fetchRuntimeMetrics: mocks.fetchRuntimeMetrics
}));

import { getSourceHealth } from "@/features/source-health/service";

describe("source health separation", () => {
  beforeEach(() => {
    mocks.pingMemoryReadModel.mockClear();
    mocks.fetchStorageMetrics.mockClear();
    mocks.fetchRuntimeMetrics.mockClear();
  });

  it("keeps readiness ready when dependencies degrade", async () => {
    const health = await getSourceHealth();

    expect(health.liveness.status).toBe("ok");
    expect(health.readiness.status).toBe("ready");
    expect(health.dependencies.some((item) => item.status !== "healthy")).toBe(true);
  });

  it("preserves lastOkAt from dependency probes", async () => {
    mocks.fetchRuntimeMetrics.mockResolvedValueOnce({
      status: {
        name: "runtime_api",
        label: "Runtime observe API",
        kind: "dependency",
        status: "timeout",
        checkedAt: "2026-04-16T00:10:00.000Z",
        lastCheckedAt: "2026-04-16T00:10:00.000Z",
        lastOkAt: "2026-04-16T00:05:00.000Z",
        lastError: "timeout",
        responseTimeMs: 2000,
        detail: "timeout"
      }
    });

    const health = await getSourceHealth();
    const runtime = health.dependencies.find((item) => item.name === "runtime_api");

    expect(runtime?.lastOkAt).toBe("2026-04-16T00:05:00.000Z");
    expect(runtime?.lastCheckedAt).toBe("2026-04-16T00:10:00.000Z");
  });
});

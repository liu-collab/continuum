"use client";

import {
  DashboardResponse,
  DashboardResponseSchema,
  MemoryCatalogFilters,
  MemoryCatalogResponse,
  MemoryCatalogResponseSchema,
  RunTraceFilters,
  RunTraceResponse,
  RunTraceResponseSchema,
  ServiceHealthResponse,
  ServiceHealthResponseSchema
} from "@/lib/contracts";
import { buildQueryString, toMemoryCatalogQuery, toRunTraceQuery } from "@/lib/query-params";

async function fetchInternalJson<T>(path: string, schema: { parse: (value: unknown) => T }) {
  const response = await fetch(path, {
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      typeof json === "object" && json !== null && "error" in json && typeof json.error === "string"
        ? json.error
        : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return schema.parse(json);
}

export function fetchMemories(filters: MemoryCatalogFilters): Promise<MemoryCatalogResponse> {
  return fetchInternalJson(`/api/memories?${toMemoryCatalogQuery(filters)}`, MemoryCatalogResponseSchema);
}

export function fetchRuns(filters: RunTraceFilters): Promise<RunTraceResponse> {
  return fetchInternalJson(`/api/runs?${toRunTraceQuery(filters)}`, RunTraceResponseSchema);
}

export function fetchDashboard(window: string): Promise<DashboardResponse> {
  return fetchInternalJson(
    `/api/dashboard?${buildQueryString({ window })}`,
    DashboardResponseSchema
  );
}

export function fetchSourceHealth(): Promise<ServiceHealthResponse> {
  return fetchInternalJson(`/api/sources/health`, ServiceHealthResponseSchema);
}

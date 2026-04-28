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
import { createTranslator, resolveAppLocale } from "@/lib/i18n/messages";
import { buildQueryString, toMemoryCatalogQuery, toRunTraceQuery } from "@/lib/query-params";

async function fetchInternalJson<T>(path: string, schema: { parse: (value: unknown) => T }) {
  const response = await fetch(path, {
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const t = createTranslator(resolveAppLocale(typeof navigator === "undefined" ? null : navigator.language));
    const error =
      typeof json === "object" && json !== null && "error" in json
        ? (json.error as unknown)
        : null;
    const message =
      typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
          ? error.message
        : t("common.requestFailedStatus", { status: response.status });

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

import "server-only";

import type { SourceStatus } from "@/lib/contracts";
import { getAppConfig } from "@/lib/env";
import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";
import { asRecord, pickArray, pickBoolean, pickNullableString, pickNumber, pickString } from "@/lib/records";
import { fetchJsonFromSource } from "@/lib/server/http-client";

export type LiteRuntimeRecord = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  task_id: string | null;
  session_id: string | null;
  memory_type: string;
  scope: string;
  status: string;
  summary: string;
  details: Record<string, unknown> | null;
  source: Record<string, unknown> | null;
  importance: number | null;
  confidence: number | null;
  dedupe_key?: string;
  last_confirmed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type LiteRuntimeMemoryResult = {
  rows: LiteRuntimeRecord[];
  total: number;
  status: SourceStatus;
};

export type LiteRuntimeTraceResult = {
  payload: unknown | null;
  status: SourceStatus;
};

export type LiteMemoryModelStatus = {
  configured: boolean;
  status: string;
  baseUrl?: string;
  model?: string;
  protocol?: string;
  timeoutMs?: number;
  apiKeyConfigured?: boolean;
  degraded?: boolean;
  degradationReason?: string;
};

export type LiteRuntimeHealthResult = {
  health: unknown | null;
  memoryModelStatus: LiteMemoryModelStatus | null;
  status: SourceStatus;
};

export type LiteMemoryQuery = {
  workspaceId?: string;
  userId?: string;
  taskId?: string;
  sessionId?: string;
  memoryType?: string;
  scope?: string;
  status?: string;
  memoryViewMode?: string;
  page?: number;
  pageSize?: number;
};

export function isLiteRuntimeConfigured() {
  const { values } = getAppConfig();
  return Boolean(values.LITE_RUNTIME_API_BASE_URL);
}

export function shouldUseLiteRuntimeCatalog() {
  const { values } = getAppConfig();
  return Boolean(values.LITE_RUNTIME_API_BASE_URL && !values.STORAGE_READ_MODEL_DSN);
}

export async function fetchLiteRuntimeHealth(
  options: { locale?: AppLocale } = {}
): Promise<LiteRuntimeHealthResult> {
  const { values } = getAppConfig();
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const t = createTranslator(locale);
  const response = await fetchJsonFromSource<unknown>({
    sourceName: "lite_runtime",
    sourceLabel: "Lite runtime",
    url: values.LITE_RUNTIME_API_BASE_URL
      ? `${values.LITE_RUNTIME_API_BASE_URL.replace(/\/+$/, "")}/v1/lite/healthz`
      : undefined,
    timeoutMs: values.RUNTIME_API_TIMEOUT_MS,
    locale,
  });

  if (!response.ok || !response.data) {
    return {
      health: null,
      memoryModelStatus: null,
      status: response.status,
    };
  }

  const root = asRecord(response.data);
  return {
    health: response.data,
    memoryModelStatus: mapMemoryModelStatus(root?.memory_model_status),
    status: {
      ...response.status,
      detail: root?.mode === "lite" ? null : t("service.upstream.nonObjectPayload"),
    },
  };
}

export async function fetchLiteRuntimeMemories(
  query: LiteMemoryQuery,
  options: { locale?: AppLocale } = {}
): Promise<LiteRuntimeMemoryResult> {
  const { values } = getAppConfig();
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const params = new URLSearchParams();
  setParam(params, "workspace_id", query.workspaceId);
  setParam(params, "user_id", query.userId);
  setParam(params, "task_id", query.taskId);
  setParam(params, "session_id", query.sessionId);
  setParam(params, "memory_type", query.memoryType);
  setParam(params, "scope", query.scope);
  setParam(params, "status", query.status);
  setParam(params, "memory_view_mode", query.memoryViewMode);
  setParam(params, "page", query.page);
  setParam(params, "page_size", query.pageSize);

  const response = await fetchJsonFromSource<unknown>({
    sourceName: "lite_runtime",
    sourceLabel: "Lite runtime",
    url: values.LITE_RUNTIME_API_BASE_URL
      ? `${values.LITE_RUNTIME_API_BASE_URL.replace(/\/+$/, "")}/v1/lite/memories${params.size ? `?${params.toString()}` : ""}`
      : undefined,
    timeoutMs: values.RUNTIME_API_TIMEOUT_MS,
    locale,
  });

  if (!response.ok || !response.data) {
    return {
      rows: [],
      total: 0,
      status: response.status,
    };
  }

  const root = asRecord(response.data);
  return {
    rows: pickArray(root ?? {}, "items").map(mapLiteRecord).filter(isDefined),
    total: pickNumber(root ?? {}, "total") ?? 0,
    status: response.status,
  };
}

export async function fetchLiteRuntimeMemoryById(
  id: string,
  options: { locale?: AppLocale } = {}
): Promise<{ row: LiteRuntimeRecord | null; status: SourceStatus }> {
  const { values } = getAppConfig();
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const response = await fetchJsonFromSource<unknown>({
    sourceName: "lite_runtime",
    sourceLabel: "Lite runtime",
    url: values.LITE_RUNTIME_API_BASE_URL
      ? `${values.LITE_RUNTIME_API_BASE_URL.replace(/\/+$/, "")}/v1/lite/memories/${encodeURIComponent(id)}`
      : undefined,
    timeoutMs: values.RUNTIME_API_TIMEOUT_MS,
    locale,
  });

  return {
    row: response.ok && response.data ? mapLiteRecord(response.data) : null,
    status: response.status,
  };
}

export async function fetchLiteRuntimeTraces(
  options: { locale?: AppLocale } = {}
): Promise<LiteRuntimeTraceResult> {
  const { values } = getAppConfig();
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const response = await fetchJsonFromSource<unknown>({
    sourceName: "lite_runtime",
    sourceLabel: "Lite runtime",
    url: values.LITE_RUNTIME_API_BASE_URL
      ? `${values.LITE_RUNTIME_API_BASE_URL.replace(/\/+$/, "")}/v1/lite/traces`
      : undefined,
    timeoutMs: values.RUNTIME_API_TIMEOUT_MS,
    locale,
  });

  return {
    payload: response.ok ? response.data : null,
    status: response.status,
  };
}

function setParam(params: URLSearchParams, name: string, value: string | number | undefined) {
  if (value !== undefined && value !== "") {
    params.set(name, String(value));
  }
}

function mapLiteRecord(value: unknown): LiteRuntimeRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = pickString(record, "id");
  const memoryType = pickString(record, "memory_type", "memoryType");
  const scope = pickString(record, "scope");
  const status = pickString(record, "status");
  const summary = pickString(record, "summary");
  if (!id || !memoryType || !scope || !status || !summary) {
    return null;
  }

  return {
    id,
    workspace_id: pickNullableString(record, "workspace_id", "workspaceId"),
    user_id: pickNullableString(record, "user_id", "userId"),
    task_id: pickNullableString(record, "task_id", "taskId"),
    session_id: pickNullableString(record, "session_id", "sessionId"),
    memory_type: memoryType,
    scope,
    status,
    summary,
    details: asRecord(record.details) ?? null,
    source: buildLiteSource(record),
    importance: pickNumber(record, "importance") ?? null,
    confidence: pickNumber(record, "confidence") ?? null,
    ...(pickString(record, "dedupe_key", "dedupeKey") ? { dedupe_key: pickString(record, "dedupe_key", "dedupeKey") } : {}),
    last_confirmed_at: pickNullableString(record, "last_confirmed_at", "lastConfirmedAt"),
    created_at: pickNullableString(record, "created_at", "createdAt"),
    updated_at: pickNullableString(record, "updated_at", "updatedAt"),
  };
}

function buildLiteSource(record: Record<string, unknown>) {
  const details = asRecord(record.details) ?? {};
  const sourceType = pickString(details, "source_type") ?? "lite_runtime";
  const sourceRef = pickString(details, "source_ref") ?? pickString(record, "id") ?? "lite";
  return {
    source_type: sourceType,
    source_ref: sourceRef,
    service_name: "lite-runtime",
    ...(pickString(record, "workspace_id", "workspaceId")
      ? { origin_workspace_id: pickString(record, "workspace_id", "workspaceId") }
      : {}),
  };
}

function mapMemoryModelStatus(value: unknown): LiteMemoryModelStatus | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    configured: pickBoolean(record, "configured") ?? false,
    status: pickString(record, "status") ?? "unknown",
    ...(pickString(record, "baseUrl", "base_url") ? { baseUrl: pickString(record, "baseUrl", "base_url") } : {}),
    ...(pickString(record, "model") ? { model: pickString(record, "model") } : {}),
    ...(pickString(record, "protocol") ? { protocol: pickString(record, "protocol") } : {}),
    ...(pickNumber(record, "timeoutMs", "timeout_ms") ? { timeoutMs: pickNumber(record, "timeoutMs", "timeout_ms") } : {}),
    apiKeyConfigured: pickBoolean(record, "apiKeyConfigured", "api_key_configured") ?? false,
    degraded: pickBoolean(record, "degraded") ?? false,
    ...(pickString(record, "degradationReason", "degradation_reason")
      ? { degradationReason: pickString(record, "degradationReason", "degradation_reason") }
      : {}),
  };
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

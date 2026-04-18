import "server-only";

import { SourceStatus } from "@/lib/contracts";
import { readSourceLastOk, rememberSourceSuccess } from "@/lib/server/source-status-memory";

type FetchJsonOptions = {
  sourceName: string;
  sourceLabel: string;
  url?: string;
  timeoutMs: number;
  method?: string;
  headers?: HeadersInit;
  body?: string;
};

function normalizeUpstreamError(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "上游服务拒绝访问，请检查认证配置。";
  }

  if (status === 404) {
    return "上游服务接口不存在，请检查服务版本或路由配置。";
  }

  if (status >= 500) {
    return `上游服务返回 ${status}，请检查目标服务日志。`;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message =
      typeof record.message === "string"
        ? record.message
        : record.error && typeof record.error === "object" && typeof (record.error as Record<string, unknown>).message === "string"
          ? ((record.error as Record<string, unknown>).message as string)
          : null;

    if (message) {
      return `上游服务返回 ${status}：${message}`;
    }
  }

  return `上游服务返回 ${status}。`;
}

function normalizeThrownError(error: unknown, timeoutMs: number) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return `请求在 ${timeoutMs} 毫秒后超时。`;
    }

    const message = error.message.trim();

    if (/ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH|network/i.test(message)) {
      return `无法连接到上游服务：${message}`;
    }

    return `访问上游服务失败：${message}`;
  }

  return "无法连接到上游服务。";
}

export type SourceResult<T> = {
  ok: boolean;
  data: T | null;
  status: SourceStatus;
};

function buildStatus(
  options: FetchJsonOptions,
  status: SourceStatus["status"],
  checkedAt: string,
  detail: string,
  responseTimeMs: number | null,
  lastOkAt: string | null
): SourceStatus {
  return {
    name: options.sourceName,
    label: options.sourceLabel,
    kind: "dependency",
    status,
    checkedAt,
    lastCheckedAt: checkedAt,
    lastOkAt,
    lastError: status === "healthy" ? null : detail,
    responseTimeMs,
    detail: status === "healthy" ? null : detail,
    activeConnections: null,
    connectionLimit: null
  };
}

export async function fetchJsonFromSource<T>(
  options: FetchJsonOptions
): Promise<SourceResult<T>> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const cachedLastOkAt = readSourceLastOk(options.sourceName);

  if (!options.url) {
    return {
      ok: false,
      data: null,
      status: buildStatus(
        options,
        "misconfigured",
        checkedAt,
        "Missing base URL configuration.",
        null,
        cachedLastOkAt
      )
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(options.url, {
      method: options.method ?? "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...options.headers
      },
      body: options.body,
      cache: "no-store"
    });

    const json = (await response.json().catch(() => null)) as T | null;
    const responseTimeMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        data: null,
        status: buildStatus(
          options,
          "unavailable",
          checkedAt,
          normalizeUpstreamError(response.status, json),
          responseTimeMs,
          cachedLastOkAt
        )
      };
    }

    rememberSourceSuccess(options.sourceName, checkedAt);

    return {
      ok: true,
      data: json,
      status: {
        name: options.sourceName,
        label: options.sourceLabel,
        kind: "dependency",
        status: "healthy",
        checkedAt,
        lastCheckedAt: checkedAt,
        lastOkAt: checkedAt,
        lastError: null,
        responseTimeMs,
        detail: null,
        activeConnections: null,
        connectionLimit: null
      }
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      status: buildStatus(
        options,
        error instanceof Error && error.name === "AbortError" ? "timeout" : "unavailable",
        checkedAt,
        normalizeThrownError(error, options.timeoutMs),
        Date.now() - startedAt,
        cachedLastOkAt
      )
    };
  } finally {
    clearTimeout(timeout);
  }
}

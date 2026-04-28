import "server-only";

import { SourceStatus } from "@/lib/contracts";
import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";
import { readSourceLastOk, rememberSourceSuccess } from "@/lib/server/source-status-memory";

type FetchJsonOptions = {
  sourceName: string;
  sourceLabel: string;
  url?: string;
  timeoutMs: number;
  method?: string;
  headers?: HeadersInit;
  body?: string;
  locale?: AppLocale;
};

function normalizeUpstreamError(status: number, payload: unknown, locale: AppLocale) {
  const t = createTranslator(locale);

  if (status === 401 || status === 403) {
    return t("service.upstream.accessDenied");
  }

  if (status === 404) {
    return t("service.upstream.notFound");
  }

  if (status >= 500) {
    return t("service.upstream.serverError", { status });
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
      return t("service.upstream.message", { status, message });
    }
  }

  return t("service.upstream.status", { status });
}

function normalizeThrownError(error: unknown, timeoutMs: number, locale: AppLocale) {
  const t = createTranslator(locale);

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return t("service.upstream.timeout", { timeoutMs });
    }

    const message = error.message.trim();

    if (/ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH|network/i.test(message)) {
      return t("service.upstream.connect", { message });
    }

    return t("service.upstream.failed", { message });
  }

  return t("service.upstream.unreachable");
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
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const t = createTranslator(locale);
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
        t("service.upstream.missingBaseUrl"),
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
          normalizeUpstreamError(response.status, json, locale),
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
        normalizeThrownError(error, options.timeoutMs, locale),
        Date.now() - startedAt,
        cachedLastOkAt
      )
    };
  } finally {
    clearTimeout(timeout);
  }
}

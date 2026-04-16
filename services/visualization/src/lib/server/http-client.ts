import "server-only";

import { SourceStatus } from "@/lib/contracts";
import { readSourceLastOk, rememberSourceSuccess } from "@/lib/server/source-status-memory";

type FetchJsonOptions = {
  sourceName: string;
  sourceLabel: string;
  url?: string;
  timeoutMs: number;
};

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
    detail: status === "healthy" ? null : detail
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
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      },
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
          `HTTP ${response.status} from upstream.`,
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
        detail: null
      }
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";

    return {
      ok: false,
      data: null,
      status: buildStatus(
        options,
        aborted ? "timeout" : "unavailable",
        checkedAt,
        aborted ? `Timed out after ${options.timeoutMs} ms.` : "Failed to reach upstream source.",
        Date.now() - startedAt,
        cachedLastOkAt
      )
    };
  } finally {
    clearTimeout(timeout);
  }
}

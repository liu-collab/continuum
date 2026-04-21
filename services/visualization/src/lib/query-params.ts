import { MemoryCatalogFilters, MemoryCatalogFiltersSchema, RunTraceFilters, RunTraceFiltersSchema } from "@/lib/contracts";

type SearchParamInput = URLSearchParams | Record<string, string | string[] | undefined>;

function readSingleValue(input: SearchParamInput, key: string): string | string[] | undefined {
  if (input instanceof URLSearchParams) {
    const values = input.getAll(key).filter(Boolean);

    if (values.length === 0) {
      return undefined;
    }

    return values.length === 1 ? values[0] : values;
  }

  return input[key];
}

function readString(input: SearchParamInput, key: string): string | undefined {
  const value = readSingleValue(input, key);

  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readInt(input: SearchParamInput, key: string): number | undefined {
  const raw = readString(input, key);

  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function parseMemoryCatalogFilters(input: SearchParamInput): MemoryCatalogFilters {
  return MemoryCatalogFiltersSchema.parse({
    workspaceId: readString(input, "workspace_id"),
    taskId: readString(input, "task_id"),
    sessionId: readString(input, "session_id"),
    sourceRef: readString(input, "source_ref"),
    memoryViewMode: readString(input, "memory_view_mode"),
    memoryType: readString(input, "memory_type"),
    scope: readString(input, "scope"),
    status: readString(input, "status"),
    updatedFrom: readString(input, "updated_from"),
    updatedTo: readString(input, "updated_to"),
    page: readInt(input, "page") ?? 1,
    pageSize: readInt(input, "page_size") ?? 20
  });
}

export function parseRunTraceFilters(input: SearchParamInput): RunTraceFilters {
  return RunTraceFiltersSchema.parse({
    turnId: readString(input, "turn_id"),
    sessionId: readString(input, "session_id"),
    traceId: readString(input, "trace_id"),
    page: readInt(input, "page") ?? 1,
    pageSize: readInt(input, "page_size") ?? 20
  });
}

export function buildQueryString(params: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    query.set(key, String(value));
  }

  return query.toString();
}

export function toMemoryCatalogQuery(filters: MemoryCatalogFilters) {
  return buildQueryString({
    workspace_id: filters.workspaceId,
    task_id: filters.taskId,
    session_id: filters.sessionId,
    source_ref: filters.sourceRef,
    memory_view_mode: filters.memoryViewMode,
    memory_type: filters.memoryType,
    scope: filters.scope,
    status: filters.status,
    updated_from: filters.updatedFrom,
    updated_to: filters.updatedTo,
    page: filters.page,
    page_size: filters.pageSize
  });
}

export function toRunTraceQuery(filters: RunTraceFilters) {
  return buildQueryString({
    turn_id: filters.turnId,
    session_id: filters.sessionId,
    trace_id: filters.traceId,
    page: filters.page,
    page_size: filters.pageSize
  });
}

export const DEFAULT_DASHBOARD_WINDOW = "30m";

export function parseDashboardWindow(input: SearchParamInput) {
  const value = readString(input, "window");
  return value && ["15m", "30m", "1h", "6h", "24h"].includes(value) ? value : DEFAULT_DASHBOARD_WINDOW;
}

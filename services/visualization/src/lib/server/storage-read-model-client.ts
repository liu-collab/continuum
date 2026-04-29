import "server-only";

import { Pool } from "pg";

import { MemoryCatalogFilters, Scope, SourceStatus } from "@/lib/contracts";
import { getAppConfig } from "@/lib/env";
import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";
import { asRecord, pickString } from "@/lib/records";
import { readSourceLastOk, rememberSourceSuccess } from "@/lib/server/source-status-memory";

type ReadModelRow = {
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
  importance: number | null;
  confidence: number | null;
  source: Record<string, unknown> | null;
  last_confirmed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ReadModelQueryResult = {
  rows: ReadModelRow[];
  total: number;
  status: SourceStatus;
};

type CatalogViewQueryResult = ReadModelQueryResult & {
  warnings: string[];
};

type QueryOptions = {
  workspaceId?: string;
  userId?: string;
  taskId?: string;
  sessionId?: string;
  sourceRef?: string;
  memoryType?: string;
  scope?: Scope;
  scopeIn?: Scope[];
  status?: string;
  updatedFrom?: string;
  updatedTo?: string;
  limit?: number;
  offset?: number;
};

declare global {
  var __AXIS_VIZ_PG_POOL__: Pool | undefined;
  var __AXIS_VIZ_PG_POOL_LOGGED__: boolean | undefined;
}

export class StorageReadModelUnavailableError extends Error {
  readonly recordId: string;
  override readonly cause: unknown;

  constructor(message: string, options: { recordId: string; cause: unknown }) {
    super(message);
    this.name = "StorageReadModelUnavailableError";
    this.recordId = options.recordId;
    this.cause = options.cause;
  }
}

function getPool() {
  const { values } = getAppConfig();

  if (!values.STORAGE_READ_MODEL_DSN) {
    return null;
  }

  if (!globalThis.__AXIS_VIZ_PG_POOL__) {
    globalThis.__AXIS_VIZ_PG_POOL__ = new Pool({
      connectionString: values.STORAGE_READ_MODEL_DSN,
      connectionTimeoutMillis: values.STORAGE_READ_MODEL_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
      max: values.DATABASE_POOL_MAX,
      query_timeout: values.STORAGE_READ_MODEL_TIMEOUT_MS,
      statement_timeout: values.STORAGE_READ_MODEL_TIMEOUT_MS
    });
  }

  if (!globalThis.__AXIS_VIZ_PG_POOL_LOGGED__) {
    console.info(`[visualization] database pool max=${values.DATABASE_POOL_MAX}`);
    globalThis.__AXIS_VIZ_PG_POOL_LOGGED__ = true;
  }

  return globalThis.__AXIS_VIZ_PG_POOL__;
}

export function getReadModelPoolStats() {
  const pool = globalThis.__AXIS_VIZ_PG_POOL__;
  const { values } = getAppConfig();

  return {
    activeConnections: pool ? pool.totalCount : 0,
    connectionLimit: values.DATABASE_POOL_MAX
  };
}

function qualifiedReadModelTable() {
  const { values } = getAppConfig();
  return `"${values.STORAGE_READ_MODEL_SCHEMA}"."${values.STORAGE_READ_MODEL_TABLE}"`;
}

function unavailableStatus(
  status: SourceStatus["status"],
  detail: string,
  responseTimeMs: number | null,
  locale: AppLocale = DEFAULT_APP_LOCALE
): SourceStatus {
  const t = createTranslator(locale);
  const checkedAt = new Date().toISOString();
  const lastOkAt = readSourceLastOk("storage_read_model");

  return {
    name: "storage_read_model",
    label: t("service.sources.storageReadModel"),
    kind: "dependency",
    status,
    checkedAt,
    lastCheckedAt: checkedAt,
    lastOkAt,
    lastError: detail,
    responseTimeMs,
    detail,
    ...getReadModelPoolStats()
  };
}

function pushParam(params: Array<string | number | string[]>, value: string | number | string[]) {
  params.push(value);
  return `$${params.length}`;
}

function buildWhereClause(options: QueryOptions, params: Array<string | number | string[]>) {
  const clauses: string[] = [];

  if (options.workspaceId) {
    clauses.push(`workspace_id = ${pushParam(params, options.workspaceId)}`);
  }

  if (options.userId) {
    clauses.push(`user_id = ${pushParam(params, options.userId)}`);
  }

  if (options.taskId) {
    clauses.push(`task_id = ${pushParam(params, options.taskId)}`);
  }

  if (options.sessionId) {
    clauses.push(`session_id = ${pushParam(params, options.sessionId)}`);
  }

  if (options.sourceRef) {
    clauses.push(`source->>'source_ref' = ${pushParam(params, options.sourceRef)}`);
  }

  if (options.memoryType) {
    clauses.push(`memory_type = ${pushParam(params, options.memoryType)}`);
  }

  if (options.scope) {
    clauses.push(`scope = ${pushParam(params, options.scope)}`);
  }

  if (options.scopeIn && options.scopeIn.length > 0) {
    clauses.push(`scope = ANY(${pushParam(params, options.scopeIn)}::text[])`);
  }

  if (options.status) {
    clauses.push(`status = ${pushParam(params, options.status)}`);
  }

  if (options.updatedFrom) {
    clauses.push(`updated_at >= ${pushParam(params, options.updatedFrom)}`);
  }

  if (options.updatedTo) {
    clauses.push(`updated_at <= ${pushParam(params, options.updatedTo)}`);
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

async function executeReadModelQuery(pool: Pool, options: QueryOptions): Promise<ReadModelRow[]> {
  const params: Array<string | number | string[]> = [];
  const whereClause = buildWhereClause(options, params);
  const limit =
    typeof options.limit === "number" ? `LIMIT ${pushParam(params, options.limit)}` : "";
  const offset =
    typeof options.offset === "number" ? `OFFSET ${pushParam(params, options.offset)}` : "";

  const query = `
    SELECT
      id,
      workspace_id,
      user_id,
      task_id,
      session_id,
      memory_type,
      scope,
      status,
      summary,
      details,
      importance,
      confidence,
      source,
      last_confirmed_at,
      created_at,
      updated_at
    FROM ${qualifiedReadModelTable()}
    ${whereClause}
    ORDER BY updated_at DESC NULLS LAST, id DESC
    ${limit}
    ${offset}
  `;

  const result = await pool.query<ReadModelRow>(query, params);
  return result.rows;
}

async function countReadModelRows(pool: Pool, options: QueryOptions): Promise<number> {
  const params: Array<string | number | string[]> = [];
  const whereClause = buildWhereClause(options, params);
  const query = `SELECT COUNT(*)::int AS total FROM ${qualifiedReadModelTable()} ${whereClause}`;
  const result = await pool.query<{ total: number }>(query, params);
  return result.rows[0]?.total ?? 0;
}

function healthyStatus(
  responseTimeMs: number,
  warnings: string[] = [],
  locale: AppLocale = DEFAULT_APP_LOCALE
): SourceStatus {
  const t = createTranslator(locale);
  const checkedAt = new Date().toISOString();
  rememberSourceSuccess("storage_read_model", checkedAt);

  return {
    name: "storage_read_model",
    label: t("service.sources.storageReadModel"),
    kind: "dependency",
    status: warnings.length > 0 ? "partial" : "healthy",
    checkedAt,
    lastCheckedAt: checkedAt,
    lastOkAt: checkedAt,
    lastError: warnings.length > 0 ? warnings.join(" ") : null,
    responseTimeMs,
    detail: warnings.length > 0 ? warnings.join(" ") : null,
    ...getReadModelPoolStats()
  };
}

function buildQueryOptions(filters: MemoryCatalogFilters): QueryOptions {
  const { values } = getAppConfig();
  return {
    workspaceId: filters.workspaceId,
    userId: values.PLATFORM_USER_ID,
    taskId: filters.taskId,
    sessionId: filters.sessionId,
    memoryType: filters.memoryType,
    scope: filters.scope,
    status: filters.status,
    updatedFrom: filters.updatedFrom,
    updatedTo: filters.updatedTo
  };
}

function mapSource(source: Record<string, unknown> | null) {
  const record = asRecord(source);

  return {
    sourceType: record ? pickString(record, "source_type", "sourceType") ?? null : null,
    sourceRef: record ? pickString(record, "source_ref", "sourceRef") ?? null : null,
    sourceServiceName: record ? pickString(record, "service_name", "serviceName") ?? null : null,
    originWorkspaceId: record
      ? pickString(record, "origin_workspace_id", "originWorkspaceId") ?? null
      : null
  };
}

function isImplicitGlobalCatalogView(filters: MemoryCatalogFilters) {
  return (
    !filters.workspaceId
    && !filters.taskId
    && !filters.sessionId
    && !filters.sourceRef
    && !filters.scope
    && filters.memoryViewMode === "workspace_plus_global"
  );
}

export async function queryMemoryReadModel(
  filters: MemoryCatalogFilters,
  options: { locale?: AppLocale } = {}
): Promise<ReadModelQueryResult> {
  const pool = getPool();
  const { values, issues } = getAppConfig();
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const t = createTranslator(locale);
  const startedAt = Date.now();

  if (issues.length > 0) {
    return {
      rows: [],
      total: 0,
      status: unavailableStatus("misconfigured", issues.join(" "), null, locale)
    };
  }

  if (!pool || !values.STORAGE_READ_MODEL_DSN) {
    return {
      rows: [],
      total: 0,
      status: unavailableStatus(
        "misconfigured",
        t("service.readModel.missingDsn"),
        null,
        locale
      )
    };
  }

  try {
    const baseOptions = buildQueryOptions(filters);
    const [rows, total] = await Promise.all([
      executeReadModelQuery(pool, {
        ...baseOptions,
        limit: filters.pageSize,
        offset: (filters.page - 1) * filters.pageSize
      }),
      countReadModelRows(pool, baseOptions)
    ]);

    return {
      rows,
      total,
      status: healthyStatus(Date.now() - startedAt, [], locale)
    };
  } catch (error) {
    return {
      rows: [],
      total: 0,
      status: unavailableStatus(
        "unavailable",
        error instanceof Error ? error.message : t("service.readModel.queryFailed"),
        Date.now() - startedAt,
        locale
      )
    };
  }
}

export async function queryCatalogView(
  filters: MemoryCatalogFilters,
  options: { locale?: AppLocale } = {}
): Promise<CatalogViewQueryResult> {
  const pool = getPool();
  const { values, issues } = getAppConfig();
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const t = createTranslator(locale);
  const startedAt = Date.now();
  const warnings: string[] = [];

  if (issues.length > 0) {
    return {
      rows: [],
      total: 0,
      warnings,
      status: unavailableStatus("misconfigured", issues.join(" "), null, locale)
    };
  }

  if (!pool || !values.STORAGE_READ_MODEL_DSN) {
    return {
      rows: [],
      total: 0,
      warnings,
      status: unavailableStatus(
        "misconfigured",
        t("service.readModel.missingDsn"),
        null,
        locale
      )
    };
  }

  const globalOnlyView =
    filters.memoryViewMode === "workspace_plus_global"
    && (filters.scope === "user" || isImplicitGlobalCatalogView(filters));

  if (!filters.workspaceId && !globalOnlyView) {
    warnings.push(
      t("service.readModel.missingWorkspaceWarning")
    );
  }

  try {
    const workspaceScopes = filters.scope
      ? filters.scope === "user"
        ? []
        : [filters.scope]
      : (["workspace", "task", "session"] satisfies Scope[]);
    const globalScopes = filters.scope
      ? filters.scope === "user"
        ? (["user"] satisfies Scope[])
        : []
      : (["user"] satisfies Scope[]);

    const workspaceQuery =
      filters.workspaceId && workspaceScopes.length > 0
        ? {
            workspaceId: filters.workspaceId,
            taskId: filters.taskId,
            sessionId: filters.sessionId,
            sourceRef: filters.sourceRef,
            memoryType: filters.memoryType,
            status: filters.status,
            updatedFrom: filters.updatedFrom,
            updatedTo: filters.updatedTo,
            scopeIn: workspaceScopes
          }
        : null;

    const globalQuery =
      filters.memoryViewMode === "workspace_plus_global" && values.PLATFORM_USER_ID && globalScopes.length > 0
        ? {
            userId: values.PLATFORM_USER_ID,
            sessionId: filters.sessionId,
            sourceRef: filters.sourceRef,
            memoryType: filters.memoryType,
            status: filters.status,
            updatedFrom: filters.updatedFrom,
            updatedTo: filters.updatedTo,
            scopeIn: globalScopes
          }
        : null;

    const [workspaceRows, workspaceTotal, globalRows, globalTotal] = await Promise.all([
      workspaceQuery ? executeReadModelQuery(pool, workspaceQuery) : Promise.resolve([]),
      workspaceQuery ? countReadModelRows(pool, workspaceQuery) : Promise.resolve(0),
      globalQuery ? executeReadModelQuery(pool, globalQuery) : Promise.resolve([]),
      globalQuery ? countReadModelRows(pool, globalQuery) : Promise.resolve(0)
    ]);

    const dedupedRows = Array.from(
      new Map([...workspaceRows, ...globalRows].map((row) => [row.id, row])).values()
    );

    const mergedRows = dedupedRows.sort((left, right) => {
      const updatedCompare = (right.updated_at ?? "").localeCompare(left.updated_at ?? "");

      if (updatedCompare !== 0) {
        return updatedCompare;
      }

      return right.id.localeCompare(left.id);
    });

    const offset = (filters.page - 1) * filters.pageSize;

    return {
      rows: mergedRows.slice(offset, offset + filters.pageSize),
      total: dedupedRows.length,
      warnings,
      status: healthyStatus(Date.now() - startedAt, warnings, locale)
    };
  } catch (error) {
    return {
      rows: [],
      total: 0,
      warnings,
      status: unavailableStatus(
        "unavailable",
        error instanceof Error ? error.message : t("service.readModel.queryFailed"),
        Date.now() - startedAt,
        locale
      )
    };
  }
}

export async function pingMemoryReadModel(options: { locale?: AppLocale } = {}) {
  const pool = getPool();
  const { values, issues } = getAppConfig();
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const t = createTranslator(locale);
  const startedAt = Date.now();

  if (issues.length > 0) {
    return unavailableStatus("misconfigured", issues.join(" "), null, locale);
  }

  if (!pool || !values.STORAGE_READ_MODEL_DSN) {
    return unavailableStatus("misconfigured", t("service.readModel.missingDsn"), null, locale);
  }

  try {
    await pool.query(`SELECT 1 FROM ${qualifiedReadModelTable()} LIMIT 1`);
    return healthyStatus(Date.now() - startedAt, [], locale);
  } catch (error) {
    return unavailableStatus(
      "unavailable",
      error instanceof Error ? error.message : t("service.readModel.pingFailed"),
      Date.now() - startedAt,
      locale
    );
  }
}

export async function fetchMemoryById(id: string): Promise<ReadModelRow | null> {
  const pool = getPool();
  const { values, issues } = getAppConfig();

  if (issues.length > 0) {
    throw new StorageReadModelUnavailableError("failed to fetch memory by id", {
      recordId: id,
      cause: new Error(issues.join(" "))
    });
  }

  if (!pool || !values.STORAGE_READ_MODEL_DSN) {
    throw new StorageReadModelUnavailableError("failed to fetch memory by id", {
      recordId: id,
      cause: new Error("missing STORAGE_READ_MODEL_DSN")
    });
  }

  try {
    const query = `
      SELECT
        id,
        workspace_id,
        user_id,
        task_id,
        session_id,
        memory_type,
        scope,
        status,
        summary,
        details,
        importance,
        confidence,
        source,
        last_confirmed_at,
        created_at,
        updated_at
      FROM ${qualifiedReadModelTable()}
      WHERE id = $1
      LIMIT 1
    `;

    const result = await pool.query<ReadModelRow>(query, [id]);

    if (result.rows[0]) {
      rememberSourceSuccess("storage_read_model", new Date().toISOString());
    }

    return result.rows[0] ?? null;
  } catch (error) {
    throw new StorageReadModelUnavailableError("failed to fetch memory by id", {
      recordId: id,
      cause: error
    });
  }
}

export { mapSource };

import "server-only";

import { Pool } from "pg";

import { MemoryCatalogFilters, Scope, SourceStatus } from "@/lib/contracts";
import { getAppConfig } from "@/lib/env";
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
  var __AGENT_MEMORY_VIZ_PG_POOL__: Pool | undefined;
}

function getPool() {
  const { values } = getAppConfig();

  if (!values.STORAGE_READ_MODEL_DSN) {
    return null;
  }

  if (!globalThis.__AGENT_MEMORY_VIZ_PG_POOL__) {
    globalThis.__AGENT_MEMORY_VIZ_PG_POOL__ = new Pool({
      connectionString: values.STORAGE_READ_MODEL_DSN,
      connectionTimeoutMillis: values.STORAGE_READ_MODEL_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
      max: 5,
      query_timeout: values.STORAGE_READ_MODEL_TIMEOUT_MS,
      statement_timeout: values.STORAGE_READ_MODEL_TIMEOUT_MS
    });
  }

  return globalThis.__AGENT_MEMORY_VIZ_PG_POOL__;
}

function qualifiedReadModelTable() {
  const { values } = getAppConfig();
  return `"${values.STORAGE_READ_MODEL_SCHEMA}"."${values.STORAGE_READ_MODEL_TABLE}"`;
}

function unavailableStatus(
  status: SourceStatus["status"],
  detail: string,
  responseTimeMs: number | null
): SourceStatus {
  const checkedAt = new Date().toISOString();
  const lastOkAt = readSourceLastOk("storage_read_model");

  return {
    name: "storage_read_model",
    label: "Storage read model",
    kind: "dependency",
    status,
    checkedAt,
    lastCheckedAt: checkedAt,
    lastOkAt,
    lastError: detail,
    responseTimeMs,
    detail
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

function healthyStatus(responseTimeMs: number, warnings: string[] = []): SourceStatus {
  const checkedAt = new Date().toISOString();
  rememberSourceSuccess("storage_read_model", checkedAt);

  return {
    name: "storage_read_model",
    label: "Storage read model",
    kind: "dependency",
    status: warnings.length > 0 ? "partial" : "healthy",
    checkedAt,
    lastCheckedAt: checkedAt,
    lastOkAt: checkedAt,
    lastError: warnings.length > 0 ? warnings.join(" ") : null,
    responseTimeMs,
    detail: warnings.length > 0 ? warnings.join(" ") : null
  };
}

function buildQueryOptions(filters: MemoryCatalogFilters): QueryOptions {
  return {
    workspaceId: filters.workspaceId,
    userId: filters.userId,
    taskId: filters.taskId,
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

export async function queryMemoryReadModel(
  filters: MemoryCatalogFilters
): Promise<ReadModelQueryResult> {
  const pool = getPool();
  const { values, issues } = getAppConfig();
  const startedAt = Date.now();

  if (issues.length > 0) {
    return {
      rows: [],
      total: 0,
      status: unavailableStatus("misconfigured", issues.join(" "), null)
    };
  }

  if (!pool || !values.STORAGE_READ_MODEL_DSN) {
    return {
      rows: [],
      total: 0,
      status: unavailableStatus(
        "misconfigured",
        "Missing STORAGE_READ_MODEL_DSN configuration.",
        null
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
      status: healthyStatus(Date.now() - startedAt)
    };
  } catch (error) {
    return {
      rows: [],
      total: 0,
      status: unavailableStatus(
        "unavailable",
        error instanceof Error ? error.message : "Read model query failed.",
        Date.now() - startedAt
      )
    };
  }
}

export async function queryCatalogView(
  filters: MemoryCatalogFilters
): Promise<CatalogViewQueryResult> {
  const pool = getPool();
  const { values, issues } = getAppConfig();
  const startedAt = Date.now();
  const warnings: string[] = [];

  if (issues.length > 0) {
    return {
      rows: [],
      total: 0,
      warnings,
      status: unavailableStatus("misconfigured", issues.join(" "), null)
    };
  }

  if (!pool || !values.STORAGE_READ_MODEL_DSN) {
    return {
      rows: [],
      total: 0,
      warnings,
      status: unavailableStatus(
        "misconfigured",
        "Missing STORAGE_READ_MODEL_DSN configuration.",
        null
      )
    };
  }

  if (!filters.workspaceId) {
    warnings.push(
      "Current workspace is missing. Workspace, task, and session records cannot be resolved without workspace_id."
    );
  }

  if (filters.memoryViewMode === "workspace_plus_global" && !filters.userId) {
    warnings.push("Current user is missing. Global memories cannot be included without user_id.");
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
            memoryType: filters.memoryType,
            status: filters.status,
            updatedFrom: filters.updatedFrom,
            updatedTo: filters.updatedTo,
            scopeIn: workspaceScopes
          }
        : null;

    const globalQuery =
      filters.memoryViewMode === "workspace_plus_global" && filters.userId && globalScopes.length > 0
        ? {
            userId: filters.userId,
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
      status: healthyStatus(Date.now() - startedAt, warnings)
    };
  } catch (error) {
    return {
      rows: [],
      total: 0,
      warnings,
      status: unavailableStatus(
        "unavailable",
        error instanceof Error ? error.message : "Catalog view query failed.",
        Date.now() - startedAt
      )
    };
  }
}

export async function pingMemoryReadModel() {
  const pool = getPool();
  const { values, issues } = getAppConfig();
  const startedAt = Date.now();

  if (issues.length > 0) {
    return unavailableStatus("misconfigured", issues.join(" "), null);
  }

  if (!pool || !values.STORAGE_READ_MODEL_DSN) {
    return unavailableStatus("misconfigured", "Missing STORAGE_READ_MODEL_DSN configuration.", null);
  }

  try {
    await pool.query(`SELECT 1 FROM ${qualifiedReadModelTable()} LIMIT 1`);
    return healthyStatus(Date.now() - startedAt);
  } catch (error) {
    return unavailableStatus(
      "unavailable",
      error instanceof Error ? error.message : "Read model ping failed.",
      Date.now() - startedAt
    );
  }
}

export async function fetchMemoryById(id: string): Promise<ReadModelRow | null> {
  const pool = getPool();
  const { values, issues } = getAppConfig();

  if (issues.length > 0 || !pool || !values.STORAGE_READ_MODEL_DSN) {
    return null;
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
  } catch {
    return null;
  }
}

export { mapSource };

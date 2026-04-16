import "server-only";

import { Pool } from "pg";

import { MemoryCatalogFilters, SourceStatus } from "@/lib/contracts";
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

function mapSource(source: Record<string, unknown> | null) {
  const record = asRecord(source);

  return {
    sourceType: record ? pickString(record, "source_type", "sourceType") ?? null : null,
    sourceRef: record ? pickString(record, "source_ref", "sourceRef") ?? null : null,
    sourceServiceName: record
      ? pickString(record, "service_name", "serviceName") ?? null
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

  const filtersParams: Array<string | number> = [];
  const clauses: string[] = [];
  const addFilter = (value: string | number) => {
    filtersParams.push(value);
    return `$${filtersParams.length}`;
  };

  if (filters.workspaceId) {
    clauses.push(`workspace_id = ${addFilter(filters.workspaceId)}`);
  }

  if (filters.userId) {
    clauses.push(`user_id = ${addFilter(filters.userId)}`);
  }

  if (filters.taskId) {
    clauses.push(`task_id = ${addFilter(filters.taskId)}`);
  }

  if (filters.memoryType) {
    clauses.push(`memory_type = ${addFilter(filters.memoryType)}`);
  }

  if (filters.scope) {
    clauses.push(`scope = ${addFilter(filters.scope)}`);
  }

  if (filters.status) {
    clauses.push(`status = ${addFilter(filters.status)}`);
  }

  if (filters.updatedFrom) {
    clauses.push(`updated_at >= ${addFilter(filters.updatedFrom)}`);
  }

  if (filters.updatedTo) {
    clauses.push(`updated_at <= ${addFilter(filters.updatedTo)}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  try {
    const totalQuery = `SELECT COUNT(*)::int AS total FROM ${qualifiedReadModelTable()} ${whereClause}`;
    const totalResult = await pool.query<{ total: number }>(totalQuery, filtersParams);

    const dataParams = [...filtersParams];
    const limitPlaceholder = `$${dataParams.length + 1}`;
    dataParams.push(filters.pageSize);
    const offsetPlaceholder = `$${dataParams.length + 1}`;
    dataParams.push((filters.page - 1) * filters.pageSize);

    const dataQuery = `
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
        NULL::text AS created_at,
        updated_at
      FROM ${qualifiedReadModelTable()}
      ${whereClause}
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;

    const dataResult = await pool.query<ReadModelRow>(dataQuery, dataParams);
    const checkedAt = new Date().toISOString();
    rememberSourceSuccess("storage_read_model", checkedAt);

    return {
      rows: dataResult.rows,
      total: totalResult.rows[0]?.total ?? 0,
      status: {
        name: "storage_read_model",
        label: "Storage read model",
        kind: "dependency",
        status: "healthy",
        checkedAt,
        lastCheckedAt: checkedAt,
        lastOkAt: checkedAt,
        lastError: null,
        responseTimeMs: Date.now() - startedAt,
        detail: null
      }
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
    const checkedAt = new Date().toISOString();
    rememberSourceSuccess("storage_read_model", checkedAt);

    return {
      name: "storage_read_model",
      label: "Storage read model",
      kind: "dependency" as const,
      status: "healthy" as const,
      checkedAt,
      lastCheckedAt: checkedAt,
      lastOkAt: checkedAt,
      lastError: null,
      responseTimeMs: Date.now() - startedAt,
      detail: null
    };
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
        NULL::text AS created_at,
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

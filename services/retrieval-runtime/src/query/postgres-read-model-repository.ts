import { Pool } from "pg";

import type { AppConfig } from "../config.js";
import { TimeoutAppError } from "../errors.js";
import { quoteIdentifier } from "../db/postgres-utils.js";
import type { CandidateMemory, RetrievalQuery } from "../shared/types.js";
import type { ReadModelRepository } from "./read-model-repository.js";

interface MemoryReadModelRow {
  id: string;
  workspace_id: string;
  user_id: string;
  session_id: string | null;
  task_id: string | null;
  memory_type: CandidateMemory["memory_type"];
  scope: CandidateMemory["scope"];
  summary: string;
  details: Record<string, unknown> | null;
  source: Record<string, unknown> | null;
  importance: number;
  confidence: number;
  status: CandidateMemory["status"];
  updated_at: Date | string;
  last_confirmed_at: Date | string | null;
  summary_embedding: string | number[] | null;
  embedding_status: "ok" | "pending" | "failed" | null;
}

function parseEmbedding(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item));
  }

  if (typeof value === "string" && value.startsWith("[")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
  }

  return undefined;
}

export class PostgresReadModelRepository implements ReadModelRepository {
  private readonly pool: Pool;
  private readonly queryTimeoutMs: number;

  constructor(private readonly config: AppConfig, pool?: Pool) {
    this.pool =
      pool ??
      new Pool({
        connectionString: config.DATABASE_URL,
        max: 4,
        allowExitOnIdle: true,
      });
    this.queryTimeoutMs = config.QUERY_TIMEOUT_MS;
  }

  async searchCandidates(query: RetrievalQuery, signal?: AbortSignal): Promise<CandidateMemory[]> {
    const tableName = `${quoteIdentifier(this.config.READ_MODEL_SCHEMA)}.${quoteIdentifier(this.config.READ_MODEL_TABLE)}`;
    const queryEmbedding = query.semantic_query_embedding
      ? `[${query.semantic_query_embedding.join(",")}]`
      : null;
    const sql = `
      WITH filtered AS (
        SELECT
          id,
          workspace_id,
          user_id,
          session_id,
          task_id,
          memory_type,
          scope,
          summary,
          details,
          source,
          importance,
          confidence,
          status,
          updated_at,
          last_confirmed_at,
          summary_embedding,
          embedding_status
        FROM ${tableName}
        WHERE status = ANY($1::text[])
          AND scope = ANY($2::text[])
          AND memory_type = ANY($3::text[])
          AND importance >= $4
          AND (
            (scope = 'workspace' AND workspace_id = $5::uuid)
            OR (scope = 'user' AND user_id = $6::uuid)
            OR (scope = 'task' AND workspace_id = $5::uuid AND $7::uuid IS NOT NULL AND task_id = $7::uuid)
            OR (scope = 'session' AND workspace_id = $5::uuid AND session_id = $8::uuid)
          )
      ),
      ranked AS (
        SELECT
          *,
          (
            SELECT count(*)::int
            FROM unnest($9::text[]) AS term
            WHERE lower(summary) LIKE '%' || lower(term) || '%'
          ) AS lexical_overlap,
          CASE
            WHEN $10::vector IS NULL OR summary_embedding IS NULL THEN NULL
            ELSE summary_embedding <=> $10::vector
          END AS vector_distance
        FROM filtered
      )
      SELECT
        id,
        workspace_id,
        user_id,
        session_id,
        task_id,
        memory_type,
        scope,
        summary,
        details,
        source,
        importance,
        confidence,
        status,
        updated_at,
        last_confirmed_at,
        summary_embedding,
        embedding_status
      FROM ranked
      ORDER BY
        GREATEST(
          CASE WHEN cardinality($9::text[]) = 0 THEN 0 ELSE lexical_overlap::float / cardinality($9::text[]) END,
          CASE WHEN vector_distance IS NULL THEN 0 ELSE 1 - vector_distance END
        ) DESC,
        lexical_overlap DESC,
        CASE WHEN vector_distance IS NULL THEN 1 ELSE 0 END,
        vector_distance ASC,
        importance DESC,
        confidence DESC,
        updated_at DESC
      LIMIT $11
    `;

    const values = [
      query.status_filter,
      query.scope_filter,
      query.memory_type_filter,
      query.importance_threshold,
      query.workspace_id,
      query.user_id,
      query.task_id ?? null,
      query.session_id,
      query.semantic_query_terms ?? [],
      queryEmbedding,
      query.candidate_limit,
    ];

    const client = await this.pool.connect();
    let clientReleased = false;
    const abortListener = () => {
      if (clientReleased) {
        return;
      }
      clientReleased = true;
      client.release(true);
    };

    try {
      if (signal?.aborted) {
        throw new TimeoutAppError("read_model timed out before query execution");
      }

      signal?.addEventListener("abort", abortListener, { once: true });
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${this.queryTimeoutMs}`);
      const result = await client.query<MemoryReadModelRow>({
        text: sql,
        values,
      });
      await client.query("COMMIT");

      return result.rows.map((row) => ({
        id: String(row.id),
        workspace_id: String(row.workspace_id),
        user_id: String(row.user_id),
        session_id: row.session_id ? String(row.session_id) : null,
        task_id: row.task_id ? String(row.task_id) : null,
        memory_type: row.memory_type,
        scope: row.scope,
        summary: String(row.summary),
        details: row.details ?? null,
        source: row.source ?? null,
        importance: Number(row.importance),
        confidence: Number(row.confidence),
        status: row.status,
        updated_at: new Date(row.updated_at).toISOString(),
        last_confirmed_at: row.last_confirmed_at ? new Date(row.last_confirmed_at).toISOString() : null,
        summary_embedding: parseEmbedding(row.summary_embedding),
        embedding_status: row.embedding_status ?? undefined,
      }));
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failure on aborted connection.
      }
      if (signal?.aborted) {
        throw new TimeoutAppError("read_model timed out during query execution");
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "57014"
      ) {
        throw new TimeoutAppError("read_model hit statement_timeout during query execution");
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortListener);
      if (!clientReleased) {
        clientReleased = true;
        client.release();
      }
    }
  }
}

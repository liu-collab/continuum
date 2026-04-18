import type {
  DependencyStatus,
  DependencyStatusSnapshot,
  InjectionRunRecord,
  ObserveMetricsResponse,
  ObserveRunsFilters,
  ObserveRunsResponse,
  RecallRunRecord,
  RuntimeTurnRecord,
  TriggerRunRecord,
  WritebackSubmissionRecord,
} from "../shared/types.js";
import { percentile } from "../shared/utils.js";
import { createPgPool, quoteIdentifier, type PgPoolLike } from "../db/postgres-utils.js";
import type { AppConfig } from "../config.js";
import type { RuntimeRepository } from "./runtime-repository.js";

interface RuntimeRowBase {
  trace_id: string;
  created_at: Date | string;
}

interface RuntimeTurnRow extends RuntimeRowBase {
  host: string;
  workspace_id: string;
  user_id: string;
  session_id: string;
  phase: string;
  task_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  current_input: string;
  assistant_output: string | null;
}

interface TriggerRunRow extends RuntimeRowBase {
  phase: string;
  trigger_hit: boolean;
  trigger_type: TriggerRunRecord["trigger_type"];
  trigger_reason: string;
  requested_memory_types: unknown;
  memory_mode: string;
  requested_scopes: unknown;
  scope_reason: string;
  importance_threshold: number;
  cooldown_applied: boolean;
  semantic_score: number | null;
  degraded: boolean | null;
  degradation_reason: string | null;
  duration_ms: number;
}

interface RecallRunRow extends RuntimeRowBase {
  phase: string;
  trigger_hit: boolean;
  trigger_type: RecallRunRecord["trigger_type"];
  trigger_reason: string;
  memory_mode: string;
  requested_scopes: unknown;
  matched_scopes: unknown;
  scope_hit_counts: unknown;
  scope_reason: string;
  query_scope: string;
  requested_memory_types: unknown;
  candidate_count: number;
  selected_count: number;
  result_state: RecallRunRecord["result_state"];
  degraded: boolean;
  degradation_reason: string | null;
  duration_ms: number;
}

interface InjectionRunRow extends RuntimeRowBase {
  phase: string;
  injected: boolean;
  injected_count: number;
  token_estimate: number;
  memory_mode: string;
  requested_scopes: unknown;
  selected_scopes: unknown;
  trimmed_record_ids: unknown;
  trim_reasons: unknown;
  result_state: InjectionRunRecord["result_state"];
  duration_ms: number;
}

interface WritebackRunRow extends RuntimeRowBase {
  phase: string;
  candidate_count: number;
  submitted_count: number;
  memory_mode: string;
  final_scopes: unknown;
  filtered_count: number;
  filtered_reasons: unknown;
  scope_reasons: unknown;
  result_state: WritebackSubmissionRecord["result_state"];
  degraded: boolean;
  degradation_reason: string | null;
  duration_ms: number;
}

interface DependencyStatusRow {
  name: DependencyStatus["name"];
  status: DependencyStatus["status"];
  detail: string;
  last_checked_at: Date | string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item));
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

export class PostgresRuntimeRepository implements RuntimeRepository {
  private readonly pool: PgPoolLike;
  private readonly runtimeSchema: string;

  constructor(config: AppConfig, pool?: PgPoolLike) {
    this.runtimeSchema = config.RUNTIME_SCHEMA;
    this.pool = pool ?? createPgPool(config.DATABASE_URL);
  }

  async initialize(): Promise<void> {
    const schema = quoteIdentifier(this.runtimeSchema);

    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.runtime_turns (
        trace_id TEXT NOT NULL,
        host TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        task_id TEXT NULL,
        thread_id TEXT NULL,
        turn_id TEXT NULL,
        current_input TEXT NOT NULL,
        assistant_output TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (trace_id, phase)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.runtime_trigger_runs (
        trace_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        trigger_hit BOOLEAN NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_reason TEXT NOT NULL,
        requested_memory_types JSONB NOT NULL,
        memory_mode TEXT NOT NULL,
        requested_scopes JSONB NOT NULL,
        scope_reason TEXT NOT NULL,
        importance_threshold INTEGER NOT NULL,
        cooldown_applied BOOLEAN NOT NULL,
        semantic_score DOUBLE PRECISION NULL,
        degraded BOOLEAN NULL,
        degradation_reason TEXT NULL,
        duration_ms INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (trace_id, phase)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.runtime_recall_runs (
        trace_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        trigger_hit BOOLEAN NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_reason TEXT NOT NULL,
        memory_mode TEXT NOT NULL,
        requested_scopes JSONB NOT NULL,
        matched_scopes JSONB NOT NULL,
        scope_hit_counts JSONB NOT NULL,
        scope_reason TEXT NOT NULL,
        query_scope TEXT NOT NULL,
        requested_memory_types JSONB NOT NULL,
        candidate_count INTEGER NOT NULL,
        selected_count INTEGER NOT NULL,
        result_state TEXT NOT NULL,
        degraded BOOLEAN NOT NULL,
        degradation_reason TEXT NULL,
        duration_ms INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (trace_id, phase)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.runtime_injection_runs (
        trace_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        injected BOOLEAN NOT NULL,
        injected_count INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL,
        memory_mode TEXT NOT NULL,
        requested_scopes JSONB NOT NULL,
        selected_scopes JSONB NOT NULL,
        trimmed_record_ids JSONB NOT NULL,
        trim_reasons JSONB NOT NULL,
        result_state TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (trace_id, phase)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.runtime_writeback_submissions (
        trace_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        candidate_count INTEGER NOT NULL,
        submitted_count INTEGER NOT NULL,
        memory_mode TEXT NOT NULL,
        final_scopes JSONB NOT NULL,
        filtered_count INTEGER NOT NULL,
        filtered_reasons JSONB NOT NULL,
        scope_reasons JSONB NOT NULL,
        result_state TEXT NOT NULL,
        degraded BOOLEAN NOT NULL,
        degradation_reason TEXT NULL,
        duration_ms INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (trace_id, phase)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.runtime_dependency_status (
        name TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        detail TEXT NOT NULL,
        last_checked_at TIMESTAMPTZ NOT NULL
      )
    `);
  }

  async recordTurn(turn: RuntimeTurnRecord): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${quoteIdentifier(this.runtimeSchema)}.runtime_turns (
        trace_id, host, workspace_id, user_id, session_id, phase, task_id, thread_id, turn_id, current_input, assistant_output, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (trace_id, phase) DO UPDATE
      SET host = EXCLUDED.host,
          workspace_id = EXCLUDED.workspace_id,
          user_id = EXCLUDED.user_id,
          session_id = EXCLUDED.session_id,
          phase = EXCLUDED.phase,
          current_input = EXCLUDED.current_input,
          task_id = COALESCE(EXCLUDED.task_id, ${quoteIdentifier(this.runtimeSchema)}.runtime_turns.task_id),
          thread_id = COALESCE(EXCLUDED.thread_id, ${quoteIdentifier(this.runtimeSchema)}.runtime_turns.thread_id),
          turn_id = COALESCE(EXCLUDED.turn_id, ${quoteIdentifier(this.runtimeSchema)}.runtime_turns.turn_id),
          assistant_output = COALESCE(EXCLUDED.assistant_output, ${quoteIdentifier(this.runtimeSchema)}.runtime_turns.assistant_output),
          created_at = EXCLUDED.created_at
      `,
      [
        turn.trace_id,
        turn.host,
        turn.workspace_id,
        turn.user_id,
        turn.session_id,
        turn.phase,
        turn.task_id ?? null,
        turn.thread_id ?? null,
        turn.turn_id ?? null,
        turn.current_input,
        turn.assistant_output ?? null,
        turn.created_at,
      ],
    );
  }

  async recordTriggerRun(run: TriggerRunRecord): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${quoteIdentifier(this.runtimeSchema)}.runtime_trigger_runs (
        trace_id, phase, trigger_hit, trigger_type, trigger_reason, requested_memory_types, memory_mode, requested_scopes, scope_reason,
        importance_threshold, cooldown_applied, semantic_score, degraded, degradation_reason, duration_ms, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (trace_id, phase) DO UPDATE
      SET trigger_hit = EXCLUDED.trigger_hit,
          trigger_type = EXCLUDED.trigger_type,
          trigger_reason = EXCLUDED.trigger_reason,
          requested_memory_types = EXCLUDED.requested_memory_types,
          memory_mode = EXCLUDED.memory_mode,
          requested_scopes = EXCLUDED.requested_scopes,
          scope_reason = EXCLUDED.scope_reason,
          importance_threshold = EXCLUDED.importance_threshold,
          cooldown_applied = EXCLUDED.cooldown_applied,
          semantic_score = EXCLUDED.semantic_score,
          degraded = EXCLUDED.degraded,
          degradation_reason = EXCLUDED.degradation_reason,
          duration_ms = EXCLUDED.duration_ms,
          created_at = EXCLUDED.created_at
      `,
      [
        run.trace_id,
        run.phase,
        run.trigger_hit,
        run.trigger_type,
        run.trigger_reason,
        JSON.stringify(run.requested_memory_types),
        run.memory_mode,
        JSON.stringify(run.requested_scopes),
        run.scope_reason,
        run.importance_threshold,
        run.cooldown_applied,
        run.semantic_score ?? null,
        run.degraded ?? null,
        run.degradation_reason ?? null,
        run.duration_ms,
        run.created_at,
      ],
    );
  }

  async recordRecallRun(run: RecallRunRecord): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${quoteIdentifier(this.runtimeSchema)}.runtime_recall_runs (
        trace_id, phase, trigger_hit, trigger_type, trigger_reason, memory_mode, requested_scopes, matched_scopes, scope_hit_counts, scope_reason, query_scope, requested_memory_types,
        candidate_count, selected_count, result_state, degraded, degradation_reason, duration_ms, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (trace_id, phase) DO UPDATE
      SET trigger_hit = EXCLUDED.trigger_hit,
          trigger_type = EXCLUDED.trigger_type,
          trigger_reason = EXCLUDED.trigger_reason,
          memory_mode = EXCLUDED.memory_mode,
          requested_scopes = EXCLUDED.requested_scopes,
          matched_scopes = EXCLUDED.matched_scopes,
          scope_hit_counts = EXCLUDED.scope_hit_counts,
          scope_reason = EXCLUDED.scope_reason,
          query_scope = EXCLUDED.query_scope,
          requested_memory_types = EXCLUDED.requested_memory_types,
          candidate_count = EXCLUDED.candidate_count,
          selected_count = EXCLUDED.selected_count,
          result_state = EXCLUDED.result_state,
          degraded = EXCLUDED.degraded,
          degradation_reason = EXCLUDED.degradation_reason,
          duration_ms = EXCLUDED.duration_ms,
          created_at = EXCLUDED.created_at
      `,
      [
        run.trace_id,
        run.phase,
        run.trigger_hit,
        run.trigger_type,
        run.trigger_reason,
        run.memory_mode,
        JSON.stringify(run.requested_scopes),
        JSON.stringify(run.matched_scopes),
        JSON.stringify(run.scope_hit_counts),
        run.scope_reason,
        run.query_scope,
        JSON.stringify(run.requested_memory_types),
        run.candidate_count,
        run.selected_count,
        run.result_state,
        run.degraded,
        run.degradation_reason ?? null,
        run.duration_ms,
        run.created_at,
      ],
    );
  }

  async recordInjectionRun(run: InjectionRunRecord): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${quoteIdentifier(this.runtimeSchema)}.runtime_injection_runs (
        trace_id, phase, injected, injected_count, token_estimate, memory_mode, requested_scopes, selected_scopes, trimmed_record_ids, trim_reasons, result_state, duration_ms, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13)
      ON CONFLICT (trace_id, phase) DO UPDATE
      SET injected = EXCLUDED.injected,
          injected_count = EXCLUDED.injected_count,
          token_estimate = EXCLUDED.token_estimate,
          memory_mode = EXCLUDED.memory_mode,
          requested_scopes = EXCLUDED.requested_scopes,
          selected_scopes = EXCLUDED.selected_scopes,
          trimmed_record_ids = EXCLUDED.trimmed_record_ids,
          trim_reasons = EXCLUDED.trim_reasons,
          result_state = EXCLUDED.result_state,
          duration_ms = EXCLUDED.duration_ms,
          created_at = EXCLUDED.created_at
      `,
      [
        run.trace_id,
        run.phase,
        run.injected,
        run.injected_count,
        run.token_estimate,
        run.memory_mode,
        JSON.stringify(run.requested_scopes),
        JSON.stringify(run.selected_scopes),
        JSON.stringify(run.trimmed_record_ids),
        JSON.stringify(run.trim_reasons),
        run.result_state,
        run.duration_ms,
        run.created_at,
      ],
    );
  }

  async recordWritebackSubmission(run: WritebackSubmissionRecord): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${quoteIdentifier(this.runtimeSchema)}.runtime_writeback_submissions (
        trace_id, phase, candidate_count, submitted_count, memory_mode, final_scopes, filtered_count, filtered_reasons, scope_reasons, result_state, degraded, degradation_reason, duration_ms, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14)
      ON CONFLICT (trace_id, phase) DO UPDATE
      SET candidate_count = EXCLUDED.candidate_count,
          submitted_count = EXCLUDED.submitted_count,
          memory_mode = EXCLUDED.memory_mode,
          final_scopes = EXCLUDED.final_scopes,
          filtered_count = EXCLUDED.filtered_count,
          filtered_reasons = EXCLUDED.filtered_reasons,
          scope_reasons = EXCLUDED.scope_reasons,
          result_state = EXCLUDED.result_state,
          degraded = EXCLUDED.degraded,
          degradation_reason = EXCLUDED.degradation_reason,
          duration_ms = EXCLUDED.duration_ms,
          created_at = EXCLUDED.created_at
      `,
      [
        run.trace_id,
        run.phase,
        run.candidate_count,
        run.submitted_count,
        run.memory_mode,
        JSON.stringify(run.final_scopes),
        run.filtered_count,
        JSON.stringify(run.filtered_reasons),
        JSON.stringify(run.scope_reasons),
        run.result_state,
        run.degraded,
        run.degradation_reason ?? null,
        run.duration_ms,
        run.created_at,
      ],
    );
  }

  async findTraceIdByTurn(input: {
    session_id: string;
    turn_id: string;
  }): Promise<string | null> {
    const result = await this.pool.query<{ trace_id: string }>(
      `
      SELECT trace_id
      FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_turns
      WHERE session_id = $1
        AND turn_id = $2
        AND phase <> 'after_response'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [input.session_id, input.turn_id],
    );

    return result.rows[0]?.trace_id ?? null;
  }

  async updateDependencyStatus(status: DependencyStatus): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${quoteIdentifier(this.runtimeSchema)}.runtime_dependency_status (name, status, detail, last_checked_at)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (name) DO UPDATE
      SET status = EXCLUDED.status,
          detail = EXCLUDED.detail,
          last_checked_at = EXCLUDED.last_checked_at
      `,
      [status.name, status.status, status.detail, status.last_checked_at],
    );
  }

  async getDependencyStatus(): Promise<DependencyStatusSnapshot> {
    const result = await this.pool.query<DependencyStatusRow>(
      `SELECT name, status, detail, last_checked_at FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_dependency_status`,
    );

    const byName = new Map(result.rows.map((row) => [row.name, row]));
    const fallback = (name: DependencyStatus["name"]): DependencyStatus => ({
      name,
      status: byName.get(name)?.status ?? "unknown",
      detail: byName.get(name)?.detail ?? "dependency has not been checked yet",
      last_checked_at: byName.get(name) ? toIso(byName.get(name)!.last_checked_at) : new Date(0).toISOString(),
    });

    return {
      read_model: fallback("read_model"),
      embeddings: fallback("embeddings"),
      storage_writeback: fallback("storage_writeback"),
    };
  }

  async getRuns(filters?: ObserveRunsFilters): Promise<ObserveRunsResponse> {
    const whereClauses: string[] = [];
    const values: unknown[] = [];
    const page = filters?.page ?? 1;
    const pageSize = filters?.page_size ?? 20;
    const offset = (page - 1) * pageSize;

    if (filters?.session_id) {
      values.push(filters.session_id);
      whereClauses.push(`session_id = $${values.length}`);
    }
    if (filters?.turn_id) {
      values.push(filters.turn_id);
      whereClauses.push(`turn_id = $${values.length}`);
    }
    if (filters?.trace_id) {
      values.push(filters.trace_id);
      whereClauses.push(`trace_id = $${values.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ total: string }>(
      `
      SELECT COUNT(DISTINCT trace_id)::text AS total
      FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_turns
      ${whereSql}
      `,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const pagedValues = [...values, pageSize, offset];
    const turnQuery = `
      WITH latest_traces AS (
        SELECT DISTINCT ON (trace_id) trace_id, created_at
        FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_turns
        ${whereSql}
        ORDER BY trace_id, created_at DESC
      )
      SELECT turns.*
      FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_turns turns
      INNER JOIN (
        SELECT trace_id
        FROM latest_traces
        ORDER BY created_at DESC
        LIMIT $${pagedValues.length - 1} OFFSET $${pagedValues.length}
      ) paged ON paged.trace_id = turns.trace_id
      ORDER BY turns.created_at DESC
    `;
    const turnResult = await this.pool.query<RuntimeTurnRow>(turnQuery, pagedValues);
    const traceIds = [...new Set(turnResult.rows.map((row) => row.trace_id))];

    if (traceIds.length === 0) {
      return {
        turns: [],
        trigger_runs: [],
        recall_runs: [],
        injection_runs: [],
        writeback_submissions: [],
        total,
        page,
        page_size: pageSize,
        dependency_status: await this.getDependencyStatus(),
      };
    }

    const [triggerRows, recallRows, injectionRows, writebackRows] = await Promise.all([
      this.pool.query<TriggerRunRow>(
        `SELECT * FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_trigger_runs WHERE trace_id = ANY($1::text[]) ORDER BY created_at DESC`,
        [traceIds],
      ),
      this.pool.query<RecallRunRow>(
        `SELECT * FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_recall_runs WHERE trace_id = ANY($1::text[]) ORDER BY created_at DESC`,
        [traceIds],
      ),
      this.pool.query<InjectionRunRow>(
        `SELECT * FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_injection_runs WHERE trace_id = ANY($1::text[]) ORDER BY created_at DESC`,
        [traceIds],
      ),
      this.pool.query<WritebackRunRow>(
        `SELECT * FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_writeback_submissions WHERE trace_id = ANY($1::text[]) ORDER BY created_at DESC`,
        [traceIds],
      ),
    ]);

    return {
      turns: turnResult.rows.map((row) => ({
        trace_id: row.trace_id,
        host: row.host as RuntimeTurnRecord["host"],
        workspace_id: row.workspace_id,
        user_id: row.user_id,
        session_id: row.session_id,
        phase: row.phase as RuntimeTurnRecord["phase"],
        task_id: row.task_id ?? undefined,
        thread_id: row.thread_id ?? undefined,
        turn_id: row.turn_id ?? undefined,
        current_input: row.current_input,
        assistant_output: row.assistant_output ?? undefined,
        created_at: toIso(row.created_at),
      })),
      trigger_runs: triggerRows.rows.map((row) => ({
        trace_id: row.trace_id,
        phase: row.phase as TriggerRunRecord["phase"],
        trigger_hit: row.trigger_hit,
        trigger_type: row.trigger_type,
        trigger_reason: row.trigger_reason,
        requested_memory_types: asStringArray(row.requested_memory_types) as TriggerRunRecord["requested_memory_types"],
        memory_mode: row.memory_mode as TriggerRunRecord["memory_mode"],
        requested_scopes: asStringArray(row.requested_scopes) as TriggerRunRecord["requested_scopes"],
        scope_reason: row.scope_reason,
        importance_threshold: Number(row.importance_threshold),
        cooldown_applied: row.cooldown_applied,
        semantic_score: row.semantic_score ?? undefined,
        degraded: row.degraded ?? undefined,
        degradation_reason: row.degradation_reason ?? undefined,
        duration_ms: Number(row.duration_ms),
        created_at: toIso(row.created_at),
      })),
      recall_runs: recallRows.rows.map((row) => ({
        trace_id: row.trace_id,
        phase: row.phase as RecallRunRecord["phase"],
        trigger_hit: row.trigger_hit,
        trigger_type: row.trigger_type,
        trigger_reason: row.trigger_reason,
        memory_mode: row.memory_mode as RecallRunRecord["memory_mode"],
        requested_scopes: asStringArray(row.requested_scopes) as RecallRunRecord["requested_scopes"],
        matched_scopes: asStringArray(row.matched_scopes) as RecallRunRecord["matched_scopes"],
        scope_hit_counts: (row.scope_hit_counts as RecallRunRecord["scope_hit_counts"]) ?? {},
        scope_reason: row.scope_reason,
        query_scope: row.query_scope,
        requested_memory_types: asStringArray(row.requested_memory_types) as RecallRunRecord["requested_memory_types"],
        candidate_count: Number(row.candidate_count),
        selected_count: Number(row.selected_count),
        result_state: row.result_state,
        degraded: row.degraded,
        degradation_reason: row.degradation_reason ?? undefined,
        duration_ms: Number(row.duration_ms),
        created_at: toIso(row.created_at),
      })),
      injection_runs: injectionRows.rows.map((row) => ({
        trace_id: row.trace_id,
        phase: row.phase as InjectionRunRecord["phase"],
        injected: row.injected,
        injected_count: Number(row.injected_count),
        token_estimate: Number(row.token_estimate),
        memory_mode: row.memory_mode as InjectionRunRecord["memory_mode"],
        requested_scopes: asStringArray(row.requested_scopes) as InjectionRunRecord["requested_scopes"],
        selected_scopes: asStringArray(row.selected_scopes) as InjectionRunRecord["selected_scopes"],
        trimmed_record_ids: asStringArray(row.trimmed_record_ids),
        trim_reasons: asStringArray(row.trim_reasons),
        result_state: row.result_state,
        duration_ms: Number(row.duration_ms),
        created_at: toIso(row.created_at),
      })),
      writeback_submissions: writebackRows.rows.map((row) => ({
        trace_id: row.trace_id,
        phase: row.phase as WritebackSubmissionRecord["phase"],
        candidate_count: Number(row.candidate_count),
        submitted_count: Number(row.submitted_count),
        memory_mode: row.memory_mode as WritebackSubmissionRecord["memory_mode"],
        final_scopes: asStringArray(row.final_scopes) as WritebackSubmissionRecord["final_scopes"],
        filtered_count: Number(row.filtered_count),
        filtered_reasons: asStringArray(row.filtered_reasons),
        scope_reasons: asStringArray(row.scope_reasons),
        result_state: row.result_state,
        degraded: row.degraded,
        degradation_reason: row.degradation_reason ?? undefined,
        duration_ms: Number(row.duration_ms),
        created_at: toIso(row.created_at),
      })),
      total,
      page,
      page_size: pageSize,
      dependency_status: await this.getDependencyStatus(),
    };
  }

  async getMetrics(): Promise<ObserveMetricsResponse> {
    const [triggerRows, recallRows, injectionRows, writebackRows] = await Promise.all([
      this.pool.query<Pick<TriggerRunRow, "trigger_hit">>(`SELECT trigger_hit FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_trigger_runs`),
      this.pool.query<Pick<RecallRunRow, "trigger_hit" | "selected_count" | "duration_ms">>(
        `SELECT trigger_hit, selected_count, duration_ms FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_recall_runs`,
      ),
      this.pool.query<Pick<InjectionRunRow, "injected" | "trimmed_record_ids" | "duration_ms">>(
        `SELECT injected, trimmed_record_ids, duration_ms FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_injection_runs`,
      ),
      this.pool.query<Pick<WritebackRunRow, "submitted_count">>(
        `SELECT submitted_count FROM ${quoteIdentifier(this.runtimeSchema)}.runtime_writeback_submissions`,
      ),
    ]);

    const triggerCount = triggerRows.rows.length;
    const recallCount = recallRows.rows.length;
    const injectionCount = injectionRows.rows.length;
    const writebackCount = writebackRows.rows.length;

    return {
      trigger_rate:
        triggerCount === 0 ? 0 : triggerRows.rows.filter((row) => row.trigger_hit).length / triggerCount,
      recall_hit_rate:
        recallCount === 0 ? 0 : recallRows.rows.filter((row) => Number(row.selected_count) > 0).length / recallCount,
      empty_recall_rate:
        recallCount === 0
          ? 0
          : recallRows.rows.filter((row) => row.trigger_hit && Number(row.selected_count) === 0).length / recallCount,
      injection_rate:
        injectionCount === 0 ? 0 : injectionRows.rows.filter((row) => row.injected).length / injectionCount,
      injection_trim_rate:
        injectionCount === 0
          ? 0
          : injectionRows.rows.filter((row) => asStringArray(row.trimmed_record_ids).length > 0).length / injectionCount,
      writeback_submission_rate:
        writebackCount === 0 ? 0 : writebackRows.rows.filter((row) => Number(row.submitted_count) > 0).length / writebackCount,
      query_p95_ms: percentile(recallRows.rows.map((row) => Number(row.duration_ms)), 0.95),
      injection_p95_ms: percentile(injectionRows.rows.map((row) => Number(row.duration_ms)), 0.95),
    };
  }
}

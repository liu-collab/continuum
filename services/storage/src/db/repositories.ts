import { randomUUID } from "node:crypto";

import type {
  AcceptedWriteBackJob,
  GovernanceAction,
  MemoryConflict,
  MemoryRecord,
  MemoryRecordVersion,
  MemoryStatus,
  MemoryWriteJob,
  RecordListPage,
  ReadModelEntry,
  ReadModelRefreshJob,
  ResolveConflictInput,
  StorageMetrics,
  WriteBackCandidate,
  WriteJobStatus,
} from "../contracts.js";
import { NotFoundError } from "../errors.js";
import type { DbSession, StorageDatabase } from "./client.js";
import { quoteIdentifier } from "./client.js";

export interface JobCreateInput {
  idempotency_key: string;
  candidate_hash: string;
  source_service: string;
  candidate: WriteBackCandidate;
}

export interface WriteJobRepository {
  enqueue(input: JobCreateInput): Promise<MemoryWriteJob>;
  enqueueMany(inputs: JobCreateInput[]): Promise<MemoryWriteJob[]>;
  findById(id: string): Promise<MemoryWriteJob | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<MemoryWriteJob | null>;
  claimQueuedJobs(limit: number): Promise<MemoryWriteJob[]>;
  markSucceeded(
    jobId: string,
    payload: { result_record_id: string; result_status: string },
  ): Promise<void>;
  markDeadLetter(
    jobId: string,
    payload: { error_code: string; error_message: string },
  ): Promise<void>;
  requeue(jobId: string, errorMessage: string): Promise<void>;
  listRecent(limit: number): Promise<MemoryWriteJob[]>;
}

export interface RecordRepository {
  findById(recordId: string): Promise<MemoryRecord | null>;
  findByDedupeScope(input: {
    workspace_id: string;
    user_id: string | null;
    task_id?: string | null;
    session_id?: string | null;
    scope: string;
    dedupe_key: string;
  }): Promise<MemoryRecord[]>;
  insertRecord(record: Omit<MemoryRecord, "created_at" | "updated_at" | "version">): Promise<MemoryRecord>;
  updateRecord(
    recordId: string,
    patch: Partial<
      Pick<
        MemoryRecord,
        | "summary"
        | "details_json"
        | "importance"
        | "confidence"
        | "status"
        | "scope"
        | "archived_at"
        | "deleted_at"
        | "last_confirmed_at"
      >
    >,
  ): Promise<MemoryRecord>;
  appendVersion(input: Omit<MemoryRecordVersion, "id" | "changed_at">): Promise<MemoryRecordVersion>;
  listRecords(filters: {
    workspace_id: string;
    user_id?: string | undefined;
    task_id?: string | undefined;
    memory_type?: string | undefined;
    scope?: string | undefined;
    status?: string | undefined;
    page: number;
    page_size: number;
  }): Promise<RecordListPage>;
  getVersion(recordId: string, versionNo: number): Promise<MemoryRecordVersion | null>;
  listVersions(recordId: string): Promise<MemoryRecordVersion[]>;
}

export interface ConflictRepository {
  openConflict(input: Omit<MemoryConflict, "id" | "created_at" | "resolved_at" | "status" | "resolution_type" | "resolved_by">): Promise<MemoryConflict>;
  listConflicts(status?: string): Promise<MemoryConflict[]>;
  findById(conflictId: string): Promise<MemoryConflict | null>;
  resolveConflict(conflictId: string, payload: ResolveConflictInput): Promise<MemoryConflict>;
}

export interface GovernanceRepository {
  appendAction(input: {
    record_id: string;
    action_type: string;
    action_payload: Record<string, unknown>;
    actor_type: string;
    actor_id: string;
  }): Promise<void>;
  listActions(recordId: string): Promise<GovernanceAction[]>;
}

export interface ReadModelRepository {
  upsert(entry: ReadModelEntry): Promise<void>;
  delete(recordId: string): Promise<void>;
  findById(recordId: string): Promise<ReadModelEntry | null>;
  listPendingEmbeddings(limit: number): Promise<ReadModelEntry[]>;
  enqueueRefresh(input: {
    source_record_id: string;
    refresh_type: "insert" | "update" | "delete";
  }): Promise<ReadModelRefreshJob>;
  claimRefreshJobs(limit: number): Promise<ReadModelRefreshJob[]>;
  markRefreshSucceeded(
    jobId: string,
    payload?: { embedding_updated: boolean; degradation_reason: string | undefined },
  ): Promise<void>;
  markRefreshFailed(jobId: string, errorMessage: string): Promise<void>;
  markRefreshDeadLetter(jobId: string, errorMessage: string): Promise<void>;
}

export interface MetricsRepository {
  collect(): Promise<StorageMetrics>;
}

export interface StorageRepositories {
  jobs: WriteJobRepository;
  records: RecordRepository;
  conflicts: ConflictRepository;
  governance: GovernanceRepository;
  readModel: ReadModelRepository;
  metrics: MetricsRepository;
  transaction<T>(callback: (repositories: StorageRepositories) => Promise<T>): Promise<T>;
}

export interface ReadModelRefreshStatusSummary {
  max_retry_count: number;
}

export function createRepositories(database: StorageDatabase): StorageRepositories {
  const createScoped = (session: DbSession): StorageRepositories => {
    const repositories: StorageRepositories = {
      jobs: createWriteJobRepository(session),
      records: createRecordRepository(session),
      conflicts: createConflictRepository(session),
      governance: createGovernanceRepository(session),
      readModel: createReadModelRepository(session),
      metrics: createMetricsRepository(session),
      transaction: async <T>(callback: (repositories: StorageRepositories) => Promise<T>) =>
        database.withTransaction(async (tx) => callback(createScoped(tx))),
    };

    return repositories;
  };

  return createScoped(database.session());
}

function createWriteJobRepository(session: DbSession): WriteJobRepository {
  const table = tableName(session.privateSchema, "memory_write_jobs");

  return {
    async enqueue(input) {
      const existing = await this.findByIdempotencyKey(input.idempotency_key);
      if (existing) {
        return existing;
      }

      const result = await session.query(
        `
          insert into ${table}
            (idempotency_key, workspace_id, user_id, candidate_json, candidate_hash, source_service, job_status)
          values
            ($1, $2, $3, $4::jsonb, $5, $6, 'queued')
          returning *
        `,
        [
          input.idempotency_key,
          input.candidate.workspace_id,
          input.candidate.user_id ?? null,
          JSON.stringify(input.candidate),
          input.candidate_hash,
          input.source_service,
        ],
      );

      return mapWriteJob(requireRow(result.rows[0], "memory_write_jobs insert"));
    },

    async enqueueMany(inputs) {
      const jobs: MemoryWriteJob[] = [];
      for (const input of inputs) {
        const existing = await this.findByIdempotencyKey(input.idempotency_key);
        if (existing) {
          jobs.push(existing);
          continue;
        }

        const result = await session.query(
          `
            insert into ${table}
              (idempotency_key, workspace_id, user_id, candidate_json, candidate_hash, source_service, job_status)
            values
              ($1, $2, $3, $4::jsonb, $5, $6, 'queued')
            returning *
          `,
          [
            input.idempotency_key,
            input.candidate.workspace_id,
            input.candidate.user_id ?? null,
            JSON.stringify(input.candidate),
            input.candidate_hash,
            input.source_service,
          ],
        );
        jobs.push(mapWriteJob(requireRow(result.rows[0], "memory_write_jobs enqueueMany insert")));
      }
      return jobs;
    },

    async findById(id) {
      const result = await session.query(`select * from ${table} where id = $1`, [id]);
      return result.rows[0] ? mapWriteJob(result.rows[0]) : null;
    },

    async findByIdempotencyKey(idempotencyKey) {
      const result = await session.query(
        `select * from ${table} where idempotency_key = $1`,
        [idempotencyKey],
      );

      return result.rows[0] ? mapWriteJob(result.rows[0]) : null;
    },

    async claimQueuedJobs(limit) {
      const result = await session.query(
        `
          with jobs as (
            select id
            from ${table}
            where job_status in ('queued', 'failed')
            order by received_at asc
            for update skip locked
            limit $1
          )
          update ${table} target
          set job_status = 'processing',
              started_at = now(),
              error_code = null,
              error_message = null
          from jobs
          where target.id = jobs.id
          returning target.*
        `,
        [limit],
      );

      return result.rows.map(mapWriteJob);
    },

    async markSucceeded(jobId, payload) {
      await session.query(
        `
          update ${table}
          set job_status = 'succeeded',
              result_record_id = $2,
              result_status = $3,
              finished_at = now()
          where id = $1
        `,
        [jobId, payload.result_record_id, payload.result_status],
      );
    },

    async markDeadLetter(jobId, payload) {
      await session.query(
        `
          update ${table}
          set job_status = 'dead_letter',
              error_code = $2,
              error_message = $3,
              retry_count = retry_count + 1,
              finished_at = now()
          where id = $1
        `,
        [jobId, payload.error_code, payload.error_message],
      );
    },

    async requeue(jobId, errorMessage) {
      await session.query(
        `
          update ${table}
          set job_status = 'failed',
              error_message = $2,
              retry_count = retry_count + 1,
              finished_at = now()
          where id = $1
        `,
        [jobId, errorMessage],
      );
    },

    async listRecent(limit) {
      const result = await session.query(
        `select * from ${table} order by received_at desc limit $1`,
        [limit],
      );

      return result.rows.map(mapWriteJob);
    },
  };
}

function createRecordRepository(session: DbSession): RecordRepository {
  const table = tableName(session.privateSchema, "memory_records");
  const versionsTable = tableName(session.privateSchema, "memory_record_versions");

  return {
    async findById(recordId) {
      const result = await session.query(`select * from ${table} where id = $1`, [recordId]);
      return result.rows[0] ? mapMemoryRecord(result.rows[0]) : null;
    },

    async findByDedupeScope(input) {
      const result = await session.query(
        buildFindByDedupeScopeQuery(table, input),
        buildFindByDedupeScopeParams(input),
      );

      return result.rows.map(mapMemoryRecord);
    },

    async insertRecord(record) {
      const result = await session.query(
        `
          insert into ${table}
            (
              id, workspace_id, user_id, task_id, session_id, memory_type, scope, status,
              summary, details_json, importance, confidence, dedupe_key, source_type, source_ref,
              created_by_service, last_confirmed_at, archived_at, deleted_at
            )
          values
            (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10::jsonb, $11, $12, $13, $14, $15,
              $16, $17, $18, $19
            )
          returning *
        `,
        [
          record.id,
          record.workspace_id,
          record.user_id,
          record.task_id,
          record.session_id,
          record.memory_type,
          record.scope,
          record.status,
          record.summary,
          JSON.stringify(record.details_json),
          record.importance,
          record.confidence,
          record.dedupe_key,
          record.source_type,
          record.source_ref,
          record.created_by_service,
          record.last_confirmed_at,
          record.archived_at,
          record.deleted_at,
        ],
      );

      return mapMemoryRecord(requireRow(result.rows[0], "memory_records insert"));
    },

    async updateRecord(recordId, patch) {
      const sets: string[] = [];
      const values: unknown[] = [recordId];

      const addSet = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };

      if (patch.summary !== undefined) addSet("summary", patch.summary);
      if (patch.details_json !== undefined) addSet("details_json", JSON.stringify(patch.details_json));
      if (patch.importance !== undefined) addSet("importance", patch.importance);
      if (patch.confidence !== undefined) addSet("confidence", patch.confidence);
      if (patch.status !== undefined) addSet("status", patch.status);
      if (patch.scope !== undefined) addSet("scope", patch.scope);
      if (patch.archived_at !== undefined) addSet("archived_at", patch.archived_at);
      if (patch.deleted_at !== undefined) addSet("deleted_at", patch.deleted_at);
      if (patch.last_confirmed_at !== undefined) addSet("last_confirmed_at", patch.last_confirmed_at);

      addSet("updated_at", new Date().toISOString());
      sets.push("version = version + 1");

      const result = await session.query(
        `
          update ${table}
          set ${sets.join(", ")}
          where id = $1
          returning *
        `,
        values,
      );

      if (!result.rows[0]) {
        throw new NotFoundError("memory record not found", { recordId });
      }

      return mapMemoryRecord(result.rows[0]);
    },

    async appendVersion(input) {
      const result = await session.query(
        `
          insert into ${versionsTable}
            (record_id, version_no, snapshot_json, change_type, change_reason, changed_by_type, changed_by_id)
          values
            ($1, $2, $3::jsonb, $4, $5, $6, $7)
          returning *
        `,
        [
          input.record_id,
          input.version_no,
          JSON.stringify(input.snapshot_json),
          input.change_type,
          input.change_reason,
          input.changed_by_type,
          input.changed_by_id,
        ],
      );

      return mapVersion(requireRow(result.rows[0], "memory_record_versions insert"));
    },

    async listRecords(filters) {
      const conditions: string[] = [];
      const values: unknown[] = [];

      const addCondition = (column: string, value: unknown) => {
        values.push(value);
        conditions.push(`${column} = $${values.length}`);
      };

      if (filters.user_id) addCondition("user_id", filters.user_id);
      if (filters.task_id) addCondition("task_id", filters.task_id);
      if (filters.memory_type) addCondition("memory_type", filters.memory_type);
      if (filters.scope) addCondition("scope", filters.scope);
      if (filters.status) addCondition("status", filters.status);

      if (filters.scope && filters.scope !== "user") {
        addCondition("workspace_id", filters.workspace_id);
      } else if (!filters.scope) {
        values.push(filters.workspace_id);
        conditions.push(
          `(scope = 'user' or (scope <> 'user' and workspace_id = $${values.length}))`,
        );
      }

      const countValues = [...values];
      countValues.push(filters.page_size);
      countValues.push((filters.page - 1) * filters.page_size);

      const [result, countResult] = await Promise.all([
        session.query(
        `
          select *
          from ${table}
          ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
          order by updated_at desc
          limit $${countValues.length - 1}
          offset $${countValues.length}
        `,
          countValues,
        ),
        session.query<{ total: string }>(
          `
            select count(*)::int as total
            from ${table}
            ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
          `,
          values,
        ),
      ]);

      return {
        items: result.rows.map(mapMemoryRecord),
        total: Number(countResult.rows[0]?.total ?? 0),
        page: filters.page,
        page_size: filters.page_size,
      };
    },

    async getVersion(recordId, versionNo) {
      const result = await session.query(
        `
          select *
          from ${versionsTable}
          where record_id = $1 and version_no = $2
        `,
        [recordId, versionNo],
      );

      return result.rows[0] ? mapVersion(result.rows[0]) : null;
    },
    async listVersions(recordId) {
      const result = await session.query(
        `
          select *
          from ${versionsTable}
          where record_id = $1
          order by changed_at desc, version_no desc
        `,
        [recordId],
      );

      return result.rows.map(mapVersion);
    },
  };
}

function createConflictRepository(session: DbSession): ConflictRepository {
  const table = tableName(session.privateSchema, "memory_conflicts");

  return {
    async openConflict(input) {
      const result = await session.query(
        `
          insert into ${table}
            (
              workspace_id,
              user_id,
              record_id,
              conflict_with_record_id,
              pending_record_id,
              existing_record_id,
              conflict_type,
              conflict_summary,
              status
            )
          values
            ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
          returning *
        `,
        [
          input.workspace_id,
          input.user_id,
          input.record_id,
          input.conflict_with_record_id,
          input.pending_record_id,
          input.existing_record_id,
          input.conflict_type,
          input.conflict_summary,
        ],
      );

      return mapConflict(requireRow(result.rows[0], "memory_conflicts insert"));
    },

    async listConflicts(status) {
      const result = await session.query(
        `
          select *
          from ${table}
          ${status ? "where status = $1" : ""}
          order by created_at desc
        `,
        status ? [status] : [],
      );

      return result.rows.map(mapConflict);
    },

    async findById(conflictId) {
      const result = await session.query(`select * from ${table} where id = $1`, [conflictId]);
      return result.rows[0] ? mapConflict(result.rows[0]) : null;
    },

    async resolveConflict(conflictId, payload) {
      const result = await session.query(
        `
          update ${table}
          set status = 'resolved',
              resolution_type = $2,
              resolved_by = $3,
              resolved_at = now()
          where id = $1
          returning *
        `,
        [conflictId, payload.resolution_type, payload.resolved_by],
      );

      if (!result.rows[0]) {
        throw new NotFoundError("memory conflict not found", { conflictId });
      }

      return mapConflict(result.rows[0]);
    },
  };
}

function createGovernanceRepository(session: DbSession): GovernanceRepository {
  const table = tableName(session.privateSchema, "memory_governance_actions");

  return {
    async appendAction(input) {
      await session.query(
        `
          insert into ${table}
            (record_id, action_type, action_payload, actor_type, actor_id)
          values
            ($1, $2, $3::jsonb, $4, $5)
        `,
        [
          input.record_id,
          input.action_type,
          JSON.stringify(input.action_payload),
          input.actor_type,
          input.actor_id,
        ],
      );
    },
    async listActions(recordId) {
      const result = await session.query(
        `
          select record_id, action_type, action_payload, actor_type, actor_id, created_at
          from ${table}
          where record_id = $1
          order by created_at desc
        `,
        [recordId],
      );

      return result.rows.map((row) => ({
        record_id: String(row.record_id),
        action_type: String(row.action_type) as GovernanceAction["action_type"],
        action_payload: (row.action_payload as Record<string, unknown> | null) ?? {},
        actor_type: String(row.actor_type) as GovernanceAction["actor_type"],
        actor_id: String(row.actor_id),
        created_at: toIsoString(row.created_at),
      }));
    },
  };
}

function createReadModelRepository(session: DbSession): ReadModelRepository {
  const table = tableName(session.sharedSchema, "memory_read_model_v1");
  const refreshTable = tableName(session.privateSchema, "memory_read_model_refresh_jobs");

  return {
    async upsert(entry) {
      await session.query(
        `
          insert into ${table}
            (
              id, workspace_id, user_id, task_id, session_id, memory_type, scope, status,
              summary, details, importance, confidence, source,
              last_confirmed_at, last_used_at, created_at, updated_at, summary_embedding,
              embedding_status, embedding_attempted_at, embedding_attempt_count
            )
          values
            (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10::jsonb, $11, $12, $13::jsonb, $14,
              $15, $16, $17, $18::vector, $19, $20, $21
            )
          on conflict (id) do update
          set workspace_id = excluded.workspace_id,
              user_id = excluded.user_id,
              task_id = excluded.task_id,
              session_id = excluded.session_id,
              memory_type = excluded.memory_type,
              scope = excluded.scope,
              status = excluded.status,
              summary = excluded.summary,
              details = excluded.details,
              importance = excluded.importance,
              confidence = excluded.confidence,
              source = excluded.source,
              last_confirmed_at = excluded.last_confirmed_at,
              last_used_at = excluded.last_used_at,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at,
              summary_embedding = excluded.summary_embedding,
              embedding_status = excluded.embedding_status,
              embedding_attempted_at = excluded.embedding_attempted_at,
              embedding_attempt_count = excluded.embedding_attempt_count
        `,
        [
          entry.id,
          entry.workspace_id,
          entry.user_id,
          entry.task_id,
          entry.session_id,
          entry.memory_type,
          entry.scope,
          entry.status,
          entry.summary,
          JSON.stringify(entry.details),
          entry.importance,
          entry.confidence,
          JSON.stringify(entry.source),
          entry.last_confirmed_at,
          entry.last_used_at,
          entry.created_at,
          entry.updated_at,
          entry.summary_embedding ? `[${entry.summary_embedding.join(",")}]` : null,
          entry.embedding_status ?? "ok",
          entry.embedding_attempted_at ?? null,
          entry.embedding_attempt_count ?? 0,
        ],
      );
    },

    async delete(recordId) {
      await session.query(`delete from ${table} where id = $1`, [recordId]);
    },

    async findById(recordId) {
      const result = await session.query(`select * from ${table} where id = $1`, [recordId]);
      return result.rows[0] ? mapReadModel(result.rows[0]) : null;
    },

    async listPendingEmbeddings(limit) {
      const result = await session.query(
        `
          select *
          from ${table}
          where embedding_status = 'pending'
          order by updated_at asc
          limit $1
        `,
        [limit],
      );

      return result.rows.map(mapReadModel);
    },

    async enqueueRefresh(input) {
      const result = await session.query(
        `
          insert into ${refreshTable}
            (source_record_id, refresh_type, job_status)
          values
            ($1, $2, 'queued')
          returning *
        `,
        [input.source_record_id, input.refresh_type],
      );

      return mapRefreshJob(requireRow(result.rows[0], "memory_read_model_refresh_jobs insert"));
    },

    async claimRefreshJobs(limit) {
      const result = await session.query(
        `
          with jobs as (
            select id
            from ${refreshTable}
            where job_status in ('queued', 'failed')
            order by created_at asc
            for update skip locked
            limit $1
          )
          update ${refreshTable} target
          set job_status = 'processing',
              started_at = now(),
              error_message = null
          from jobs
          where target.id = jobs.id
          returning target.*
        `,
        [limit],
      );

      return result.rows.map(mapRefreshJob);
    },

    async markRefreshSucceeded(jobId, payload) {
      await session.query(
        `
          update ${refreshTable}
          set job_status = 'succeeded',
              embedding_updated_at = case when $2::boolean then now() else null end,
              error_message = $3,
              finished_at = now()
          where id = $1
        `,
        [jobId, payload?.embedding_updated ?? false, payload?.degradation_reason ?? null],
      );
    },

    async markRefreshFailed(jobId, errorMessage) {
      await session.query(
        `
          update ${refreshTable}
          set job_status = 'failed',
              error_message = $2,
              retry_count = retry_count + 1,
              finished_at = now()
          where id = $1
        `,
        [jobId, errorMessage],
      );
    },

    async markRefreshDeadLetter(jobId, errorMessage) {
      await session.query(
        `
          update ${refreshTable}
          set job_status = 'dead_letter',
              error_message = $2,
              retry_count = retry_count + 1,
              finished_at = now()
          where id = $1
        `,
        [jobId, errorMessage],
      );
    },
  };
}

function createMetricsRepository(session: DbSession): MetricsRepository {
  const jobsTable = tableName(session.privateSchema, "memory_write_jobs");
  const recordsTable = tableName(session.privateSchema, "memory_records");
  const conflictsTable = tableName(session.privateSchema, "memory_conflicts");
  const refreshTable = tableName(session.privateSchema, "memory_read_model_refresh_jobs");

  return {
    async collect() {
      const [jobs, records, conflicts, outcomes, projector, embeddingState] = await Promise.all([
        session.query(`
          select
            count(*)::int as write_jobs_total,
            count(*) filter (where job_status = 'queued')::int as queued_jobs,
            count(*) filter (where job_status = 'processing')::int as processing_jobs,
            count(*) filter (where job_status = 'succeeded')::int as succeeded_jobs,
            count(*) filter (where job_status = 'failed')::int as failed_jobs,
            count(*) filter (where job_status = 'dead_letter')::int as dead_letter_jobs
          from ${jobsTable}
        `),
        session.query(`
          select
            count(*) filter (where status = 'active')::int as active_records,
            count(*) filter (where status = 'pending_confirmation')::int as pending_confirmation_records,
            count(*) filter (where status = 'archived')::int as archived_records
          from ${recordsTable}
        `),
        session.query(`
          select count(*)::int as conflicts_open
          from ${conflictsTable}
          where status = 'open'
        `),
        session.query(`
          select
            count(*) filter (where result_status = 'ignore_duplicate')::int as duplicate_ignored_jobs,
            count(*) filter (where result_status = 'merge_existing')::int as merged_jobs,
            count(*) filter (where result_status = 'update_existing')::int as updated_jobs,
            count(*) filter (where result_status = 'insert_new')::int as inserted_jobs
          from ${jobsTable}
        `),
        session.query(`
          select
            count(*) filter (where job_status = 'failed')::int as projector_failed_jobs,
            count(*) filter (where job_status = 'dead_letter')::int as projector_dead_letter_jobs,
            count(*) filter (
              where job_status = 'succeeded'
                and error_message = 'embedding_unavailable'
            )::int as projector_embedding_degraded_jobs
          from ${refreshTable}
        `),
        session.query(`
          select
            count(*) filter (where embedding_status = 'pending')::int as pending_embedding_records,
            count(*) filter (
              where embedding_status = 'pending'
                and coalesce(embedding_attempt_count, 0) <= 1
            )::int as new_pending_embedding_records,
            count(*) filter (
              where embedding_status = 'pending'
                and coalesce(embedding_attempt_count, 0) > 1
            )::int as retry_pending_embedding_records,
            coalesce(
              max(
                extract(
                  epoch from (
                    now() - coalesce(embedding_attempted_at, updated_at, created_at)
                  )
                )
              ) filter (where embedding_status = 'pending'),
              0
            )::int as oldest_pending_embedding_age_seconds
          from ${tableName(session.sharedSchema, "memory_read_model_v1")}
        `),
      ]);

      return {
        ...toMetricObject(jobs.rows[0]),
        ...toMetricObject(records.rows[0]),
        ...toMetricObject(conflicts.rows[0]),
        ...toMetricObject(outcomes.rows[0]),
        ...toMetricObject(projector.rows[0]),
        ...toMetricObject(embeddingState.rows[0]),
      } as unknown as StorageMetrics;
    },
  };
}

function tableName(schema: string, table: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function mapWriteJob(row: Record<string, unknown>): MemoryWriteJob {
  return {
    id: String(row.id),
    idempotency_key: String(row.idempotency_key),
    workspace_id: String(row.workspace_id),
    user_id: nullableString(row.user_id),
    candidate_json: row.candidate_json as WriteBackCandidate,
    candidate_hash: String(row.candidate_hash),
    source_service: String(row.source_service),
    job_status: row.job_status as WriteJobStatus,
    result_record_id: nullableString(row.result_record_id),
    result_status: nullableString(row.result_status),
    error_code: nullableString(row.error_code),
    error_message: nullableString(row.error_message),
    retry_count: Number(row.retry_count),
    received_at: toIsoString(row.received_at),
    started_at: nullableIsoString(row.started_at),
    finished_at: nullableIsoString(row.finished_at),
  };
}

function mapMemoryRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    user_id: nullableString(row.user_id),
    task_id: nullableString(row.task_id),
    session_id: nullableString(row.session_id),
    memory_type: row.memory_type as MemoryRecord["memory_type"],
    scope: row.scope as MemoryRecord["scope"],
    status: row.status as MemoryStatus,
    summary: String(row.summary),
    details_json: row.details_json as Record<string, unknown>,
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    dedupe_key: String(row.dedupe_key),
    source_type: String(row.source_type),
    source_ref: String(row.source_ref),
    created_by_service: String(row.created_by_service),
    last_confirmed_at: nullableIsoString(row.last_confirmed_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    archived_at: nullableIsoString(row.archived_at),
    deleted_at: nullableIsoString(row.deleted_at),
    version: Number(row.version),
  };
}

function mapVersion(row: Record<string, unknown>): MemoryRecordVersion {
  return {
    id: String(row.id),
    record_id: String(row.record_id),
    version_no: Number(row.version_no),
    snapshot_json: row.snapshot_json as Record<string, unknown>,
    change_type: String(row.change_type),
    change_reason: String(row.change_reason),
    changed_by_type: String(row.changed_by_type),
    changed_by_id: String(row.changed_by_id),
    changed_at: toIsoString(row.changed_at),
  };
}

function mapConflict(row: Record<string, unknown>): MemoryConflict {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    user_id: nullableString(row.user_id),
    record_id: String(row.record_id),
    conflict_with_record_id: String(row.conflict_with_record_id),
    pending_record_id: nullableString(row.pending_record_id),
    existing_record_id: nullableString(row.existing_record_id),
    conflict_type: row.conflict_type as MemoryConflict["conflict_type"],
    conflict_summary: String(row.conflict_summary),
    status: row.status as MemoryConflict["status"],
    resolution_type: nullableString(row.resolution_type),
    resolved_by: nullableString(row.resolved_by),
    created_at: toIsoString(row.created_at),
    resolved_at: nullableIsoString(row.resolved_at),
  };
}

function mapReadModel(row: Record<string, unknown>): ReadModelEntry {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    user_id: nullableString(row.user_id),
    task_id: nullableString(row.task_id),
    session_id: nullableString(row.session_id),
    memory_type: row.memory_type as ReadModelEntry["memory_type"],
    scope: row.scope as ReadModelEntry["scope"],
    status: row.status as ReadModelEntry["status"],
    summary: String(row.summary),
    details: (row.details as Record<string, unknown> | null) ?? null,
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    source: (row.source as Record<string, unknown> | null) ?? null,
    last_confirmed_at: nullableIsoString(row.last_confirmed_at),
    last_used_at: nullableIsoString(row.last_used_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    summary_embedding: parseVector(row.summary_embedding),
    embedding_status: nullableString(row.embedding_status) as ReadModelEntry["embedding_status"],
    embedding_attempted_at: nullableIsoString(row.embedding_attempted_at),
    embedding_attempt_count: Number(row.embedding_attempt_count ?? 0),
  };
}

function mapRefreshJob(row: Record<string, unknown>): ReadModelRefreshJob {
  return {
    id: String(row.id),
    source_record_id: String(row.source_record_id),
    refresh_type: row.refresh_type as ReadModelRefreshJob["refresh_type"],
    job_status: row.job_status as ReadModelRefreshJob["job_status"],
    retry_count: Number(row.retry_count),
    error_message: nullableString(row.error_message),
    created_at: toIsoString(row.created_at),
    started_at: nullableIsoString(row.started_at),
    finished_at: nullableIsoString(row.finished_at),
  };
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}

function nullableIsoString(value: unknown): string | null {
  return value ? toIsoString(value) : null;
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function toMetricObject(row: Record<string, unknown> | undefined) {
  if (!row) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]),
  );
}

export function buildRecordFromNormalized(input: {
  normalized: {
    workspace_id: string;
    user_id: string | null;
    task_id: string | null;
    session_id: string | null;
    memory_type: MemoryRecord["memory_type"];
    scope: MemoryRecord["scope"];
    summary: string;
    details: Record<string, unknown>;
    importance: number;
    confidence: number;
    dedupe_key: string;
    source_type: string;
    source_ref: string;
    source_service: string;
    source: { confirmed_by_user: boolean };
  };
  status?: MemoryStatus;
}): Omit<MemoryRecord, "created_at" | "updated_at" | "version"> {
  return {
    id: randomUUID(),
    workspace_id: input.normalized.workspace_id,
    user_id: input.normalized.user_id ?? null,
    task_id: input.normalized.task_id ?? null,
    session_id: input.normalized.session_id ?? null,
    memory_type: input.normalized.memory_type,
    scope: input.normalized.scope,
    status: input.status ?? "active",
    summary: input.normalized.summary,
    details_json: input.normalized.details,
    importance: input.normalized.importance,
    confidence: input.normalized.confidence,
    dedupe_key: input.normalized.dedupe_key,
    source_type: input.normalized.source_type,
    source_ref: input.normalized.source_ref,
    created_by_service: input.normalized.source_service,
    last_confirmed_at: input.normalized.source?.confirmed_by_user
      ? new Date().toISOString()
      : null,
    archived_at: null,
    deleted_at: null,
  };
}

export function snapshotRecord(record: MemoryRecord): Record<string, unknown> {
  return { ...record };
}

function requireRow(
  row: Record<string, unknown> | undefined,
  label: string,
): Record<string, unknown> {
  if (!row) {
    throw new Error(`expected row for ${label}`);
  }

  return row;
}

function parseVector(value: unknown): number[] | null {
  if (!value) {
    return null;
  }

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

  return null;
}

function buildFindByDedupeScopeQuery(
  table: string,
  input: {
    workspace_id: string;
    user_id: string | null;
    task_id?: string | null;
    session_id?: string | null;
    scope: string;
    dedupe_key: string;
  },
) {
  const conditions = [
    "scope = $1",
    "dedupe_key = $2",
  ];

  switch (input.scope) {
    case "user":
      conditions.push("coalesce(user_id::text, '') = coalesce($3::text, '')");
      break;
    case "workspace":
      conditions.push("workspace_id = $3");
      break;
    case "task":
      conditions.push("workspace_id = $3");
      conditions.push("coalesce(task_id::text, '') = coalesce($4::text, '')");
      break;
    case "session":
      conditions.push("workspace_id = $3");
      conditions.push("coalesce(session_id::text, '') = coalesce($4::text, '')");
      break;
    default:
      conditions.push("workspace_id = $3");
      conditions.push("coalesce(user_id::text, '') = coalesce($4::text, '')");
      break;
  }

  return `
    select *
    from ${table}
    where ${conditions.join(" and ")}
    order by updated_at desc
  `;
}

function buildFindByDedupeScopeParams(input: {
  workspace_id: string;
  user_id: string | null;
  task_id?: string | null;
  session_id?: string | null;
  scope: string;
  dedupe_key: string;
}) {
  switch (input.scope) {
    case "user":
      return [input.scope, input.dedupe_key, input.user_id];
    case "workspace":
      return [input.scope, input.dedupe_key, input.workspace_id];
    case "task":
      return [input.scope, input.dedupe_key, input.workspace_id, input.task_id ?? null];
    case "session":
      return [input.scope, input.dedupe_key, input.workspace_id, input.session_id ?? null];
    default:
      return [input.scope, input.dedupe_key, input.workspace_id, input.user_id];
  }
}

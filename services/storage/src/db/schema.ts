import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type StorageSchemaConfig = {
  privateSchema: string;
  sharedSchema: string;
};

const DEFAULT_SCHEMA_CONFIG = {
  privateSchema: "storage_private",
  sharedSchema: "storage_shared_v1",
} satisfies StorageSchemaConfig;

const vector = customType<{ data: number[] | null; driverData: string | null }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value) {
    return value ? `[${value.join(",")}]` : null;
  },
  fromDriver(value) {
    if (!value) {
      return null;
    }

    return value
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .filter(Boolean)
      .map((item) => Number(item.trim()));
  },
});

export function createSchema(config: StorageSchemaConfig) {
  const privateSchema = pgSchema(config.privateSchema);
  const sharedSchema = pgSchema(config.sharedSchema);

  const memoryRecords = privateSchema.table(
    "memory_records",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      workspaceId: uuid("workspace_id").notNull(),
      userId: uuid("user_id"),
      taskId: uuid("task_id"),
      sessionId: uuid("session_id"),
      memoryType: text("memory_type").notNull(),
      scope: text("scope").notNull(),
      status: text("status").notNull(),
      summary: text("summary").notNull(),
      detailsJson: jsonb("details_json").$type<Record<string, unknown>>().notNull(),
      importance: smallint("importance").notNull(),
      confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
      dedupeKey: text("dedupe_key").notNull(),
      sourceType: text("source_type").notNull(),
      sourceRef: text("source_ref").notNull(),
      createdByService: text("created_by_service").notNull(),
      lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      version: integer("version").default(1).notNull(),
    },
    (table) => [
      check("memory_records_importance_check", sql`${table.importance} between 1 and 5`),
      check("memory_records_confidence_check", sql`${table.confidence} between 0 and 1`),
      index("memory_records_scope_idx").on(
        table.workspaceId,
        table.userId,
        table.scope,
        table.memoryType,
        table.status,
      ),
      index("memory_records_task_idx").on(table.taskId, table.status),
      index("memory_records_dedupe_idx").on(table.dedupeKey),
      index("memory_records_updated_idx").on(table.updatedAt),
    ],
  );

  const memoryRecordVersions = privateSchema.table(
    "memory_record_versions",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      recordId: uuid("record_id").notNull(),
      versionNo: integer("version_no").notNull(),
      snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>().notNull(),
      changeType: text("change_type").notNull(),
      changeReason: text("change_reason").notNull(),
      changedByType: text("changed_by_type").notNull(),
      changedById: text("changed_by_id").notNull(),
      changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      index("memory_record_versions_record_idx").on(table.recordId, table.versionNo),
      index("memory_record_versions_changed_idx").on(table.changedAt),
    ],
  );

  const memoryWriteJobs = privateSchema.table(
    "memory_write_jobs",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      idempotencyKey: text("idempotency_key").notNull(),
      workspaceId: uuid("workspace_id").notNull(),
      userId: uuid("user_id"),
      candidateJson: jsonb("candidate_json").$type<Record<string, unknown>>().notNull(),
      candidateHash: text("candidate_hash").notNull(),
      sourceService: text("source_service").notNull(),
      jobStatus: text("job_status").notNull(),
      resultRecordId: uuid("result_record_id"),
      resultStatus: text("result_status"),
      errorCode: text("error_code"),
      errorMessage: text("error_message"),
      retryCount: integer("retry_count").default(0).notNull(),
      receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
      startedAt: timestamp("started_at", { withTimezone: true }),
      finishedAt: timestamp("finished_at", { withTimezone: true }),
    },
    (table) => [
      uniqueIndex("memory_write_jobs_idempotency_uidx").on(table.idempotencyKey),
      index("memory_write_jobs_status_idx").on(table.jobStatus, table.receivedAt),
      index("memory_write_jobs_workspace_idx").on(
        table.workspaceId,
        table.userId,
        table.receivedAt,
      ),
    ],
  );

  const memoryConflicts = privateSchema.table(
    "memory_conflicts",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      workspaceId: uuid("workspace_id").notNull(),
      userId: uuid("user_id"),
      recordId: uuid("record_id").notNull(),
      conflictWithRecordId: uuid("conflict_with_record_id").notNull(),
      conflictType: text("conflict_type").notNull(),
      conflictSummary: text("conflict_summary").notNull(),
      status: text("status").notNull(),
      resolutionType: text("resolution_type"),
      resolvedBy: text("resolved_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    },
    (table) => [
      index("memory_conflicts_status_idx").on(table.status, table.createdAt),
      index("memory_conflicts_record_idx").on(table.recordId),
      index("memory_conflicts_with_record_idx").on(table.conflictWithRecordId),
    ],
  );

  const memoryRelations = privateSchema.table(
    "memory_relations",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      workspaceId: uuid("workspace_id").notNull(),
      sourceRecordId: uuid("source_record_id").notNull(),
      targetRecordId: uuid("target_record_id").notNull(),
      relationType: text("relation_type").notNull(),
      strength: numeric("strength", { precision: 3, scale: 2 }).notNull(),
      bidirectional: boolean("bidirectional").notNull(),
      reason: text("reason").notNull(),
      createdByService: text("created_by_service").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      check("memory_relations_strength_check", sql`${table.strength} between 0 and 1`),
      index("memory_relations_source_idx").on(table.workspaceId, table.sourceRecordId, table.updatedAt),
      index("memory_relations_target_idx").on(table.workspaceId, table.targetRecordId, table.updatedAt),
      uniqueIndex("memory_relations_unique_idx").on(
        table.workspaceId,
        table.sourceRecordId,
        table.targetRecordId,
        table.relationType,
      ),
    ],
  );

  const memoryGovernanceActions = privateSchema.table(
    "memory_governance_actions",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      recordId: uuid("record_id").notNull(),
      actionType: text("action_type").notNull(),
      actionPayload: jsonb("action_payload").$type<Record<string, unknown>>().notNull(),
      actorType: text("actor_type").notNull(),
      actorId: text("actor_id").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      index("memory_governance_actions_record_idx").on(table.recordId, table.createdAt),
      index("memory_governance_actions_type_idx").on(table.actionType, table.createdAt),
    ],
  );

  const memoryReadModel = sharedSchema.table(
    "memory_read_model_v1",
    {
      id: uuid("id").primaryKey(),
      workspaceId: uuid("workspace_id").notNull(),
      userId: uuid("user_id"),
      taskId: uuid("task_id"),
      sessionId: uuid("session_id"),
      memoryType: text("memory_type").notNull(),
      scope: text("scope").notNull(),
      status: text("status").notNull(),
      summary: text("summary").notNull(),
      details: jsonb("details").$type<Record<string, unknown> | null>(),
      importance: smallint("importance").notNull(),
      confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
      source: jsonb("source").$type<Record<string, unknown> | null>(),
      lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
      lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
      summaryEmbedding: vector("summary_embedding"),
      embeddingStatus: text("embedding_status").default("ok").notNull(),
      embeddingAttemptedAt: timestamp("embedding_attempted_at", { withTimezone: true }),
      embeddingAttemptCount: integer("embedding_attempt_count").default(0).notNull(),
    },
    (table) => [
      index("memory_read_model_scope_idx").on(
        table.workspaceId,
        table.userId,
        table.scope,
        table.memoryType,
        table.status,
      ),
      index("memory_read_model_task_idx").on(table.taskId, table.status),
      index("memory_read_model_updated_idx").on(table.updatedAt),
    ],
  );

  const memoryReadModelRefreshJobs = privateSchema.table(
    "memory_read_model_refresh_jobs",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      sourceRecordId: uuid("source_record_id").notNull(),
      refreshType: text("refresh_type").notNull(),
      jobStatus: text("job_status").notNull(),
      retryCount: integer("retry_count").default(0).notNull(),
      errorMessage: text("error_message"),
      embeddingUpdatedAt: timestamp("embedding_updated_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      startedAt: timestamp("started_at", { withTimezone: true }),
      finishedAt: timestamp("finished_at", { withTimezone: true }),
    },
    (table) => [index("memory_read_model_refresh_jobs_status_idx").on(table.jobStatus, table.createdAt)],
  );

  return {
    memoryRecords,
    memoryRecordVersions,
    memoryWriteJobs,
    memoryConflicts,
    memoryRelations,
    memoryGovernanceActions,
    memoryReadModel,
    memoryReadModelRefreshJobs,
  };
}

export type StorageDrizzleSchema = ReturnType<typeof createSchema>;

const defaultSchema = createSchema(DEFAULT_SCHEMA_CONFIG);

export const {
  memoryRecords,
  memoryRecordVersions,
  memoryWriteJobs,
  memoryConflicts,
  memoryRelations,
  memoryGovernanceActions,
  memoryReadModel,
  memoryReadModelRefreshJobs,
} = defaultSchema;

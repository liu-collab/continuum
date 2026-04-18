import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";
import { createStorageService } from "../src/services.js";
import { buildRecordFromNormalized } from "../src/db/repositories.js";
import { normalizeCandidate } from "../src/domain/normalizer.js";
import { JobWorker } from "../src/jobs/job-worker.js";
import { createMemoryRepositories, buildCandidate } from "./memory-repositories.js";

describe("governance flow", () => {
  it("enqueues and refreshes shared read model after archive governance action", async () => {
    const recordSeed = buildRecordFromNormalized({
      normalized: normalizeCandidate(buildCandidate()),
    });
    const repositories = createMemoryRepositories({
      records: [
        {
          ...recordSeed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        },
      ],
    });

    const service = createStorageService({
      repositories,
      logger: createLogger("silent"),
      config: {
        port: 3001,
        host: "127.0.0.1",
        log_level: "silent",
        database_url: "postgres://example",
        storage_schema_private: "storage_private",
        storage_schema_shared: "storage_shared_v1",
        write_job_poll_interval_ms: 1000,
        write_job_batch_size: 10,
        write_job_max_retries: 3,
        read_model_refresh_max_retries: 2,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    await service.archiveRecord(recordSeed.id, {
      actor: {
        actor_type: "operator",
        actor_id: "tester",
      },
      reason: "task complete",
    });

    const worker = new JobWorker(repositories, createLogger("silent"), {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 2,
    });

    await worker.processAvailableJobs();

    const projected = await repositories.readModel.findById(recordSeed.id);
    expect(projected?.status).toBe("archived");
  });

  it("confirms a record back to active and refreshes read model", async () => {
    const seed = buildRecordFromNormalized({
      normalized: normalizeCandidate(buildCandidate()),
      status: "pending_confirmation",
    });
    const repositories = createMemoryRepositories({
      records: [
        {
          ...seed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        },
      ],
    });

    const service = createStorageService({
      repositories,
      logger: createLogger("silent"),
      config: {
        port: 3001,
        host: "127.0.0.1",
        log_level: "silent",
        database_url: "postgres://example",
        storage_schema_private: "storage_private",
        storage_schema_shared: "storage_shared_v1",
        write_job_poll_interval_ms: 1000,
        write_job_batch_size: 10,
        write_job_max_retries: 3,
        read_model_refresh_max_retries: 2,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    await service.confirmRecord(seed.id, {
      actor: {
        actor_type: "operator",
        actor_id: "tester",
      },
      reason: "user confirmed it",
    });

    const worker = new JobWorker(repositories, createLogger("silent"), {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 2,
    });
    await worker.processAvailableJobs();

    const projected = await repositories.readModel.findById(seed.id);
    expect(projected?.status).toBe("active");
    expect(projected?.last_confirmed_at).toBeTruthy();
  });

  it("invalidates a record into archived state and keeps audit semantics", async () => {
    const seed = buildRecordFromNormalized({
      normalized: normalizeCandidate(buildCandidate()),
    });
    const repositories = createMemoryRepositories({
      records: [
        {
          ...seed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        },
      ],
    });

    const service = createStorageService({
      repositories,
      logger: createLogger("silent"),
      config: {
        port: 3001,
        host: "127.0.0.1",
        log_level: "silent",
        database_url: "postgres://example",
        storage_schema_private: "storage_private",
        storage_schema_shared: "storage_shared_v1",
        write_job_poll_interval_ms: 1000,
        write_job_batch_size: 10,
        write_job_max_retries: 3,
        read_model_refresh_max_retries: 2,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    const record = await service.invalidateRecord(seed.id, {
      actor: {
        actor_type: "operator",
        actor_id: "tester",
      },
      reason: "rule is no longer valid",
    });

    expect(record.status).toBe("archived");
    expect(record.archived_at).toBeTruthy();
  });

  it("returns versions and merged history for a record", async () => {
    const seed = buildRecordFromNormalized({
      normalized: normalizeCandidate(buildCandidate()),
    });
    const now = new Date().toISOString();
    const repositories = createMemoryRepositories({
      records: [
        {
          ...seed,
          created_at: now,
          updated_at: now,
          version: 2,
        },
      ],
      versions: [
        {
          id: "version-1",
          record_id: seed.id,
          version_no: 1,
          snapshot_json: { summary: seed.summary },
          change_type: "create",
          change_reason: "initial",
          changed_by_type: "system",
          changed_by_id: "retrieval-runtime",
          changed_at: now,
        },
      ],
    });

    const service = createStorageService({
      repositories,
      logger: createLogger("silent"),
      config: {
        port: 3001,
        host: "127.0.0.1",
        log_level: "silent",
        database_url: "postgres://example",
        storage_schema_private: "storage_private",
        storage_schema_shared: "storage_shared_v1",
        write_job_poll_interval_ms: 1000,
        write_job_batch_size: 10,
        write_job_max_retries: 3,
        read_model_refresh_max_retries: 2,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    await service.archiveRecord(seed.id, {
      actor: {
        actor_type: "operator",
        actor_id: "tester",
      },
      reason: "history check",
    });

    const versions = await service.listRecordVersions(seed.id);
    const history = await service.getRecordHistory(seed.id);

    expect(versions.length).toBeGreaterThan(0);
    expect(history.some((entry) => entry.entry_type === "record_version")).toBe(true);
    expect(history.some((entry) => entry.entry_type === "governance_action")).toBe(true);
  });

  it("deletes a record and removes it from read model after refresh", async () => {
    const seed = buildRecordFromNormalized({
      normalized: normalizeCandidate(buildCandidate()),
    });
    const now = new Date().toISOString();
    const repositories = createMemoryRepositories({
      records: [
        {
          ...seed,
          created_at: now,
          updated_at: now,
          version: 1,
        },
      ],
      readModel: [
        {
          id: seed.id,
          workspace_id: seed.workspace_id,
          user_id: seed.user_id,
          task_id: seed.task_id,
          session_id: seed.session_id,
          memory_type: seed.memory_type,
          scope: seed.scope,
          status: seed.status,
          summary: seed.summary,
          details: seed.details_json,
          importance: seed.importance,
          confidence: seed.confidence,
          source: {
            source_type: seed.source_type,
            source_ref: seed.source_ref,
            service_name: seed.created_by_service,
            origin_workspace_id: seed.workspace_id,
            confirmed_by_user: true,
          },
          last_confirmed_at: seed.last_confirmed_at,
          last_used_at: null,
          created_at: now,
          updated_at: now,
          summary_embedding: null,
          embedding_status: "pending",
          embedding_attempted_at: null,
        },
      ],
    });

    const service = createStorageService({
      repositories,
      logger: createLogger("silent"),
      config: {
        port: 3001,
        host: "127.0.0.1",
        log_level: "silent",
        database_url: "postgres://example",
        storage_schema_private: "storage_private",
        storage_schema_shared: "storage_shared_v1",
        write_job_poll_interval_ms: 1000,
        write_job_batch_size: 10,
        write_job_max_retries: 3,
        read_model_refresh_max_retries: 2,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    await service.deleteRecord(seed.id, {
      actor: {
        actor_type: "operator",
        actor_id: "tester",
      },
      reason: "remove incorrect memory",
    });

    const worker = new JobWorker(repositories, createLogger("silent"), {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 2,
    });
    await worker.processAvailableJobs();

    const projected = await repositories.readModel.findById(seed.id);
    expect(projected).toBeNull();
  });

  it("resolves a conflict by activating one side and archiving the other side", async () => {
    const existing = {
      ...buildRecordFromNormalized({
        normalized: normalizeCandidate(buildCandidate()),
        status: "pending_confirmation",
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
    const pending = {
      ...buildRecordFromNormalized({
        normalized: normalizeCandidate(
          buildCandidate({
            summary: "User does not like concise answers",
            details: {
              subject: "user",
              predicate: "does not like concise answers",
            },
            source: {
              source_type: "user_input",
              source_ref: "turn-2",
              service_name: "retrieval-runtime",
              origin_workspace_id: "11111111-1111-4111-8111-111111111111",
              confirmed_by_user: false,
            },
          }),
        ),
        status: "pending_confirmation",
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };

    const repositories = createMemoryRepositories({
      records: [existing, pending],
      conflicts: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspace_id: existing.workspace_id,
          user_id: existing.user_id,
          record_id: existing.id,
          conflict_with_record_id: pending.id,
          pending_record_id: pending.id,
          existing_record_id: existing.id,
          conflict_type: "preference_conflict",
          conflict_summary: "user preference conflict",
          status: "open",
          resolution_type: null,
          resolved_by: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
        },
      ],
    });

    const service = createStorageService({
      repositories,
      logger: createLogger("silent"),
      config: {
        port: 3001,
        host: "127.0.0.1",
        log_level: "silent",
        database_url: "postgres://example",
        storage_schema_private: "storage_private",
        storage_schema_shared: "storage_shared_v1",
        write_job_poll_interval_ms: 1000,
        write_job_batch_size: 10,
        write_job_max_retries: 3,
        read_model_refresh_max_retries: 2,
        embedding_base_url: undefined,
        embedding_api_key: undefined,
        embedding_model: "text-embedding-3-small",
        redis_url: undefined,
      },
    });

    const resolved = await service.resolveConflict("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      resolution_type: "manual_fix",
      resolved_by: "tester",
      resolution_note: "keep the pending version",
      activate_record_id: pending.id,
    });

    expect(resolved.status).toBe("resolved");
    expect((await repositories.records.findById(pending.id))?.status).toBe("active");
    expect((await repositories.records.findById(existing.id))?.status).toBe("archived");
  });
});

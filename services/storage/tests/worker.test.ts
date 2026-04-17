import { describe, expect, it } from "vitest";

import { JobWorker } from "../src/jobs/job-worker.js";
import { createLogger } from "../src/logger.js";
import { buildRecordFromNormalized } from "../src/db/repositories.js";
import { normalizeCandidate } from "../src/domain/normalizer.js";
import { runWorker } from "../src/worker.js";
import { createMemoryRepositories, buildCandidate } from "./memory-repositories.js";

describe("job worker", () => {
  it("accepts async writeback and creates active record with read model projection", async () => {
    const repositories = createMemoryRepositories();
    const logger = createLogger("silent");
    const candidate = buildCandidate();
    const normalized = normalizeCandidate(candidate);

    const job = await repositories.jobs.enqueue({
      idempotency_key: "job-key-1",
      candidate_hash: normalized.candidate_hash,
      source_service: "retrieval-runtime",
      candidate,
    });

    const worker = new JobWorker(repositories, logger, {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 2,
    });

    const processed = await worker.processAvailableJobs();

    expect(processed).toBe(1);
    const storedJob = await repositories.jobs.findById(job.id);
    expect(storedJob?.job_status).toBe("succeeded");

    const records = await repositories.records.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: undefined,
      task_id: undefined,
      memory_type: undefined,
      scope: undefined,
      status: undefined,
      page: 1,
      page_size: 10,
    });
    expect(records.items).toHaveLength(1);
    expect(records.items[0]?.status).toBe("active");

    const projected = await repositories.readModel.findById(records.items[0]!.id);
    expect(projected?.summary).toBe(normalized.summary);
    expect(projected?.details?.subject).toBe("user");
    expect(projected?.source?.source_type).toBe("user_input");
    expect(projected?.source?.origin_workspace_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(projected?.created_at).toBeTruthy();
    expect(projected?.summary_embedding).toBeNull();
  });

  it("marks conflicting writes as pending confirmation and opens conflict", async () => {
    const candidate = buildCandidate({
      summary: "User likes concise answers",
      details: {
        subject: "user",
        predicate: "likes concise answers",
      },
      confidence: 0.7,
    });
    const existing = buildRecordFromNormalized({
      normalized: normalizeCandidate(candidate),
    });
    const repositories = createMemoryRepositories({
      records: [
        {
          ...existing,
          dedupe_key: normalizeCandidate(buildCandidate(conflictCandidateSeed())).dedupe_key,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        },
      ],
    });
    const logger = createLogger("silent");

    const conflictCandidate = buildCandidate({
      ...conflictCandidateSeed(),
      idempotency_key: "job-key-2",
    });

    const conflictNormalized = normalizeCandidate(conflictCandidate);
    const job = await repositories.jobs.enqueue({
      idempotency_key: "job-key-2",
      candidate_hash: conflictNormalized.candidate_hash,
      source_service: "retrieval-runtime",
      candidate: conflictCandidate,
    });

    const worker = new JobWorker(repositories, logger, {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 2,
    });

    await worker.processAvailableJobs();

    const updated = await repositories.records.findById(existing.id);
    expect(updated?.status).toBe("pending_confirmation");

    const conflicts = await repositories.conflicts.listConflicts("open");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.pending_record_id).toBeTruthy();
    expect(conflicts[0]?.existing_record_id).toBe(existing.id);

    const pendingRecords = await repositories.records.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      task_id: undefined,
      memory_type: undefined,
      scope: "user",
      status: "pending_confirmation",
      page: 1,
      page_size: 10,
    });
    expect(pendingRecords.items).toHaveLength(2);

    const storedJob = await repositories.jobs.findById(job.id);
    expect(storedJob?.result_status).toBe("open_conflict");
  });

  it("stores embedding when projector can reach embedding client", async () => {
    const repositories = createMemoryRepositories();
    const logger = createLogger("silent");
    const candidate = buildCandidate();
    const normalized = normalizeCandidate(candidate);

    await repositories.jobs.enqueue({
      idempotency_key: "job-key-embed",
      candidate_hash: normalized.candidate_hash,
      source_service: "retrieval-runtime",
      candidate,
    });

    const worker = new JobWorker(
      repositories,
      logger,
      {
        batch_size: 10,
        max_retries: 3,
        read_model_refresh_max_retries: 2,
      },
      {
        async embedText() {
          return [0.1, 0.2, 0.3];
        },
      },
    );

    await worker.processAvailableJobs();

    const records = await repositories.records.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: undefined,
      task_id: undefined,
      memory_type: undefined,
      scope: undefined,
      status: undefined,
      page: 1,
      page_size: 10,
    });
    const projected = await repositories.readModel.findById(records.items[0]!.id);
    expect(projected?.summary_embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("keeps read model record and marks degradation when embedding client is unavailable", async () => {
    const repositories = createMemoryRepositories();
    const logger = createLogger("silent");
    const candidate = buildCandidate();
    const normalized = normalizeCandidate(candidate);

    await repositories.jobs.enqueue({
      idempotency_key: "job-key-embed-fail",
      candidate_hash: normalized.candidate_hash,
      source_service: "retrieval-runtime",
      candidate,
    });

    const worker = new JobWorker(
      repositories,
      logger,
      {
        batch_size: 10,
        max_retries: 3,
        read_model_refresh_max_retries: 2,
      },
      {
        async embedText() {
          throw new Error("embedding service unavailable");
        },
      },
    );

    await worker.processAvailableJobs();

    const records = await repositories.records.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: undefined,
      task_id: undefined,
      memory_type: undefined,
      scope: undefined,
      status: undefined,
      page: 1,
      page_size: 10,
    });
    const projected = await repositories.readModel.findById(records.items[0]!.id);
    expect(projected?.summary_embedding).toBeNull();
    expect(projected?.created_at).toBeTruthy();

    const metrics = await repositories.metrics.collect();
    expect(metrics.projector_embedding_degraded_jobs).toBe(1);
    expect(metrics.projector_failed_jobs).toBe(0);
  });

  it("does not duplicate a user memory when written from another workspace", async () => {
    const repositories = createMemoryRepositories();
    const logger = createLogger("silent");
    const first = buildCandidate();
    const second = buildCandidate({
      workspace_id: "aaaaaaaa-1111-4111-8111-111111111111",
      source: {
        source_type: "user_input",
        source_ref: "turn-2",
        service_name: "retrieval-runtime",
        origin_workspace_id: "aaaaaaaa-1111-4111-8111-111111111111",
        confirmed_by_user: true,
      },
    });

    await repositories.jobs.enqueue({
      idempotency_key: "job-key-global-1",
      candidate_hash: normalizeCandidate(first).candidate_hash,
      source_service: "retrieval-runtime",
      candidate: first,
    });
    await repositories.jobs.enqueue({
      idempotency_key: "job-key-global-2",
      candidate_hash: normalizeCandidate(second).candidate_hash,
      source_service: "retrieval-runtime",
      candidate: second,
    });

    const worker = new JobWorker(repositories, logger, {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 2,
    });

    await worker.processAvailableJobs();

    const records = await repositories.records.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      task_id: undefined,
      memory_type: undefined,
      scope: "user",
      status: undefined,
      page: 1,
      page_size: 10,
    });

    expect(records.items).toHaveLength(1);

    const metrics = await repositories.metrics.collect();
    expect(metrics.duplicate_ignored_jobs).toBe(1);
  });

  it("dedupes workspace memory only inside the same workspace", async () => {
    const repositories = createMemoryRepositories();
    const logger = createLogger("silent");
    const workspaceCandidate = buildCandidate({
      scope: "workspace",
      summary: "This repo uses pnpm",
      details: {
        rule_kind: "toolchain",
        rule_value: "pnpm",
        repo_path: "services/storage",
        evidence: "repo guide",
      },
      write_reason: "workspace rule",
    });
    const otherWorkspaceCandidate = buildCandidate({
      ...workspaceCandidate,
      workspace_id: "bbbbbbbb-1111-4111-8111-111111111111",
      source: {
        ...workspaceCandidate.source,
        source_ref: "turn-2",
        origin_workspace_id: "bbbbbbbb-1111-4111-8111-111111111111",
      },
    });

    await repositories.jobs.enqueue({
      idempotency_key: "job-key-workspace-1",
      candidate_hash: normalizeCandidate(workspaceCandidate).candidate_hash,
      source_service: "retrieval-runtime",
      candidate: workspaceCandidate,
    });
    await repositories.jobs.enqueue({
      idempotency_key: "job-key-workspace-2",
      candidate_hash: normalizeCandidate(otherWorkspaceCandidate).candidate_hash,
      source_service: "retrieval-runtime",
      candidate: otherWorkspaceCandidate,
    });

    const worker = new JobWorker(repositories, logger, {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 2,
    });

    await worker.processAvailableJobs();

    const records = await repositories.records.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: undefined,
      task_id: undefined,
      memory_type: undefined,
      scope: "workspace",
      status: undefined,
      page: 1,
      page_size: 10,
    });

    expect(records.items).toHaveLength(1);

    const otherWorkspaceRecords = await repositories.records.listRecords({
      workspace_id: "bbbbbbbb-1111-4111-8111-111111111111",
      user_id: undefined,
      task_id: undefined,
      memory_type: undefined,
      scope: "workspace",
      status: undefined,
      page: 1,
      page_size: 10,
    });

    expect(otherWorkspaceRecords.items).toHaveLength(1);
  });

  it("marks refresh job dead letter after retry limit", async () => {
    const repositories = createMemoryRepositories({
      records: [
        {
          ...buildRecordFromNormalized({
            normalized: normalizeCandidate(buildCandidate()),
          }),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        },
      ],
      refreshJobs: [
        {
          id: "refresh-job-1",
          source_record_id: "missing-record",
          refresh_type: "update",
          job_status: "failed",
          retry_count: 1,
          error_message: "previous failure",
          created_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
        },
      ],
    });

    const worker = new JobWorker(repositories, createLogger("silent"), {
      batch_size: 10,
      max_retries: 3,
      read_model_refresh_max_retries: 1,
    });

    await worker.processAvailableJobs();

    const metrics = await repositories.metrics.collect();
    expect(metrics.projector_dead_letter_jobs).toBe(1);
    expect(metrics.projector_failed_jobs).toBe(0);
  });

  it("waits for the active cycle to finish before closing the database", async () => {
    const signalHandlers = new Map<string, () => void>();
    const events: string[] = [];
    let resolveCycle: (() => void) | undefined;

    const workerRun = runWorker({
      service: {
        async processWriteJobs() {
          events.push("cycle:start");
          signalHandlers.get("SIGTERM")?.();
          await new Promise<void>((resolve) => {
            resolveCycle = () => {
              events.push("cycle:finish");
              resolve();
            };
          });
          return 1;
        },
      },
      database: {
        async close() {
          events.push("database:close");
        },
      },
      logger: {
        info() {
          return undefined;
        },
        error() {
          return undefined;
        },
      } as never,
      pollIntervalMs: 1,
      delay: async () => undefined,
      onSignal(signal, handler) {
        signalHandlers.set(signal, handler);
      },
    });

    await Promise.resolve();
    resolveCycle?.();
    await workerRun;

    expect(events).toEqual(["cycle:start", "cycle:finish", "database:close"]);
  });
});

function conflictCandidateSeed() {
  return {
    summary: "User does not like concise answers",
    details: {
      subject: "user",
      predicate: "does not like concise answers",
    },
    confidence: 0.6,
    source: {
      source_type: "user_input",
      source_ref: "turn-2",
      service_name: "retrieval-runtime",
      confirmed_by_user: false,
    },
  } as const;
}

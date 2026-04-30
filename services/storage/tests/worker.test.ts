import { describe, expect, it } from "vitest";

import { JobWorker } from "../src/jobs/job-worker.js";
import { createLogger } from "../src/logger.js";
import { buildRecordFromNormalized } from "../src/db/repositories.js";
import { normalizeCandidate } from "../src/domain/normalizer.js";
import { GovernanceExecutionEngine } from "../src/domain/governance-execution-engine.js";
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

  it("publishes the read model entry when embedding dimensions do not match", async () => {
    const repositories = createMemoryRepositories();

    await repositories.jobs.enqueue({
      idempotency_key: "job-key-embed-dimension-mismatch",
      candidate_hash: normalizeCandidate(buildCandidate()).candidate_hash,
      source_service: "retrieval-runtime",
      candidate: buildCandidate(),
    });

    const worker = new JobWorker(
      repositories,
      createLogger("silent"),
      {
        batch_size: 10,
        max_retries: 3,
        read_model_refresh_max_retries: 2,
      },
      {
        async embedText() {
          return Array.from({ length: 1024 }, (_, index) => index / 1000);
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
    expect(projected?.embedding_status).toBe("pending");

    const metrics = await repositories.metrics.collect();
    expect(metrics.projector_dead_letter_jobs).toBe(0);
    expect(metrics.projector_embedding_degraded_jobs).toBe(0);
  });

  it("refreshes pending embeddings in batch after service recovery", async () => {
    const repositories = createMemoryRepositories({
      readModel: [
        {
          id: "pending-embedding-record",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          user_id: "22222222-2222-4222-8222-222222222222",
          task_id: null,
          session_id: null,
          memory_type: "preference",
          scope: "user",
          status: "active",
          summary: "用户偏好简洁回答",
          details: { subject: "user", predicate: "偏好简洁回答" },
          importance: 5,
          confidence: 0.9,
          source: null,
          last_confirmed_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          summary_embedding: null,
          embedding_status: "pending",
          embedding_attempted_at: new Date().toISOString(),
          embedding_attempt_count: 1,
        },
      ],
    });

    const worker = new JobWorker(
      repositories,
      createLogger("silent"),
      {
        batch_size: 10,
        max_retries: 3,
        read_model_refresh_max_retries: 2,
      },
      {
        async embedText() {
          return [0.1, 0.2, 0.3];
        },
        async embedTexts(texts) {
          return texts.map(() => [0.1, 0.2, 0.3]);
        },
      },
    );

    await worker.processAvailableJobs();

    const projected = await repositories.readModel.findById("pending-embedding-record");
    expect(projected?.summary_embedding).toEqual([0.1, 0.2, 0.3]);
    expect(projected?.embedding_status).toBe("ok");
  });

  it("splits pending embedding metrics into new and retry buckets", async () => {
    const now = Date.now();
    const repositories = createMemoryRepositories({
      readModel: [
        {
          id: "pending-new",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          user_id: "22222222-2222-4222-8222-222222222222",
          task_id: null,
          session_id: null,
          memory_type: "preference",
          scope: "user",
          status: "active",
          summary: "新待补刷记录",
          details: { subject: "user" },
          importance: 5,
          confidence: 0.9,
          source: null,
          last_confirmed_at: null,
          last_used_at: null,
          created_at: new Date(now - 30_000).toISOString(),
          updated_at: new Date(now - 30_000).toISOString(),
          summary_embedding: null,
          embedding_status: "pending",
          embedding_attempted_at: new Date(now - 20_000).toISOString(),
          embedding_attempt_count: 1,
        },
        {
          id: "pending-retry",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          user_id: "22222222-2222-4222-8222-222222222222",
          task_id: null,
          session_id: null,
          memory_type: "preference",
          scope: "user",
          status: "active",
          summary: "重试后仍待补刷记录",
          details: { subject: "user" },
          importance: 5,
          confidence: 0.9,
          source: null,
          last_confirmed_at: null,
          last_used_at: null,
          created_at: new Date(now - 120_000).toISOString(),
          updated_at: new Date(now - 120_000).toISOString(),
          summary_embedding: null,
          embedding_status: "pending",
          embedding_attempted_at: new Date(now - 90_000).toISOString(),
          embedding_attempt_count: 3,
        },
      ],
    });

    const metrics = await repositories.metrics.collect();

    expect(metrics.pending_embedding_records).toBe(2);
    expect(metrics.new_pending_embedding_records).toBe(1);
    expect(metrics.retry_pending_embedding_records).toBe(1);
    expect(metrics.oldest_pending_embedding_age_seconds).toBeGreaterThanOrEqual(80);
  });

  it("collects governance proposal and execution metrics", async () => {
    const repositories = createMemoryRepositories();
    const engine = new GovernanceExecutionEngine(repositories);
    const first = await repositories.records.insertRecord({
      ...buildRecordFromNormalized({
        normalized: normalizeCandidate(buildCandidate()),
      }),
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    await engine.executeBatch({
      workspace_id: first.workspace_id,
      source_service: "retrieval-runtime",
      items: [
        {
          proposal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          proposal_type: "delete",
          targets: {
            record_ids: [first.id],
          },
          suggested_changes: {
            delete_mode: "soft",
            status: "deleted",
          },
          reason_code: "obsolete_task_state",
          reason_text: "delete obsolete task state",
          evidence: {
            delete_reason: "replaced by newer state",
          },
          planner: {
            model: "memory_llm",
            confidence: 0.95,
          },
          verifier: {
            required: true,
            model: "memory_llm",
            decision: "approve",
            confidence: 0.91,
          },
          policy_version: "memory-governance-v1",
          idempotency_key: "delete-proposal-1",
        },
      ],
    });

    const executions = await repositories.governance.listExecutions();
    expect(executions).toHaveLength(1);

    await engine.retryExecution(executions[0]!.id);

    const metrics = await repositories.metrics.collect();
    expect(metrics.governance_proposal_count).toBe(1);
    expect(metrics.governance_verifier_required_count).toBe(1);
    expect(metrics.governance_verifier_approved_count).toBe(1);
    expect(metrics.governance_execution_count).toBe(2);
    expect(metrics.governance_execution_success_count).toBe(1);
    expect(metrics.governance_execution_failure_count).toBe(0);
    expect(metrics.governance_soft_delete_count).toBe(2);
    expect(metrics.governance_retry_count).toBe(1);
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

  it("merges semantically equivalent user preferences even when summaries differ", async () => {
    const repositories = createMemoryRepositories();
    const logger = createLogger("silent");
    const first = buildCandidate({
      summary: "我偏好默认中文回答",
      details: {
        subject: "user",
        predicate: "偏好默认中文回答",
      },
    });
    const second = buildCandidate({
      summary: "以后默认用中文输出",
      details: {
        subject: "user",
        predicate: "默认用中文输出",
      },
      source: {
        source_type: "user_input",
        source_ref: "turn-2",
        service_name: "retrieval-runtime",
        origin_workspace_id: "11111111-1111-4111-8111-111111111111",
        confirmed_by_user: true,
      },
    });

    await repositories.jobs.enqueue({
      idempotency_key: "job-key-semantic-pref-1",
      candidate_hash: normalizeCandidate(first).candidate_hash,
      source_service: "retrieval-runtime",
      candidate: first,
    });
    await repositories.jobs.enqueue({
      idempotency_key: "job-key-semantic-pref-2",
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
    expect(records.items[0]?.details_json.preference_axis).toBe("response_language");
    expect(records.items[0]?.details_json.preference_value).toBe("zh");

    const secondJob = await repositories.jobs.findByIdempotencyKey("job-key-semantic-pref-2");
    expect(secondJob?.result_status).toBe("ignore_duplicate");
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

  it("recovers dead-letter refresh jobs caused by embedding dimension mismatch", async () => {
    const candidate = buildCandidate();
    const normalized = normalizeCandidate(candidate);
    const existing = buildRecordFromNormalized({
      normalized,
    });
    const repositories = createMemoryRepositories({
      records: [
        {
          ...existing,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        },
      ],
      refreshJobs: [
        {
          id: "refresh-job-dimension-mismatch",
          source_record_id: existing.id,
          refresh_type: "insert",
          job_status: "dead_letter",
          retry_count: 4,
          error_message: "expected 1536 dimensions, not 1024",
          created_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
        },
      ],
    });

    const worker = new JobWorker(
      repositories,
      createLogger("silent"),
      {
        batch_size: 10,
        max_retries: 3,
        read_model_refresh_max_retries: 2,
      },
      {
        async embedText() {
          return Array.from({ length: 1024 }, (_, index) => index / 1000);
        },
      },
    );

    await worker.processAvailableJobs();

    const projected = await repositories.readModel.findById(existing.id);
    const metrics = await repositories.metrics.collect();
    expect(projected?.summary).toBe(existing.summary);
    expect(projected?.summary_embedding).toBeNull();
    expect(metrics.projector_dead_letter_jobs).toBe(0);
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

  it("backs off after failed cycles and recovers delay after success", async () => {
    const delays: number[] = [];
    const logs: Array<{ level: string; payload: unknown; message: string }> = [];
    let attempts = 0;

    await runWorker({
      service: {
        async processWriteJobs() {
          attempts += 1;
          if (attempts <= 2) {
            throw new Error(`failure-${attempts}`);
          }
          if (attempts >= 4) {
            throw new Error("stop after recovery check");
          }
          return 1;
        },
      },
      database: {
        async close() {
          return undefined;
        },
      },
      logger: {
        info() {
          return undefined;
        },
        error(payload: unknown, message: string) {
          logs.push({ level: "error", payload, message });
        },
        warn(payload: unknown, message: string) {
          logs.push({ level: "warn", payload, message });
        },
        fatal(payload: unknown, message: string) {
          logs.push({ level: "fatal", payload, message });
        },
      } as never,
      pollIntervalMs: 5,
      delay: async (ms) => {
        delays.push(ms);
        if (delays.length >= 3) {
          throw new Error("stop test worker");
        }
      },
      onSignal() {
        return undefined;
      },
    }).catch((error) => {
      if (!(error instanceof Error) || error.message !== "stop test worker") {
        throw error;
      }
    });

    expect(delays).toEqual([1000, 2000, 5]);
    expect(logs.filter((log) => log.level === "warn")).toHaveLength(2);
  });

  it("stops after too many consecutive failures", async () => {
    const delays: number[] = [];
    const logs: Array<{ level: string; payload: unknown; message: string }> = [];
    let attempts = 0;
    let closed = false;

    await runWorker({
      service: {
        async processWriteJobs() {
          attempts += 1;
          throw new Error("database unavailable");
        },
      },
      database: {
        async close() {
          closed = true;
        },
      },
      logger: {
        info() {
          return undefined;
        },
        error(payload: unknown, message: string) {
          logs.push({ level: "error", payload, message });
        },
        warn(payload: unknown, message: string) {
          logs.push({ level: "warn", payload, message });
        },
        fatal(payload: unknown, message: string) {
          logs.push({ level: "fatal", payload, message });
        },
      } as never,
      pollIntervalMs: 5,
      delay: async (ms) => {
        delays.push(ms);
      },
      onSignal() {
        return undefined;
      },
    });

    expect(attempts).toBe(10);
    expect(delays).toHaveLength(9);
    expect(delays.at(0)).toBe(1000);
    expect(delays.at(-1)).toBe(60_000);
    expect(logs.some((log) => log.level === "fatal")).toBe(true);
    expect(closed).toBe(true);
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

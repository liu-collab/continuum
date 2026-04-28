import { describe, expect, it, vi } from "vitest";
import pino from "pino";

import { loadConfig, type AppConfig } from "../src/config.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { InMemoryRuntimeRepository } from "../src/observability/in-memory-runtime-repository.js";
import type {
  LlmMaintenancePlanner,
  MaintenancePlan,
  MaintenancePlanInput,
} from "../src/writeback/llm-maintenance-planner.js";
import type {
  GovernanceVerifier,
  GovernanceVerifierInput,
  GovernanceVerifierResult,
} from "../src/writeback/llm-governance-verifier.js";
import { WritebackMaintenanceWorker } from "../src/writeback/maintenance-worker.js";
import type {
  RecordListFilters,
  RecordListPage,
  RecordPatchPayload,
  ResolveConflictPayload,
  StorageMutationPayload,
  StorageWritebackClient,
} from "../src/writeback/storage-client.js";
import type {
  GovernanceExecutionResponseItem,
  ConflictStatus,
  GovernanceRejectedProposalSnapshot,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  SubmittedWriteBackJob,
  WriteBackCandidate,
  WriteProjectionStatusSnapshot,
} from "../src/shared/types.js";
import type { EvolutionPlanner, RelationDiscoverer } from "../src/memory-orchestrator/types.js";

const workspaceId = "550e8400-e29b-41d4-a716-446655440000";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
    STORAGE_WRITEBACK_URL: "http://localhost:3001",
  } as unknown as NodeJS.ProcessEnv);
  return {
    ...base,
    WRITEBACK_MAINTENANCE_ENABLED: true,
    WRITEBACK_MAINTENANCE_TIMEOUT_MS: 100,
    WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD: 0.2,
    ...overrides,
  };
}

function makeRecord(id: string, summary: string, importance = 4): MemoryRecordSnapshot {
  const createdAt = new Date().toISOString();
  return {
    id,
    workspace_id: workspaceId,
    user_id: null,
    task_id: null,
    session_id: null,
    memory_type: "fact_preference",
    scope: "workspace",
    status: "active",
    summary,
    details: null,
    importance,
    confidence: 0.9,
    created_at: createdAt,
    updated_at: createdAt,
    last_used_at: null,
  };
}

function makeSessionEpisodicRecord(id: string, updatedAt: string, lastUsedAt: string | null = null): MemoryRecordSnapshot {
  return {
    id,
    workspace_id: workspaceId,
    user_id: null,
    task_id: null,
    session_id: "550e8400-e29b-41d4-a716-446655440099",
    memory_type: "episodic",
    scope: "session",
    status: "active",
    summary: `session episodic ${id}`,
    details: null,
    importance: 3,
    confidence: 0.82,
    created_at: updatedAt,
    updated_at: updatedAt,
    last_used_at: lastUsedAt,
  };
}

class RecordingStorageClient implements StorageWritebackClient {
  public governanceBatches: Array<unknown> = [];
  public relationBatches: Array<unknown> = [];
  public writebackCandidates: Array<unknown> = [];
  public listRecordFilters: RecordListFilters[] = [];
  public waitForBatch = false;
  private batchResolvers: Array<() => void> = [];

  constructor(
    private readonly seeds: MemoryRecordSnapshot[],
    private readonly related: MemoryRecordSnapshot[],
    private readonly conflicts: MemoryConflictSnapshot[] = [],
    private readonly rejectedProposals: GovernanceRejectedProposalSnapshot[] = [],
  ) {}

  async submitCandidates(candidates: Parameters<StorageWritebackClient["submitCandidates"]>[0]) {
    this.writebackCandidates.push(candidates);
    return candidates.map((candidate) => ({
      candidate_summary: candidate.summary,
      status: "accepted_async" as const,
    }));
  }

  async getWriteProjectionStatuses(): Promise<WriteProjectionStatusSnapshot[]> {
    return [];
  }

  async listRecords(filters: RecordListFilters): Promise<RecordListPage> {
    this.listRecordFilters.push(filters);
    const isSeedCall = !filters.memory_type;
    const isSessionLifecycleSeedCall = filters.scope === "session" && filters.memory_type === "episodic";
    const source = isSeedCall || isSessionLifecycleSeedCall ? this.seeds : [...this.seeds, ...this.related];
    const items = source.filter((record) => {
      if (filters.workspace_id && record.workspace_id !== filters.workspace_id) return false;
      if (filters.user_id && record.user_id !== filters.user_id) return false;
      if (filters.task_id && record.task_id !== filters.task_id) return false;
      if (filters.memory_type && record.memory_type !== filters.memory_type) return false;
      if (filters.scope && record.scope !== filters.scope) return false;
      if (filters.status && record.status !== filters.status) return false;
      if (filters.created_after && Date.parse(record.created_at) < Date.parse(filters.created_after)) return false;
      return true;
    });
    return {
      items,
      total: items.length,
      page: 1,
      page_size: items.length,
    };
  }

  async patchRecord(_recordId: string, _payload: RecordPatchPayload): Promise<never> {
    throw new Error("patchRecord should not be called by governance worker");
  }

  async getRecordsByIds(recordIds: string[]): Promise<MemoryRecordSnapshot[]> {
    const all = [...this.seeds, ...this.related];
    const idSet = new Set(recordIds);
    return all.filter((item) => idSet.has(item.id));
  }

  async archiveRecord(_recordId: string, _payload: StorageMutationPayload): Promise<never> {
    throw new Error("archiveRecord should not be called by governance worker");
  }

  async listConflicts(_status?: ConflictStatus): Promise<MemoryConflictSnapshot[]> {
    return this.conflicts;
  }

  async listRecentRejectedProposals(): Promise<GovernanceRejectedProposalSnapshot[]> {
    return this.rejectedProposals;
  }

  async resolveConflict(_conflictId: string, _payload: ResolveConflictPayload): Promise<never> {
    throw new Error("resolveConflict should not be called by governance worker");
  }

  async upsertRelations(relations: Parameters<StorageWritebackClient["upsertRelations"]>[0]) {
    this.relationBatches.push(relations);
    return relations.map((relation, index) => ({
      id: `rel-${index}`,
      ...relation,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  }

  async listRelations() {
    return [];
  }

  async submitGovernanceExecutions(batch: unknown): Promise<GovernanceExecutionResponseItem[]> {
    this.governanceBatches.push(batch);
    if (this.waitForBatch) {
      await new Promise<void>((resolve) => {
        this.batchResolvers.push(resolve);
      });
    }
    const typed = batch as {
      workspace_id: string;
      items: Array<{
        proposal_id: string;
        proposal_type: GovernanceExecutionResponseItem["execution"]["proposal_type"];
        verifier?: { required?: boolean; decision?: "approve" | "reject"; notes?: string };
      }>;
    };
    return typed.items.map((item, index) => ({
      proposal: {
        id: item.proposal_id,
        workspace_id: typed.workspace_id,
        proposal_type: item.proposal_type,
        status: item.verifier?.required && item.verifier?.decision !== "approve" ? "rejected_by_guard" : "verified",
        reason_code: "test_reason",
        reason_text: "test reason",
        suggested_changes_json: {},
        evidence_json: {},
        planner_model: "memory_llm",
        planner_confidence: 0.9,
        verifier_required: Boolean(item.verifier?.required),
        verifier_model: item.verifier?.required ? "memory_llm" : null,
        verifier_decision: item.verifier?.decision ?? null,
        verifier_confidence: item.verifier?.decision === "approve" ? 0.9 : 0,
        verifier_notes: item.verifier?.notes ?? null,
        policy_version: "memory-governance-v1",
        idempotency_key: `test-${index}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      execution: {
        id: `exec-${index}`,
        workspace_id: typed.workspace_id,
        proposal_id: item.proposal_id,
        proposal_type: item.proposal_type,
        execution_status: item.verifier?.required && item.verifier?.decision !== "approve" ? "rejected_by_guard" : "executed",
        result_summary: item.verifier?.required && item.verifier?.decision !== "approve" ? null : "executed",
        error_message: item.verifier?.required && item.verifier?.decision !== "approve" ? item.verifier?.notes ?? "blocked" : null,
        source_service: "retrieval-runtime",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      },
    }));
  }

  releaseNextBatch() {
    const resolve = this.batchResolvers.shift();
    resolve?.();
  }
}

class StubPlanner implements LlmMaintenancePlanner {
  public planCalls: MaintenancePlanInput[] = [];

  constructor(private readonly factory: (input: MaintenancePlanInput) => MaintenancePlan) {}

  async plan(input: MaintenancePlanInput): Promise<MaintenancePlan> {
    this.planCalls.push(input);
    return this.factory(input);
  }
}

class StubVerifier implements GovernanceVerifier {
  public verifyCalls: GovernanceVerifierInput[] = [];

  constructor(
    private readonly result: GovernanceVerifierResult = {
      decision: "approve",
      confidence: 0.94,
      notes: "verified",
    },
  ) {}

  async verify(input: GovernanceVerifierInput): Promise<GovernanceVerifierResult> {
    this.verifyCalls.push(input);
    return this.result;
  }
}

class BlockingPlanner implements LlmMaintenancePlanner {
  private readonly waiters: Array<() => void> = [];
  public callCount = 0;

  constructor(private readonly result: MaintenancePlan) {}

  async plan(_input: MaintenancePlanInput): Promise<MaintenancePlan> {
    this.callCount += 1;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    return this.result;
  }

  releaseNext() {
    const resolve = this.waiters.shift();
    resolve?.();
  }
}

async function flushPromises() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

class StubRelationDiscoverer implements RelationDiscoverer {
  async discover(input: { candidate_records: MemoryRecordSnapshot[] }) {
    return {
      source_record_id: "seed-1",
      relations: input.candidate_records.slice(0, 1).map((record) => ({
        target_record_id: record.id,
        relation_type: "related_to" as const,
        strength: 0.88,
        bidirectional: true,
        reason: "同一约束上下文",
      })),
    };
  }
}

class StubEvolutionPlanner implements EvolutionPlanner {
  constructor(private readonly confidence = 0.9) {}

  async plan(input: { source_records: MemoryRecordSnapshot[] }) {
    return {
      evolution_type: "knowledge_extraction" as const,
      source_records: input.source_records.map((record) => record.id),
      extracted_knowledge: {
        pattern: "用户长期偏好：默认中文输出",
        confidence: this.confidence,
        evidence_count: input.source_records.length,
        suggested_scope: "workspace" as const,
        suggested_importance: 4,
      },
    };
  }
}

class StubWritebackEngine {
  public candidates: WriteBackCandidate[] = [];
  public filteredReasons: string[] = [];

  constructor(private readonly storage: RecordingStorageClient) {}

  async assessAndSubmitCandidates(candidates: WriteBackCandidate[]) {
    const accepted = candidates.filter((candidate) => {
      if (candidate.confidence < 0.7) {
        this.filteredReasons.push(`quality_blocked:${candidate.candidate_type}`);
        return false;
      }
      return true;
    });
    this.candidates.push(...accepted);
    const submittedJobs = accepted.length > 0 ? await this.storage.submitCandidates(accepted) : [];
    return {
      ok: true as const,
      submitted_jobs: submittedJobs as SubmittedWriteBackJob[],
      candidates: accepted,
      filtered_reasons: this.filteredReasons,
    };
  }
}

describe("WritebackMaintenanceWorker", () => {
  it("merges two similar records: patches anchor and archives the rest", async () => {
    const seed = makeRecord("seed-1", "默认使用中文输出", 4);
    const related = makeRecord("rel-1", "偏好中文输出", 3);
    const storage = new RecordingStorageClient([seed], [related]);
    const planner = new StubPlanner(() => ({
      actions: [
        {
          type: "merge",
          target_record_ids: [seed.id, related.id],
          merged_summary: "默认使用中文输出（合并后）",
          merged_importance: 5,
          reason: "duplicate stable preference",
        },
      ],
    }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const verifier = new StubVerifier();
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      verifier,
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(1);
    expect(summary.actions_skipped).toBe(0);
    const runs = await repository.getRuns();
    expect(runs.memory_plan_runs.some((run) => run.plan_kind === "memory_governance_plan")).toBe(true);
    expect(storage.governanceBatches).toHaveLength(1);
    const batch = storage.governanceBatches[0] as { items: Array<{ proposal_type: string; targets: { record_ids: string[] } }> };
    expect(batch.items[0]?.proposal_type).toBe("merge");
    expect(batch.items[0]?.targets.record_ids).toEqual([seed.id, related.id]);
    expect(verifier.verifyCalls).toHaveLength(1);
  });

  it("downgrades to archive when importance falls below MIN_IMPORTANCE", async () => {
    const record = makeRecord("rec-1", "零散事实", 3);
    const sibling = makeRecord("rec-2", "零散事实补充版", 3);
    const storage = new RecordingStorageClient([record], [sibling]);
    const planner = new StubPlanner(() => ({
      actions: [
        {
          type: "downgrade",
          record_id: record.id,
          new_importance: 1,
          reason: "no longer relevant",
        },
      ],
    }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(1);
    const batch = storage.governanceBatches[0] as { items: Array<{ proposal_type: string; targets: { record_ids: string[] } }> };
    expect(batch.items[0]?.proposal_type).toBe("archive");
    expect(batch.items[0]?.targets.record_ids).toEqual([record.id]);
  });

  it("summarize submits new candidate and archives sources", async () => {
    const a = makeRecord("a", "任务步骤 1 已完成");
    const b = makeRecord("b", "任务步骤 2 已完成");
    const storage = new RecordingStorageClient([a], [b]);
    const planner = new StubPlanner(() => ({
      actions: [
        {
          type: "summarize",
          source_record_ids: [a.id, b.id],
          new_summary: "任务完成摘要",
          new_importance: 4,
          scope: "workspace",
          candidate_type: "episodic",
          reason: "consolidate short episodic entries",
        },
      ],
    }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const verifier = new StubVerifier();
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      verifier,
      guard,
      makeConfig(),
      logger,
    );

    await worker.runOnce({ workspaceId, forced: true });

    const batch = storage.governanceBatches[0] as { items: Array<{ proposal_type: string; suggested_changes: { summary?: string } }> };
    expect(batch.items[0]?.proposal_type).toBe("summarize");
    expect(batch.items[0]?.suggested_changes.summary).toBe("任务完成摘要");
    expect(verifier.verifyCalls).toHaveLength(1);
  });

  it("reports degraded when planner is undefined", async () => {
    const seed = makeRecord("s", "偏好");
    const related = makeRecord("r", "偏好 2");
    const storage = new RecordingStorageClient([seed], [related]);

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      undefined,
      undefined,
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.degraded).toBe(true);
    expect(summary.actions_applied).toBe(0);
    expect(storage.governanceBatches).toHaveLength(0);
  });

  it("skips llm call when seeds + related < 2 and no conflicts", async () => {
    const seed = makeRecord("only", "孤立记录");
    const storage = new RecordingStorageClient([seed], []);
    const planner = new StubPlanner(() => {
      throw new Error("planner should not be called");
    });

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(0);
    expect(planner.planCalls).toHaveLength(0);
  });

  it("skips high-impact actions when verifier is disabled", async () => {
    const seed = makeRecord("seed-verify-off", "默认使用中文输出", 4);
    const related = makeRecord("rel-verify-off", "偏好中文输出", 3);
    const storage = new RecordingStorageClient([seed], [related]);
    const planner = new StubPlanner(() => ({
      actions: [
        {
          type: "merge",
          target_record_ids: [seed.id, related.id],
          merged_summary: "默认使用中文输出（合并后）",
          merged_importance: 5,
          reason: "duplicate stable preference",
        },
      ],
    }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig({ WRITEBACK_GOVERNANCE_VERIFY_ENABLED: false }),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(0);
    expect(summary.actions_skipped).toBe(1);
    expect(storage.governanceBatches).toHaveLength(1);
    const batch = storage.governanceBatches[0] as {
      items: Array<{ verifier: { required: boolean; decision?: string; notes?: string } }>;
    };
    expect(batch.items[0]?.verifier).toMatchObject({
      required: true,
      decision: "reject",
      notes: "verifier_disabled",
    });
  });

  it("does not submit governance batch when shadow mode is enabled", async () => {
    const record = makeRecord("shadow-archive", "旧任务状态", 3);
    const sibling = makeRecord("shadow-related", "新任务状态", 4);
    const storage = new RecordingStorageClient([record], [sibling]);
    const planner = new StubPlanner(() => ({
      actions: [
        {
          type: "archive",
          record_id: record.id,
          reason: "superseded by newer record",
        },
      ],
    }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig({ WRITEBACK_GOVERNANCE_SHADOW_MODE: true }),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(1);
    expect(summary.actions_skipped).toBe(0);
    expect(storage.governanceBatches).toHaveLength(0);
  });

  it("passes recently rejected proposals into governance planner", async () => {
    const seed = makeRecord("seed-rejected", "默认使用中文输出", 4);
    const related = makeRecord("rel-rejected", "偏好中文输出", 3);
    const storage = new RecordingStorageClient([seed], [related], [], [
      {
        id: "proposal-rejected",
        proposal_type: "merge",
        reason_text: "merge duplicate stable preference",
        verifier_notes: "records were judged unrelated",
        created_at: "2026-04-22T00:00:00.000Z",
      },
    ]);
    const planner = new StubPlanner(() => ({ actions: [] }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig(),
      logger,
    );

    await worker.runOnce({ workspaceId, forced: true });

    expect(planner.planCalls[0]?.recently_rejected).toEqual([
      {
        proposal_type: "merge",
        reason_text: "merge duplicate stable preference",
        verifier_notes: "records were judged unrelated",
      },
    ]);
  });

  it("discovers relations during maintenance and persists them", async () => {
    const seed = makeRecord("seed-rel", "默认中文输出，代码注释也保持中文", 4);
    const related = makeRecord("rel-rel", "代码注释保持中文，默认中文输出", 4);
    const storage = new RecordingStorageClient([seed], [related]);
    const planner = new StubPlanner(() => ({ actions: [] }));
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig(),
      logger,
      new StubRelationDiscoverer(),
    );

    await worker.runOnce({ workspaceId, forced: true });

    expect(storage.relationBatches).toHaveLength(1);
    const relationBatch = storage.relationBatches[0] as Array<{ source_record_id: string; target_record_id: string }>;
    expect(relationBatch[0]?.source_record_id).toBe(seed.id);
    expect(relationBatch[0]?.target_record_id).toBe(related.id);
  });

  it("writes evolved knowledge during maintenance", async () => {
    const seed = makeRecord("seed-evo", "默认中文输出，回答尽量简短直接", 4);
    const related = makeRecord("rel-evo", "回答尽量简短直接，默认中文输出", 4);
    const storage = new RecordingStorageClient([seed], [related]);
    const writebackEngine = new StubWritebackEngine(storage);
    const planner = new StubPlanner(() => ({ actions: [] }));
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig(),
      logger,
      undefined,
      new StubEvolutionPlanner(),
      writebackEngine,
    );

    await worker.runOnce({ workspaceId, forced: true });

    expect(storage.writebackCandidates).toHaveLength(1);
    const candidates = storage.writebackCandidates[0] as Array<{ summary: string }>;
    expect(candidates[0]?.summary).toBe("用户长期偏好：默认中文输出");
  });

  it("filters low quality evolved knowledge before storage submission", async () => {
    const seed = makeRecord("seed-evo-low", "默认中文输出，回答尽量简短直接", 4);
    const related = makeRecord("rel-evo-low", "回答尽量简短直接，默认中文输出", 4);
    const storage = new RecordingStorageClient([seed], [related]);
    const writebackEngine = new StubWritebackEngine(storage);
    const planner = new StubPlanner(() => ({ actions: [] }));
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig(),
      logger,
      undefined,
      new StubEvolutionPlanner(0.4),
      writebackEngine,
    );

    await worker.runOnce({ workspaceId, forced: true });

    expect(writebackEngine.filteredReasons).toEqual(["quality_blocked:episodic"]);
    expect(storage.writebackCandidates).toHaveLength(0);
  });

  it("rejects concurrent manual runs for the same workspace", async () => {
    const seed = makeRecord("seed-lock", "默认使用中文输出", 4);
    const related = makeRecord("rel-lock", "偏好中文输出", 3);
    const storage = new RecordingStorageClient([seed], [related]);
    const planner = new BlockingPlanner({
      actions: [
        {
          type: "merge",
          target_record_ids: [seed.id, related.id],
          merged_summary: "默认使用中文输出（合并后）",
          merged_importance: 5,
          reason: "duplicate stable preference",
        },
      ],
    });

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      new StubVerifier(),
      guard,
      makeConfig(),
      logger,
    );

    const firstRun = worker.runOnce({ workspaceId, forced: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(worker.runOnce({ workspaceId, forced: true })).rejects.toMatchObject({
      code: "conflict_error",
      statusCode: 409,
    });

    planner.releaseNext();
    const summary = await firstRun;
    expect(summary.actions_applied).toBe(1);
  });

  it("schedules the next automatic tick only after the current run finishes", async () => {
    vi.useFakeTimers();
    try {
      const repository = new InMemoryRuntimeRepository();
      const logger = pino({ enabled: false });
      const guard = new DependencyGuard(repository, logger);
      const worker = new WritebackMaintenanceWorker(
        repository,
        new RecordingStorageClient([], []),
        undefined,
        undefined,
        guard,
        makeConfig({ WRITEBACK_MAINTENANCE_INTERVAL_MS: 1000 }),
        logger,
      );
      let finishFirstRun!: () => void;
      const firstRun = new Promise<void>((resolve) => {
        finishFirstRun = resolve;
      });
      const summary = {
        workspace_ids_scanned: [],
        seeds_inspected: 0,
        related_fetched: 0,
        actions_proposed: 0,
        actions_applied: 0,
        actions_skipped: 0,
        conflicts_resolved: 0,
        degraded: false,
        next_checkpoint: new Date().toISOString(),
      };
      const runOnce = vi
        .spyOn(worker, "runOnce")
        .mockImplementationOnce(async () => {
          await firstRun;
          return summary;
        })
        .mockResolvedValue(summary);

      worker.start();
      await vi.advanceTimersByTimeAsync(1000);
      await flushPromises();
      expect(runOnce).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5000);
      await flushPromises();
      expect(runOnce).toHaveBeenCalledTimes(1);

      finishFirstRun();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(1000);
      await flushPromises();
      expect(runOnce).toHaveBeenCalledTimes(2);

      worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prioritizes urgent maintenance workspaces ahead of checkpoint rotation", async () => {
    const urgentWorkspace = "550e8400-e29b-41d4-a716-446655440010";
    const checkpointWorkspace = "550e8400-e29b-41d4-a716-446655440011";
    const repository = new InMemoryRuntimeRepository();
    await repository.enqueueUrgentMaintenanceWorkspace({
      workspace_id: urgentWorkspace,
      enqueued_at: "2026-04-22T00:00:00.000Z",
      reason: "writeback reported an open conflict",
      source: "open_conflict",
    });
    await repository.upsertMaintenanceCheckpoint({
      workspace_id: checkpointWorkspace,
      last_scanned_at: "2026-04-01T00:00:00.000Z",
    });

    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      new RecordingStorageClient([], []),
      undefined,
      undefined,
      guard,
      makeConfig({ WRITEBACK_MAINTENANCE_WORKSPACE_BATCH: 1 }),
      logger,
    );

    const summary = await worker.runOnce({ forced: true });

    expect(summary.workspace_ids_scanned).toEqual([urgentWorkspace]);
    expect(await repository.claimUrgentMaintenanceWorkspaces(5)).toHaveLength(0);
  });

  it("submits a blocked governance execution when verifier is unavailable", async () => {
    const seed = makeRecord("seed-verifier-missing", "默认使用中文输出", 4);
    const related = makeRecord("rel-verifier-missing", "偏好中文输出", 3);
    const storage = new RecordingStorageClient([seed], [related]);
    const planner = new StubPlanner(() => ({
      actions: [
        {
          type: "merge",
          target_record_ids: [seed.id, related.id],
          merged_summary: "默认使用中文输出（合并后）",
          merged_importance: 5,
          reason: "duplicate stable preference",
        },
      ],
    }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(0);
    expect(summary.actions_skipped).toBe(1);
    expect(storage.governanceBatches).toHaveLength(1);
    const batch = storage.governanceBatches[0] as {
      items: Array<{ verifier: { required: boolean; decision?: string; notes?: string } }>;
    };
    expect(batch.items[0]?.verifier).toMatchObject({
      required: true,
      decision: "reject",
      notes: "verifier_unavailable",
    });
  });

  it("archives expired session episodic memories during maintenance", async () => {
    const expired = makeSessionEpisodicRecord("session-old", "2026-04-01T00:00:00.000Z");
    const fresh = makeSessionEpisodicRecord("session-fresh", "2026-04-22T00:00:00.000Z");
    const storage = new RecordingStorageClient([expired, fresh], []);
    const planner = new StubPlanner(() => ({ actions: [] }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig({
        WRITEBACK_SESSION_EPISODIC_TTL_MS: 7 * 24 * 60 * 60 * 1000,
      }),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(1);
    const batch = storage.governanceBatches[0] as {
      items: Array<{ proposal_type: string; targets: { record_ids: string[] } }>;
    };
    expect(batch.items.some((item) => item.proposal_type === "archive" && item.targets.record_ids.includes("session-old"))).toBe(true);
    expect(batch.items.some((item) => item.targets.record_ids.includes("session-fresh"))).toBe(false);
  });

  it("does not archive expired related session episodic memories", async () => {
    const seed = makeRecord("seed-lifecycle", "默认使用中文输出");
    const related = makeSessionEpisodicRecord("related-session-old", "2026-04-01T00:00:00.000Z");
    const storage = new RecordingStorageClient([seed], [related]);
    const planner = new StubPlanner(() => ({ actions: [] }));

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      undefined,
      guard,
      makeConfig({
        WRITEBACK_SESSION_EPISODIC_TTL_MS: 7 * 24 * 60 * 60 * 1000,
      }),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(0);
    expect(storage.governanceBatches).toHaveLength(0);
    expect(planner.planCalls).toHaveLength(0);
  });

  it("uses server-side created_after filtering for recent seeds", async () => {
    const fresh = makeRecord("fresh-seed", "默认使用中文输出");
    const old = makeRecord("old-seed", "旧偏好记录");
    old.created_at = "2026-01-01T00:00:00.000Z";
    old.updated_at = "2026-01-01T00:00:00.000Z";
    const storage = new RecordingStorageClient([fresh, old], []);

    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const guard = new DependencyGuard(repository, logger);
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      new StubPlanner(() => ({ actions: [] })),
      undefined,
      guard,
      makeConfig({ WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS: 24 * 60 * 60 * 1000 }),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.seeds_inspected).toBe(1);
    expect(storage.listRecordFilters[0]?.created_after).toBeTruthy();
    expect(storage.listRecordFilters[1]).toMatchObject({
      scope: "session",
      memory_type: "episodic",
      status: "active",
    });
    expect(storage.listRecordFilters[1]?.created_after).toBeUndefined();
  });
});

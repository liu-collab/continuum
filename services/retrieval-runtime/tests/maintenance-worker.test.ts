import { describe, expect, it } from "vitest";
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
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
} from "../src/shared/types.js";

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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_used_at: null,
  };
}

class RecordingStorageClient implements StorageWritebackClient {
  public governanceBatches: Array<unknown> = [];

  constructor(
    private readonly seeds: MemoryRecordSnapshot[],
    private readonly related: MemoryRecordSnapshot[],
    private readonly conflicts: MemoryConflictSnapshot[] = [],
  ) {}

  async submitCandidates(): Promise<never> {
    throw new Error("submitCandidates should not be called by governance worker");
  }

  async listRecords(filters: RecordListFilters): Promise<RecordListPage> {
    const isSeedCall = !filters.memory_type;
    const items = isSeedCall ? this.seeds : [...this.seeds, ...this.related];
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

  async archiveRecord(_recordId: string, _payload: StorageMutationPayload): Promise<never> {
    throw new Error("archiveRecord should not be called by governance worker");
  }

  async listConflicts(_status?: ConflictStatus): Promise<MemoryConflictSnapshot[]> {
    return this.conflicts;
  }

  async resolveConflict(_conflictId: string, _payload: ResolveConflictPayload): Promise<never> {
    throw new Error("resolveConflict should not be called by governance worker");
  }

  async submitGovernanceExecutions(batch: unknown): Promise<GovernanceExecutionResponseItem[]> {
    this.governanceBatches.push(batch);
    const typed = batch as { workspace_id: string; items: Array<{ proposal_id: string; proposal_type: GovernanceExecutionResponseItem["execution"]["proposal_type"] }> };
    return typed.items.map((item, index) => ({
      proposal: {
        id: item.proposal_id,
        workspace_id: typed.workspace_id,
        proposal_type: item.proposal_type,
        status: "verified",
        reason_code: "test_reason",
        reason_text: "test reason",
        suggested_changes_json: {},
        evidence_json: {},
        planner_model: "writeback_llm",
        planner_confidence: 0.9,
        verifier_required: false,
        verifier_model: null,
        verifier_decision: null,
        verifier_confidence: null,
        verifier_notes: null,
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
        execution_status: "executed",
        result_summary: "executed",
        error_message: null,
        source_service: "retrieval-runtime",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      },
    }));
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
    expect(storage.governanceBatches).toHaveLength(0);
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
});

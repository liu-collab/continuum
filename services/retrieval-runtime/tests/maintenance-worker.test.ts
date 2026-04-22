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
  ConflictStatus,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  SubmittedWriteBackJob,
  WriteBackCandidate,
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
  public submitted: WriteBackCandidate[] = [];
  public patched: Array<{ id: string; payload: RecordPatchPayload }> = [];
  public archived: Array<{ id: string; payload: StorageMutationPayload }> = [];
  public conflictsResolved: Array<{ id: string; payload: ResolveConflictPayload }> = [];

  constructor(
    private readonly seeds: MemoryRecordSnapshot[],
    private readonly related: MemoryRecordSnapshot[],
    private readonly conflicts: MemoryConflictSnapshot[] = [],
  ) {}

  async submitCandidates(candidates: WriteBackCandidate[]): Promise<SubmittedWriteBackJob[]> {
    this.submitted.push(...candidates);
    return candidates.map((candidate) => ({
      candidate_summary: candidate.summary,
      status: "accepted_async",
    }));
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

  async patchRecord(recordId: string, payload: RecordPatchPayload): Promise<MemoryRecordSnapshot> {
    this.patched.push({ id: recordId, payload });
    const existing = [...this.seeds, ...this.related].find((r) => r.id === recordId);
    return {
      ...(existing ?? makeRecord(recordId, payload.summary ?? "")),
      summary: payload.summary ?? existing?.summary ?? "",
      importance: payload.importance ?? existing?.importance ?? 3,
    };
  }

  async archiveRecord(recordId: string, payload: StorageMutationPayload): Promise<MemoryRecordSnapshot> {
    this.archived.push({ id: recordId, payload });
    const existing = [...this.seeds, ...this.related].find((r) => r.id === recordId);
    return { ...(existing ?? makeRecord(recordId, "")), status: "archived" };
  }

  async listConflicts(_status?: ConflictStatus): Promise<MemoryConflictSnapshot[]> {
    return this.conflicts;
  }

  async resolveConflict(conflictId: string, payload: ResolveConflictPayload): Promise<MemoryConflictSnapshot> {
    this.conflictsResolved.push({ id: conflictId, payload });
    const existing = this.conflicts.find((c) => c.id === conflictId);
    if (!existing) {
      throw new Error(`conflict ${conflictId} not found`);
    }
    return { ...existing, status: "resolved" };
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
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(1);
    expect(summary.actions_skipped).toBe(0);
    expect(storage.patched).toHaveLength(1);
    expect(storage.patched[0]?.id).toBe(seed.id);
    expect(storage.patched[0]?.payload.summary).toContain("合并后");
    expect(storage.archived.map((a) => a.id)).toEqual([related.id]);
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
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(1);
    expect(storage.archived).toHaveLength(1);
    expect(storage.archived[0]?.id).toBe(record.id);
    expect(storage.patched).toHaveLength(0);
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
    const worker = new WritebackMaintenanceWorker(
      repository,
      storage,
      planner,
      guard,
      makeConfig(),
      logger,
    );

    await worker.runOnce({ workspaceId, forced: true });

    expect(storage.submitted).toHaveLength(1);
    expect(storage.submitted[0]?.summary).toBe("任务完成摘要");
    expect(storage.submitted[0]?.source.source_type).toBe("writeback_maintenance");
    expect(new Set(storage.archived.map((a) => a.id))).toEqual(new Set([a.id, b.id]));
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
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.degraded).toBe(true);
    expect(summary.actions_applied).toBe(0);
    expect(storage.patched).toHaveLength(0);
    expect(storage.archived).toHaveLength(0);
    expect(storage.submitted).toHaveLength(0);
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
      guard,
      makeConfig(),
      logger,
    );

    const summary = await worker.runOnce({ workspaceId, forced: true });

    expect(summary.actions_applied).toBe(0);
    expect(planner.planCalls).toHaveLength(0);
  });
});

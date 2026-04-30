import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import type { MemoryOrchestrator } from "../src/memory-orchestrator/index.js";
import { InMemoryRuntimeRepository } from "../src/observability/in-memory-runtime-repository.js";
import { RecallAugmentationService } from "../src/query/recall-augmentation-service.js";
import type {
  CandidateMemory,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  MemoryRelationSnapshot,
  TriggerContext,
} from "../src/shared/types.js";
import type { RecordListPage, StorageWritebackClient } from "../src/writeback/storage-client.js";

function createContext(overrides: Partial<TriggerContext> = {}): TriggerContext & { memory_mode: "workspace_plus_global" } {
  return {
    host: "custom_agent",
    workspace_id: "workspace-1",
    user_id: "user-1",
    session_id: "session-1",
    phase: "before_response",
    current_input: "continue",
    memory_mode: "workspace_plus_global",
    ...overrides,
  };
}

function createCandidate(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    id: "memory-1",
    workspace_id: "workspace-1",
    user_id: "user-1",
    session_id: null,
    task_id: null,
    memory_type: "preference",
    scope: "user",
    summary: "用户偏好：用中文回答。",
    importance: 4,
    confidence: 0.9,
    status: "active",
    updated_at: "2026-04-30T00:00:00.000Z",
    rerank_score: 0.9,
    ...overrides,
  };
}

function createRecord(overrides: Partial<MemoryRecordSnapshot> = {}): MemoryRecordSnapshot {
  return {
    id: "record-1",
    workspace_id: "workspace-1",
    user_id: "user-1",
    task_id: null,
    session_id: null,
    memory_type: "preference",
    scope: "user",
    status: "active",
    summary: "用户偏好：用中文回答。",
    details: {},
    importance: 4,
    confidence: 0.9,
    created_at: "2026-04-30T00:00:00.000Z",
    updated_at: "2026-04-30T00:00:00.000Z",
    last_used_at: null,
    ...overrides,
  };
}

class StubStorageClient implements Pick<
  StorageWritebackClient,
  "getRecordsByIds" | "listConflicts" | "listRecords" | "listRelations"
> {
  constructor(
    private readonly records: MemoryRecordSnapshot[] = [],
    private readonly relations: MemoryRelationSnapshot[] = [],
    private readonly conflicts: MemoryConflictSnapshot[] = [],
  ) {}

  async listRecords(): Promise<RecordListPage> {
    return {
      items: this.records,
      total: this.records.length,
      page: 1,
      page_size: 20,
    };
  }

  async getRecordsByIds(recordIds: string[]): Promise<MemoryRecordSnapshot[]> {
    const idSet = new Set(recordIds);
    return this.records.filter((record) => idSet.has(record.id));
  }

  async listRelations(): Promise<MemoryRelationSnapshot[]> {
    return this.relations;
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return this.conflicts;
  }
}

function createService(input: {
  storageClient?: Pick<StorageWritebackClient, "getRecordsByIds" | "listConflicts" | "listRecords" | "listRelations">;
  memoryOrchestrator?: Pick<MemoryOrchestrator, "recommendation">;
  repository?: InMemoryRuntimeRepository;
} = {}) {
  const repository = input.repository ?? new InMemoryRuntimeRepository();
  const planRuns: Parameters<InMemoryRuntimeRepository["recordMemoryPlanRun"]>[0][] = [];
  vi.spyOn(repository, "recordMemoryPlanRun").mockImplementation(async (run) => {
    planRuns.push(run);
  });
  const logger = pino({ enabled: false });
  const dependencyGuard = new DependencyGuard(repository, logger);
  return {
    planRuns,
    repository,
    service: new RecallAugmentationService({
      dependencyGuard,
      repository,
      logger,
      embeddingTimeoutMs: 100,
      memoryLlmTimeoutMs: 100,
      memoryOrchestrator: input.memoryOrchestrator,
      storageClient: input.storageClient,
    }),
  };
}

describe("RecallAugmentationService", () => {
  it("marks candidates with open conflicts and applies conflict rank penalty", async () => {
    const conflict: MemoryConflictSnapshot = {
      id: "conflict-1",
      workspace_id: "workspace-1",
      record_id: "memory-conflict",
      conflict_with_record_id: "memory-other",
      conflict_type: "preference_conflict",
      conflict_summary: "偏好冲突",
      status: "open",
      created_at: "2026-04-30T00:00:00.000Z",
    };
    const { service } = createService({
      storageClient: new StubStorageClient([], [], [conflict]),
    });

    const candidates = await service.annotateOpenConflicts(createContext(), [
      createCandidate({ id: "memory-clean", rerank_score: 0.4 }),
      createCandidate({ id: "memory-conflict", rerank_score: 0.9 }),
    ]);

    const conflicted = candidates.find((candidate) => candidate.id === "memory-conflict");
    expect(conflicted?.has_open_conflict).toBe(true);
    expect(conflicted?.rerank_score).toBeLessThan(0.9);
  });

  it("expands candidates with strong storage relations", async () => {
    const relatedRecord = createRecord({
      id: "memory-related",
      memory_type: "episodic",
      scope: "task",
      summary: "相关历史：接口结构已确认。",
    });
    const relation: MemoryRelationSnapshot = {
      id: "relation-1",
      workspace_id: "workspace-1",
      source_record_id: "memory-seed",
      target_record_id: "memory-related",
      relation_type: "related_to",
      strength: 0.86,
      bidirectional: true,
      reason: "同一任务上下文",
      created_by_service: "retrieval-runtime",
      created_at: "2026-04-30T00:00:00.000Z",
      updated_at: "2026-04-30T00:00:00.000Z",
    };
    const { planRuns, service } = createService({
      storageClient: new StubStorageClient([relatedRecord], [relation]),
    });

    const related = await service.expandCandidatesWithRelations(
      createContext(),
      [createCandidate({ id: "memory-seed", memory_type: "task_state", scope: "task" })],
      "trace-1",
    );

    expect(related.map((candidate) => candidate.id)).toEqual(["memory-related"]);
    expect(related[0]?.details).toMatchObject({
      relation_type: "related_to",
      relation_strength: 0.86,
    });
    expect(planRuns.at(-1)?.plan_kind).toBe("memory_relation_plan");
    expect(planRuns.at(-1)?.result_state).toBe("planned");
  });

  it("collects high-confidence proactive recommendations", async () => {
    const recommend = vi.fn(async () => ({
      recommendations: [
        {
          record_id: "record-1",
          relevance_score: 0.93,
          trigger_reason: "task_similarity" as const,
          suggestion: "继续沿用中文输出。",
          auto_inject: false,
        },
        {
          record_id: "record-low",
          relevance_score: 0.2,
          trigger_reason: "forgotten_context" as const,
          suggestion: "低相关建议。",
          auto_inject: false,
        },
      ],
    }));
    const { planRuns, service } = createService({
      storageClient: new StubStorageClient([createRecord()]),
      memoryOrchestrator: {
        recommendation: {
          recommend,
        },
      },
    });

    const recommendations = await service.collectProactiveRecommendations(
      createContext({ phase: "session_start" }),
      "trace-1",
    );

    expect(recommendations).toEqual([
      {
        record_id: "record-1",
        relevance_score: 0.93,
        trigger_reason: "task_similarity",
        suggestion: "继续沿用中文输出。",
        auto_inject: true,
      },
    ]);
    expect(recommend).toHaveBeenCalledWith(expect.objectContaining({
      available_memories: [expect.objectContaining({ id: "record-1" })],
    }));
    expect(planRuns.at(-1)?.plan_kind).toBe("memory_recommendation_plan");
    expect(planRuns.at(-1)?.result_state).toBe("planned");
  });
});

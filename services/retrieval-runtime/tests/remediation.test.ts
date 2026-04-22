import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AppConfig } from "../src/config.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { InjectionEngine } from "../src/injection/injection-engine.js";
import { createMemoryOrchestrator } from "../src/memory-orchestrator/index.js";
import { InMemoryRuntimeRepository } from "../src/observability/in-memory-runtime-repository.js";
import { PostgresRuntimeRepository } from "../src/observability/postgres-runtime-repository.js";
import { InMemoryReadModelRepository } from "../src/query/in-memory-read-model-repository.js";
import { PostgresReadModelRepository } from "../src/query/postgres-read-model-repository.js";
import { buildRetrievalQuery, QueryEngine } from "../src/query/query-engine.js";
import { RetrievalRuntimeService } from "../src/runtime-service.js";
import type { CandidateMemory } from "../src/shared/types.js";
import { estimateTokens } from "../src/shared/utils.js";
import { TriggerEngine } from "../src/trigger/trigger-engine.js";
import { renderMigrationTemplate } from "../src/db/migration-runner.js";
import { FinalizeIdempotencyCache } from "../src/writeback/finalize-idempotency-cache.js";
import { HttpLlmExtractor } from "../src/writeback/llm-extractor.js";
import { WritebackEngine } from "../src/writeback/writeback-engine.js";

const localWriteBackBatchRequestSchema = z.object({
  candidates: z
    .array(
      z
        .object({
          workspace_id: z.string().uuid(),
          user_id: z.string().uuid().nullable().optional(),
          task_id: z.string().uuid().nullable().optional(),
          session_id: z.string().uuid().nullable().optional(),
          candidate_type: z.enum(["fact_preference", "task_state", "episodic"]),
          scope: z.enum(["session", "task", "user", "workspace"]),
          summary: z.string().trim().min(3).max(500),
          details: z.record(z.string(), z.unknown()),
          importance: z.number().int().min(1).max(5).optional(),
          confidence: z.number().min(0).max(1).optional(),
          write_reason: z.string().trim().min(3).max(240),
          source: z.object({
            source_type: z.string().trim().min(1),
            source_ref: z.string().trim().min(1),
            service_name: z.string().trim().min(1),
            confirmed_by_user: z.boolean().optional(),
            extraction_method: z.string().trim().min(1).optional(),
          }),
          idempotency_key: z.string().trim().min(8).max(128).optional(),
        })
        .superRefine((value, ctx) => {
          if (value.scope !== "workspace" && !value.user_id) {
            ctx.addIssue({
              code: "custom",
              message: "user_id is required for non-workspace scopes",
              path: ["user_id"],
            });
          }

          if (value.scope === "task" && !value.task_id) {
            ctx.addIssue({
              code: "custom",
              message: "task_id is required for task scope",
              path: ["task_id"],
            });
          }

          if (value.scope === "session" && !value.session_id) {
            ctx.addIssue({
              code: "custom",
              message: "session_id is required for session scope",
              path: ["session_id"],
            });
          }
        }),
    )
    .min(1)
    .max(50),
});

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3002,
  LOG_LEVEL: "info",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
  READ_MODEL_SCHEMA: "storage_shared_v1",
  READ_MODEL_TABLE: "memory_read_model_v1",
  RUNTIME_SCHEMA: "runtime_private",
  STORAGE_WRITEBACK_URL: "http://localhost:3001",
  EMBEDDING_BASE_URL: "http://localhost:8090/v1",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_API_KEY: "test-key",
  MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
  MEMORY_LLM_PROTOCOL: "openai-compatible",
  MEMORY_LLM_TIMEOUT_MS: 15000,
  RECALL_LLM_JUDGE_ENABLED: true,
  RECALL_LLM_JUDGE_MAX_TOKENS: 400,
  RECALL_LLM_CANDIDATE_LIMIT: 12,
  WRITEBACK_LLM_REFINE_MAX_TOKENS: 800,
  WRITEBACK_REFINE_ENABLED: true,
  WRITEBACK_MAX_CANDIDATES: 3,
  WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS: 5000,
  WRITEBACK_OUTBOX_BATCH_SIZE: 50,
  WRITEBACK_OUTBOX_MAX_RETRIES: 5,
  WRITEBACK_MAINTENANCE_ENABLED: false,
  WRITEBACK_MAINTENANCE_INTERVAL_MS: 15 * 60 * 1000,
  WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS: 60 * 60 * 1000,
  WRITEBACK_MAINTENANCE_WORKSPACE_BATCH: 3,
  WRITEBACK_MAINTENANCE_SEED_LIMIT: 20,
  WRITEBACK_MAINTENANCE_RELATED_LIMIT: 40,
  WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD: 0.35,
  WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS: 24 * 60 * 60 * 1000,
  WRITEBACK_MAINTENANCE_TIMEOUT_MS: 5_000,
  WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1500,
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
  WRITEBACK_MAINTENANCE_MIN_IMPORTANCE: 2,
  WRITEBACK_MAINTENANCE_ACTOR_ID: "retrieval-runtime-maintenance",
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
  WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: 1000,
  WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE: 0.85,
  WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE: 0.92,
  WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
  FINALIZE_IDEMPOTENCY_TTL_MS: 5 * 60 * 1000,
  FINALIZE_IDEMPOTENCY_MAX_ENTRIES: 500,
  WRITEBACK_INPUT_OVERLAP_THRESHOLD: 0.2,
  QUERY_TIMEOUT_MS: 40,
  STORAGE_TIMEOUT_MS: 40,
  EMBEDDING_TIMEOUT_MS: 40,
  QUERY_CANDIDATE_LIMIT: 30,
  PACKET_RECORD_LIMIT: 10,
  INJECTION_RECORD_LIMIT: 3,
  INJECTION_TOKEN_BUDGET: 120,
  SEMANTIC_TRIGGER_THRESHOLD: 0.72,
  IMPORTANCE_THRESHOLD_SESSION_START: 4,
  IMPORTANCE_THRESHOLD_DEFAULT: 3,
  IMPORTANCE_THRESHOLD_SEMANTIC: 4,
};

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

class FakeClient {
  public readonly queries: Array<{ text: string; values?: unknown[] }> = [];
  public released = false;
  public destroyed = false;

  constructor(private readonly rows: Record<string, unknown>[] = [], private readonly onQuery?: (text: string) => Promise<void> | void) {}

  async query<T>(queryTextOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
    const boundValues = typeof queryTextOrConfig === "string" ? values : queryTextOrConfig.values;
    this.queries.push({ text, values: boundValues });
    await this.onQuery?.(text);
    return {
      rows: this.rows as T[],
    };
  }

  release(destroy?: boolean) {
    this.released = true;
    this.destroyed = Boolean(destroy);
  }
}

class FakePool {
  public readonly queries: Array<{ text: string; values?: unknown[] }> = [];
  public clients: FakeClient[] = [];

  constructor(private readonly rows: Record<string, unknown>[] = [], private readonly onQuery?: (text: string) => Promise<void> | void) {}

  async query<T>(queryTextOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
    const boundValues = typeof queryTextOrConfig === "string" ? values : queryTextOrConfig.values;
    this.queries.push({ text, values: boundValues });
    return {
      rows: this.rows as T[],
    };
  }

  async connect() {
    const client = new FakeClient(this.rows, this.onQuery);
    this.clients.push(client);
    return client;
  }
}

class StubEmbeddingsClient {
  constructor(private readonly vector: number[] = [1, 0, 0]) {}

  async embedText(): Promise<number[]> {
    return this.vector;
  }
}

class StubStorageClient {
  public callCount = 0;

  async submitCandidates(candidates: Array<{ summary: string }>) {
    this.callCount += 1;
    return candidates.map((candidate) => ({
      candidate_summary: candidate.summary,
      status: "accepted_async" as const,
    }));
  }

  async listRecords() {
    return { items: [], total: 0, page: 1, page_size: 20 };
  }

  async patchRecord(): Promise<never> {
    throw new Error("StubStorageClient.patchRecord not implemented in test");
  }

  async archiveRecord(): Promise<never> {
    throw new Error("StubStorageClient.archiveRecord not implemented in test");
  }

  async listConflicts() {
    return [];
  }

  async resolveConflict(): Promise<never> {
    throw new Error("StubStorageClient.resolveConflict not implemented in test");
  }

  async submitGovernanceExecutions() {
    return [];
  }
}

class CountingLlmExtractor {
  public callCount = 0;
  public refineCallCount = 0;

  async extract() {
    this.callCount += 1;
    return {
      candidates: [
        {
          candidate_type: "fact_preference" as const,
          scope: "user" as const,
          summary: "默认中文输出",
          importance: 5,
          confidence: 0.93,
          write_reason: "stable preference",
        },
      ],
    };
  }

  async refine() {
    this.refineCallCount += 1;
    return {
      refined_candidates: [
        {
          source: "llm_new" as const,
          action: "new" as const,
          summary: "默认中文输出",
          importance: 5,
          confidence: 0.93,
          scope: "user" as const,
          candidate_type: "fact_preference" as const,
          reason: "stable preference",
        },
      ],
    };
  }
}

const candidateRecords: CandidateMemory[] = [
  {
    id: "memory-1",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: ids.task,
    memory_type: "fact_preference",
    scope: "user",
    summary: "用户偏好：输出保持中文。",
    importance: 5,
    confidence: 0.9,
    status: "active",
    updated_at: "2026-04-15T10:00:00.000Z",
    summary_embedding: [1, 0, 0],
  },
];

const baseCandidateRecord = candidateRecords[0]!;

describe("retrieval-runtime remediation", () => {
  it("ships Claude Code and Codex host adapter artifacts", async () => {
    const expectedFiles = [
      "host-adapters/memory-claude-plugin/.claude-plugin/plugin.json",
      "host-adapters/memory-claude-plugin/hooks/hooks.json",
      "host-adapters/memory-claude-plugin/.mcp.json",
      "host-adapters/memory-claude-plugin/bin/memory-bridge.mjs",
      "host-adapters/memory-claude-plugin/bin/memory-runtime-bootstrap.mjs",
      "host-adapters/memory-codex-adapter/bin/memory-codex.mjs",
      "host-adapters/memory-codex-adapter/bin/memory-codex-proxy.mjs",
      "host-adapters/memory-codex-adapter/bin/memory-runtime-bootstrap.mjs",
      "host-adapters/memory-codex-adapter/config/codex.memory.toml",
      "host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs",
    ];

    for (const relativePath of expectedFiles) {
      await expect(
        access(path.resolve("C:/workspace/work/agent-memory/services/retrieval-runtime", relativePath)),
      ).resolves.toBeUndefined();
    }
  });

  it("ships a real Codex MCP bridge instead of a placeholder message", async () => {
    const filePath = path.resolve(
      "C:/workspace/work/agent-memory/services/retrieval-runtime",
      "host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs",
    );
    const content = await readFile(filePath, "utf8");

    expect(content).toContain("tools/list");
    expect(content).toContain("memory_dependency_status");
    expect(content).toContain("memory_explain_hit");
    expect(content).not.toContain("Replace this placeholder");
  });

  it("persists runtime_private observability records with the Postgres repository", async () => {
    const pool = new FakePool();
    const repository = new PostgresRuntimeRepository(config, pool as never);

    await repository.initialize();
    await repository.recordTurn({
      trace_id: "trace-1",
      host: "claude_code_plugin",
      workspace_id: "ws-1",
      user_id: "user-1",
      session_id: "session-1",
      phase: "before_response",
      task_id: "task-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      current_input: "上次那个约定继续沿用",
      created_at: "2026-04-15T12:00:00.000Z",
    });
    await repository.recordTriggerRun({
      trace_id: "trace-1",
      phase: "before_response",
      trigger_hit: true,
      trigger_type: "history_reference",
      trigger_reason: "current input explicitly references prior context or preferences",
      requested_memory_types: ["fact_preference"],
      memory_mode: "workspace_plus_global",
      requested_scopes: ["workspace", "task", "user"],
      scope_reason: "before_response can use workspace, task, session, and global user memory",
      importance_threshold: 3,
      cooldown_applied: false,
      semantic_score: 0.91,
      duration_ms: 8,
      created_at: "2026-04-15T12:00:00.000Z",
    });
    await repository.recordWritebackSubmission({
      trace_id: "trace-1",
      phase: "after_response",
      candidate_count: 2,
      submitted_count: 1,
      memory_mode: "workspace_plus_global",
      final_scopes: ["user", "workspace"],
      filtered_count: 1,
      filtered_reasons: ["duplicate_candidate"],
      scope_reasons: ["默认中文输出: stable preference or working habit is classified as global user memory"],
      result_state: "submitted",
      degraded: false,
      duration_ms: 20,
      created_at: "2026-04-15T12:00:00.000Z",
    });
    await repository.recordMemoryPlanRun({
      trace_id: "trace-1",
      phase: "before_response",
      plan_kind: "memory_search_plan",
      input_summary: "input=上次那个约定继续沿用",
      output_summary: "hit=true; reason=history_reference",
      prompt_version: "memory-recall-search-v1",
      schema_version: "memory-plan-schema-v1",
      degraded: false,
      result_state: "planned",
      duration_ms: 5,
      created_at: "2026-04-15T12:00:00.000Z",
    });

    expect(pool.queries.some((entry) => entry.text.includes("CREATE TABLE IF NOT EXISTS") && entry.text.includes("runtime_trigger_runs"))).toBe(true);
    expect(pool.queries.some((entry) => entry.text.includes(".runtime_turns"))).toBe(true);
    expect(pool.queries.some((entry) => entry.text.includes(".runtime_trigger_runs"))).toBe(true);
    expect(pool.queries.some((entry) => entry.text.includes(".runtime_memory_plan_runs"))).toBe(true);
    expect(pool.queries.some((entry) => entry.text.includes(".runtime_writeback_submissions"))).toBe(true);
  });

  it("propagates query timeout to the read model repository and aborts the database client", async () => {
    const pool = new FakePool([], async (text) => {
      if (text.includes("SELECT")) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    });
    const repository = new PostgresReadModelRepository(config, pool as never);
    const dependencyRepository = new InMemoryRuntimeRepository();
    const guard = new DependencyGuard(dependencyRepository, pino({ enabled: false }));
    const queryEngine = new QueryEngine(
      config,
      repository,
      { embedText: async () => [1, 0, 0] },
      guard,
      pino({ enabled: false }),
    );

    const result = await queryEngine.query(
      {
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
        phase: "before_response",
        current_input: "之前的偏好还继续保留",
        memory_mode: "workspace_plus_global",
      },
      {
        hit: true,
        trigger_type: "history_reference",
        trigger_reason: "current input explicitly references prior context or preferences",
        requested_memory_types: ["fact_preference"],
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "task", "user"],
        scope_reason: "before_response can use workspace, task, session, and global user memory",
        importance_threshold: 3,
        cooldown_applied: false,
      },
    );

    expect(result.degraded).toBe(true);
    expect(result.degradation_reason).toBe("dependency_timeout");
    expect(pool.clients[0]?.destroyed).toBe(true);
  });

  it("casts uuid filters in the postgres read model query", async () => {
    const pool = new FakePool([
      {
        ...baseCandidateRecord,
        last_confirmed_at: "2026-04-15T10:00:00.000Z",
      },
    ]);
    const repository = new PostgresReadModelRepository(config, pool as never);

    await repository.searchCandidates({
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      memory_mode: "workspace_plus_global",
      scope_filter: ["workspace", "user", "task", "session"],
      memory_type_filter: ["fact_preference"],
      status_filter: ["active"],
      importance_threshold: 3,
      semantic_query_text: "之前那个偏好",
      candidate_limit: 10,
    });

    const selectQuery = pool.clients[0]?.queries.find((entry) => entry.text.includes("FROM"));
    expect(selectQuery?.text).toContain("workspace_id = $5::uuid");
    expect(selectQuery?.text).toContain("user_id = $6::uuid");
    expect(selectQuery?.text).toContain("$7::uuid IS NOT NULL AND task_id = $7::uuid");
    expect(selectQuery?.text).toContain("session_id = $8::uuid");
  });

  it("records trigger stage separately and exposes real writeback filtering in observability", async () => {
    const repository = new InMemoryRuntimeRepository();

    await repository.recordTurn({
      trace_id: "trace-2",
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "之前那个约束继续保留",
      created_at: "2026-04-15T12:00:00.000Z",
    });
    await repository.recordTriggerRun({
      trace_id: "trace-2",
      phase: "before_response",
      trigger_hit: true,
      trigger_type: "history_reference",
      trigger_reason: "current input explicitly references prior context or preferences",
      requested_memory_types: ["fact_preference"],
      memory_mode: "workspace_plus_global",
      requested_scopes: ["workspace", "user"],
      scope_reason: "session_start restores workspace memory plus global user memory",
      importance_threshold: 3,
      cooldown_applied: false,
      duration_ms: 6,
      created_at: "2026-04-15T12:00:00.000Z",
    });
    await repository.recordRecallRun({
      trace_id: "trace-2",
      phase: "before_response",
      trigger_hit: true,
      trigger_type: "history_reference",
      trigger_reason: "current input explicitly references prior context or preferences",
      memory_mode: "workspace_plus_global",
      requested_scopes: ["workspace", "user"],
      matched_scopes: [],
      scope_hit_counts: {},
      scope_reason: "session_start restores workspace memory plus global user memory",
      query_scope: "scope=user",
      requested_memory_types: ["fact_preference"],
      candidate_count: 0,
      selected_count: 0,
      result_state: "empty",
      degraded: false,
      duration_ms: 12,
      created_at: "2026-04-15T12:00:00.000Z",
    });
    await repository.recordWritebackSubmission({
      trace_id: "trace-2",
      phase: "after_response",
      candidate_count: 1,
      submitted_count: 0,
      memory_mode: "workspace_plus_global",
      final_scopes: ["workspace"],
      filtered_count: 2,
      filtered_reasons: ["duplicate_candidate", "candidate_limit_exceeded"],
      scope_reasons: ["仓库规则: repository or project-specific constraint is classified as workspace memory"],
      result_state: "failed",
      degraded: true,
      degradation_reason: "dependency_unavailable",
      duration_ms: 9,
      created_at: "2026-04-15T12:00:00.000Z",
    });
    await repository.recordMemoryPlanRun({
      trace_id: "trace-2",
      phase: "before_response",
      plan_kind: "memory_search_plan",
      input_summary: "input=之前那个约束继续保留",
      output_summary: "hit=true; reason=history_reference",
      prompt_version: "memory-recall-search-v1",
      schema_version: "memory-plan-schema-v1",
      degraded: false,
      result_state: "planned",
      duration_ms: 6,
      created_at: "2026-04-15T12:00:00.000Z",
    });

    const runs = await repository.getRuns({ trace_id: "trace-2" });

    expect(runs.trigger_runs).toHaveLength(1);
    expect(runs.total).toBe(1);
    expect(runs.recall_runs[0]?.result_state).toBe("empty");
    expect(runs.memory_plan_runs[0]?.plan_kind).toBe("memory_search_plan");
    expect(runs.trigger_runs[0]?.requested_scopes).toContain("workspace");
    expect(runs.writeback_submissions[0]?.filtered_count).toBe(2);
    expect(runs.writeback_submissions[0]?.filtered_reasons).toContain("duplicate_candidate");
  });

  it("emits writeback candidates that pass the storage runtime batch contract", async () => {
    const guard = new DependencyGuard(new InMemoryRuntimeRepository(), pino({ enabled: false }));
    const engine = new WritebackEngine(
      config,
      {
        submitCandidates: async () => [],
        listRecords: async () => ({ items: [], total: 0, page: 1, page_size: 20 }),
        patchRecord: async () => { throw new Error("not implemented"); },
        archiveRecord: async () => { throw new Error("not implemented"); },
        listConflicts: async () => [],
        resolveConflict: async () => { throw new Error("not implemented"); },
        submitGovernanceExecutions: async () => [],
      },
      guard,
    );

    const extracted = await engine.extractCandidates({
      host: "codex_app_server",
      workspace_id: "550e8400-e29b-41d4-a716-446655440000",
      user_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "550e8400-e29b-41d4-a716-446655440002",
      task_id: "550e8400-e29b-41d4-a716-446655440003",
      turn_id: "turn-1",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。下一步: 完成接口测试。我会在每次发布前补齐桥接脚本并验证。",
      tool_results_summary: "tool summary: runtime observed a stable external event",
    });

    const parsed = localWriteBackBatchRequestSchema.safeParse({
      candidates: extracted.candidates,
    });

    expect(parsed.success).toBe(true);
    expect(extracted.candidates.every((candidate) => ["fact_preference", "task_state", "episodic"].includes(candidate.candidate_type))).toBe(true);
  });

  it("renders runtime migration sql with schema placeholders replaced", async () => {
    const template = await readFile(
      path.resolve("C:/workspace/work/agent-memory/services/retrieval-runtime/migrations/0001_runtime_init.sql"),
      "utf8",
    );

    const rendered = renderMigrationTemplate(template, { RUNTIME_SCHEMA: "runtime_private" });

    expect(rendered).toContain('"runtime_private".runtime_turns');
    expect(rendered).not.toContain("__RUNTIME_SCHEMA_IDENT__");
  });

  it("supports observe runs pagination in memory repository", async () => {
    const repository = new InMemoryRuntimeRepository();

    for (let index = 0; index < 6; index += 1) {
      await repository.recordTurn({
        trace_id: `trace-${index}`,
        host: "claude_code_plugin",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        phase: "before_response",
        current_input: `prompt-${index}`,
        created_at: `2026-04-15T12:00:0${index}.000Z`,
      });
    }

    const pageOne = await repository.getRuns({ page: 1, page_size: 5 });
    const pageTwo = await repository.getRuns({ page: 2, page_size: 5 });

    expect(pageOne.total).toBe(6);
    expect(pageOne.page).toBe(1);
    expect(pageOne.page_size).toBe(5);
    expect(pageOne.turns).toHaveLength(5);
    expect(pageTwo.turns).toHaveLength(1);
  });

  it("truncates semantic query text from the tail and keeps total length bounded", () => {
    const query = buildRetrievalQuery(
      {
        host: "claude_code_plugin",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        phase: "before_response",
        task_id: ids.task,
        current_input: `前缀 ${"A".repeat(800)} 结尾意图`,
        recent_context_summary: `旧上下文 ${"B".repeat(1200)} 最新摘要`,
        memory_mode: "workspace_plus_global",
      },
      {
        hit: true,
        trigger_type: "history_reference",
        trigger_reason: "当前输入明确引用了历史上下文或既有偏好。",
        requested_memory_types: ["fact_preference", "task_state"],
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "task", "session", "user"],
        scope_reason: "回应前可综合使用工作区、任务、会话和全局用户记忆。",
        importance_threshold: 3,
        cooldown_applied: false,
      },
      config,
    );

    expect(query.semantic_query_text.length).toBeLessThanOrEqual(1024);
    expect(query.semantic_query_text).toContain("结尾意图");
    expect(query.semantic_query_text).toContain("最新摘要");
  });

  it("degrades semantic fallback explicitly when trigger-stage dependencies fail", async () => {
    const repository = new InMemoryRuntimeRepository();
    const guard = new DependencyGuard(repository, pino({ enabled: false }));
    const triggerEngine = new TriggerEngine(
      config,
      {
        embedText: async () => {
          throw new Error("embeddings unavailable");
        },
      },
      new InMemoryReadModelRepository(candidateRecords),
      guard,
      pino({ enabled: false }),
    );

    const decision = await triggerEngine.decide({
      host: "claude_code_plugin",
      workspace_id: "550e8400-e29b-41d4-a716-446655440000",
      user_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "550e8400-e29b-41d4-a716-446655440002",
      phase: "before_response",
      current_input: "继续刚才那个方案",
      memory_mode: "workspace_plus_global",
    });

    expect(decision.hit).toBe(false);
    expect(decision.degraded).toBe(true);
    expect(decision.degradation_reason).toBe("dependency_unavailable");
  });

  it("estimates more tokens for chinese text than for equivalent latin text", () => {
    expect(estimateTokens("默认中文输出默认中文输出")).toBeGreaterThan(estimateTokens("default output default output"));
    expect(estimateTokens("  ")).toBe(0);
  });

  it("keeps semantic fallback model-aware by using a sample-distribution threshold", async () => {
    const repository = new InMemoryRuntimeRepository();
    const guard = new DependencyGuard(repository, pino({ enabled: false }));
    const triggerEngine = new TriggerEngine(
      config,
      new StubEmbeddingsClient([1, 0, 0]),
      new InMemoryReadModelRepository([
        {
          ...baseCandidateRecord,
          id: "semantic-low-1",
          summary: "和当前输入弱相关的样本一",
          summary_embedding: [0.69, 0.72, 0],
        },
        {
          ...baseCandidateRecord,
          id: "semantic-low-2",
          summary: "和当前输入弱相关的样本二",
          summary_embedding: [0.52, 0.85, 0],
        },
      ]),
      guard,
      pino({ enabled: false }),
    );

    const decision = await triggerEngine.decide({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "继续沿用这套输出格式和说明方式",
      memory_mode: "workspace_plus_global",
    });

    expect(decision.hit).toBe(true);
    expect(decision.trigger_type).toBe("semantic_fallback");
    expect((decision.semantic_score ?? 0)).toBeLessThan(config.SEMANTIC_TRIGGER_THRESHOLD);
  });

  it("avoids extracting polite assistant promises as commitments in rules mode", async () => {
    const guard = new DependencyGuard(new InMemoryRuntimeRepository(), pino({ enabled: false }));
    const engine = new WritebackEngine(
      config,
      {
        submitCandidates: async () => [],
        listRecords: async () => ({ items: [], total: 0, page: 1, page_size: 20 }),
        patchRecord: async () => { throw new Error("not implemented"); },
        archiveRecord: async () => { throw new Error("not implemented"); },
        listConflicts: async () => [],
        resolveConflict: async () => { throw new Error("not implemented"); },
        submitGovernanceExecutions: async () => [],
      },
      guard,
    );

    const extracted = await engine.extractCandidates({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "继续处理这个问题",
      assistant_output: "好的，我会帮你继续看这个问题。",
      tool_results_summary: "ok",
    });

    expect(extracted.candidates.some((candidate) => candidate.candidate_type === "episodic")).toBe(false);
  });

  it("keeps rerank ordering inside the same memory type during injection trimming", () => {
    const engine = new InjectionEngine({
      ...config,
      INJECTION_RECORD_LIMIT: 1,
      INJECTION_TOKEN_BUDGET: 128,
    });

    const block = engine.build({
      packet_id: "packet-1",
      trigger: "history_reference",
      memory_mode: "workspace_plus_global",
      requested_scopes: ["workspace"],
      selected_scopes: ["workspace"],
      scope_reason: "test",
      query_scope: "scope=workspace",
      packet_summary: "测试摘要",
      injection_hint: "测试提示",
      ttl_ms: 1000,
      priority_breakdown: {
        fact_preference: 2,
        task_state: 0,
        episodic: 0,
      },
      records: [
        {
          ...baseCandidateRecord,
          id: "low-rerank",
          scope: "workspace",
          rerank_score: 0.45,
          importance: 5,
        },
        {
          ...baseCandidateRecord,
          id: "high-rerank",
          scope: "workspace",
          rerank_score: 0.92,
          importance: 3,
        },
      ],
    });

    expect(block?.memory_records).toHaveLength(1);
    expect(block?.memory_records[0]?.id).toBe("high-rerank");
  });

  it("persists finalize idempotency responses at request scope", async () => {
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const dependencyGuard = new DependencyGuard(repository, logger);
    const readModelRepository = new InMemoryReadModelRepository(candidateRecords);
    const storageClient = new StubStorageClient();
    const llmExtractor = new CountingLlmExtractor();
    const embeddingsClient = new StubEmbeddingsClient();
    const memoryOrchestrator = createMemoryOrchestrator({
      config,
      writebackPlanner: llmExtractor as never,
    });

    const firstService = new RetrievalRuntimeService(
      new TriggerEngine(
        config,
        embeddingsClient,
        readModelRepository,
        dependencyGuard,
        logger,
        memoryOrchestrator?.recall?.search,
      ),
      new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
      embeddingsClient,
      new InjectionEngine(config),
      new WritebackEngine(config, storageClient, dependencyGuard, memoryOrchestrator?.writeback),
      repository,
      dependencyGuard,
      logger,
      new FinalizeIdempotencyCache(config),
      config.EMBEDDING_TIMEOUT_MS,
      memoryOrchestrator,
    );

    const request = {
      host: "codex_app_server" as const,
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      turn_id: "persisted-finalize-key",
      current_input: "后续默认中文输出",
      assistant_output: "收到，我会统一改成中文输出。",
    };

    const first = await firstService.finalizeTurn(request);

    const secondService = new RetrievalRuntimeService(
      new TriggerEngine(
        config,
        embeddingsClient,
        readModelRepository,
        dependencyGuard,
        logger,
        memoryOrchestrator?.recall?.search,
      ),
      new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
      embeddingsClient,
      new InjectionEngine(config),
      new WritebackEngine(config, storageClient, dependencyGuard, memoryOrchestrator?.writeback),
      repository,
      dependencyGuard,
      logger,
      new FinalizeIdempotencyCache(config),
      config.EMBEDDING_TIMEOUT_MS,
      memoryOrchestrator,
    );

    const second = await secondService.finalizeTurn(request);

    expect(first).toEqual(second);
    expect(llmExtractor.refineCallCount).toBe(1);
    expect(storageClient.callCount).toBe(1);
  });

  it("rejects host payloads that omit required identity fields instead of falling back to unknown namespaces", async () => {
    const bridgePath = path.resolve(
      "C:/workspace/work/agent-memory/services/retrieval-runtime",
      "host-adapters/memory-claude-plugin/bin/memory-bridge.mjs",
    );
    const proxyPath = path.resolve(
      "C:/workspace/work/agent-memory/services/retrieval-runtime",
      "host-adapters/memory-codex-adapter/bin/memory-codex-proxy.mjs",
    );
    const [bridgeContent, proxyContent] = await Promise.all([
      readFile(bridgePath, "utf8"),
      readFile(proxyPath, "utf8"),
    ]);

    expect(bridgeContent).toContain("missing required identity field");
    expect(proxyContent).toContain("missing required identity field");
    expect(bridgeContent).not.toContain("unknown-workspace");
    expect(bridgeContent).not.toContain("unknown-user");
    expect(bridgeContent).not.toContain("unknown-session");
    expect(proxyContent).not.toContain("unknown-workspace");
    expect(proxyContent).not.toContain("unknown-user");
    expect(proxyContent).not.toContain("unknown-session");
  });

  it("does not ship zero-uuid fallback identities in the Codex MCP bridge", async () => {
    const mcpPath = path.resolve(
      "C:/workspace/work/agent-memory/services/retrieval-runtime",
      "host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs",
    );
    const content = await readFile(mcpPath, "utf8");

    expect(content).toContain("missing required identity field");
    expect(content).not.toContain("00000000-0000-0000-0000-000000000000");
  });

  it("does not pretend finalize-turn forwarding succeeded in the Codex proxy", async () => {
    const proxyPath = path.resolve(
      "C:/workspace/work/agent-memory/services/retrieval-runtime",
      "host-adapters/memory-codex-adapter/bin/memory-codex-proxy.mjs",
    );
    const content = await readFile(proxyPath, "utf8");

    expect(content).toContain("finalize-turn failed with");
    expect(content).toContain("forwarded: false");
    expect(content).not.toContain('JSON.stringify({ forwarded: true })');
  });

  it("resolves Claude bridge identity fields from environment variables", async () => {
    const moduleUrl = pathToFileURL(
      path.resolve(
        "C:/workspace/work/agent-memory/services/retrieval-runtime/host-adapters/memory-claude-plugin/bin/memory-bridge.mjs",
      ),
    ).href;
    const bridge = (await import(moduleUrl)) as {
      resolveField: (event: Record<string, unknown>, keys: string[], envKey: string, label: string) => string;
    };
    process.env.MEMORY_USER_ID = ids.user;

    try {
      const value = bridge.resolveField({}, ["user_id"], "MEMORY_USER_ID", "user_id");
      expect(value).toBe(ids.user);
    } finally {
      delete process.env.MEMORY_USER_ID;
    }
  });

  it("returns structured search results and hit explanations from Codex MCP tools", async () => {
    const originalFetch = globalThis.fetch;
    const moduleUrl = pathToFileURL(
      path.resolve(
        "C:/workspace/work/agent-memory/services/retrieval-runtime/host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs",
      ),
    ).href;
    const mcp = (await import(moduleUrl)) as {
      createTools: (baseUrl?: string) => Record<string, { run: (input: Record<string, unknown>) => Promise<unknown> }>;
    };

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("/v1/runtime/prepare-context")) {
        return {
          ok: true,
          json: async () => ({
            trigger: true,
            trigger_reason: "history_reference",
            memory_packet: { records: [] },
            injection_block: { memory_summary: "summary" },
            degraded: false,
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          trigger_runs: [{ trigger_hit: true, trigger_type: "history_reference", trigger_reason: "matched" }],
          recall_runs: [{ result_state: "matched", candidate_count: 3, selected_count: 2, degraded: false }],
          injection_runs: [{ injected: true, injected_count: 2, trimmed_record_ids: ["a"], result_state: "injected" }],
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const tools = mcp.createTools("http://127.0.0.1:3002");
      const memorySearch = tools.memory_search;
      const memoryExplainHit = tools.memory_explain_hit;

      expect(memorySearch).toBeTruthy();
      expect(memoryExplainHit).toBeTruthy();

      const searchResult = await memorySearch!.run({ query: "之前那个偏好", workspace_id: ids.workspace, user_id: ids.user, session_id: ids.session });
      const explainResult = await memoryExplainHit!.run({ trace_id: "trace-1" });

      expect(searchResult).toMatchObject({ trigger: true, degraded: false });
      expect(explainResult).toMatchObject({
        trace_id: "trace-1",
        trigger: { hit: true, type: "history_reference" },
        recall: { state: "matched", candidate_count: 3 },
        injection: { injected: true, trimmed: 1 },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses llm extraction responses from the configured writeback endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const extractor = new HttpLlmExtractor({
      ...config,
      MEMORY_LLM_BASE_URL: "http://localhost:8080",
      MEMORY_LLM_API_KEY: "test-key",
    } as AppConfig);

    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                candidates: [
                  {
                    candidate_type: "fact_preference",
                    scope: "user",
                    summary: "默认中文输出",
                    importance: 5,
                    confidence: 0.9,
                    write_reason: "stable preference",
                  },
                ],
              }),
            },
          ],
        }),
      }) as Response) as typeof fetch;

    try {
      const result = await extractor.extract({
        current_input: "我偏好中文",
        assistant_output: "已确认后续都用中文",
      });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.summary).toBe("默认中文输出");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses openai-compatible writeback extraction responses", async () => {
    const originalFetch = globalThis.fetch;
    const extractor = new HttpLlmExtractor({
      ...config,
      MEMORY_LLM_BASE_URL: "http://localhost:8080",
      MEMORY_LLM_PROTOCOL: "openai-compatible",
      MEMORY_LLM_API_KEY: "test-key",
    } as AppConfig);

    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidates: [
                    {
                      candidate_type: "task_state",
                      scope: "task",
                      summary: "下一步先补测试",
                      importance: 4,
                      confidence: 0.88,
                      write_reason: "confirmed next step",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    try {
      const result = await extractor.extract({
        current_input: "下一步先补测试",
        assistant_output: "好的，先补测试。",
      });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.summary).toBe("下一步先补测试");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("passes AbortSignal through the in-memory repository for bounded test execution", async () => {
    const repository = new InMemoryReadModelRepository(candidateRecords);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      repository.searchCandidates(
        {
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          phase: "before_response",
          task_id: ids.task,
          memory_mode: "workspace_plus_global",
          scope_filter: ["user"],
          memory_type_filter: ["fact_preference"],
          status_filter: ["active"],
          importance_threshold: 3,
          semantic_query_text: "之前那个偏好",
          candidate_limit: 10,
        },
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
  });
});

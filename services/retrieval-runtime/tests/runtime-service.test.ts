import pino from "pino";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { InjectionEngine } from "../src/injection/injection-engine.js";
import { InMemoryRuntimeRepository } from "../src/observability/in-memory-runtime-repository.js";
import type { EmbeddingsClient } from "../src/query/embeddings-client.js";
import { InMemoryReadModelRepository } from "../src/query/in-memory-read-model-repository.js";
import { QueryEngine } from "../src/query/query-engine.js";
import { RetrievalRuntimeService } from "../src/runtime-service.js";
import type { CandidateMemory, SubmittedWriteBackJob, WriteBackCandidate } from "../src/shared/types.js";
import { TriggerEngine } from "../src/trigger/trigger-engine.js";
import type { LlmExtractionResult, LlmExtractor } from "../src/writeback/llm-extractor.js";
import type { StorageWritebackClient } from "../src/writeback/storage-client.js";
import { WritebackEngine } from "../src/writeback/writeback-engine.js";

const baseConfig: AppConfig = {
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
  WRITEBACK_LLM_MODEL: "claude-haiku-4-5-20251001",
  WRITEBACK_LLM_TIMEOUT_MS: 5000,
  WRITEBACK_MAX_CANDIDATES: 3,
  QUERY_TIMEOUT_MS: 50,
  STORAGE_TIMEOUT_MS: 50,
  EMBEDDING_TIMEOUT_MS: 50,
  QUERY_CANDIDATE_LIMIT: 30,
  PACKET_RECORD_LIMIT: 10,
  INJECTION_RECORD_LIMIT: 2,
  INJECTION_TOKEN_BUDGET: 64,
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

const sampleRecords: CandidateMemory[] = [
  {
    id: "mem-workspace",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: null,
    task_id: null,
    memory_type: "fact_preference",
    scope: "workspace",
    summary: "工作区约束：这个仓库默认保持中文注释和简洁输出。",
    details: null,
    source: { turn_id: "t-0" },
    importance: 5,
    confidence: 0.96,
    status: "active",
    updated_at: "2026-04-15T09:00:00.000Z",
    last_confirmed_at: "2026-04-15T09:00:00.000Z",
    summary_embedding: [1, 0, 0],
  },
  {
    id: "mem-preference",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: null,
    memory_type: "fact_preference",
    scope: "user",
    summary: "用户偏好：默认用中文，回答尽量简短直接。",
    details: null,
    source: { turn_id: "t-1" },
    importance: 5,
    confidence: 0.95,
    status: "active",
    updated_at: "2026-04-15T10:00:00.000Z",
    last_confirmed_at: "2026-04-15T10:00:00.000Z",
    summary_embedding: [1, 0, 0],
  },
  {
    id: "mem-task",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: ids.task,
    memory_type: "task_state",
    scope: "task",
    summary: "当前任务状态：需要先补 `retrieval-runtime`（运行时检索服务）的接口和测试。",
    details: null,
    source: { turn_id: "t-2" },
    importance: 5,
    confidence: 0.9,
    status: "active",
    updated_at: "2026-04-15T11:00:00.000Z",
    last_confirmed_at: "2026-04-15T11:00:00.000Z",
    summary_embedding: [0.9, 0.1, 0],
  },
  {
    id: "mem-episodic",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: ids.task,
    memory_type: "episodic",
    scope: "task",
    summary: "历史事件：上一轮已经确定先做 `Fastify`（Web 框架）接口，再补写回。",
    details: null,
    source: { turn_id: "t-3" },
    importance: 4,
    confidence: 0.8,
    status: "active",
    updated_at: "2026-04-15T12:00:00.000Z",
    last_confirmed_at: "2026-04-15T12:00:00.000Z",
    summary_embedding: [0.8, 0.2, 0],
  },
];

class StubEmbeddingsClient implements EmbeddingsClient {
  constructor(private readonly vector: number[] = [1, 0, 0], private readonly shouldFail = false) {}

  async embedText(): Promise<number[]> {
    if (this.shouldFail) {
      throw new Error("embeddings unavailable");
    }
    return this.vector;
  }
}

class StubStorageClient implements StorageWritebackClient {
  constructor(private readonly jobs: SubmittedWriteBackJob[] = [], private readonly shouldFail = false) {}

  async submitCandidates(candidates: WriteBackCandidate[]): Promise<SubmittedWriteBackJob[]> {
    if (this.shouldFail) {
      throw new Error("storage unavailable");
    }

    return (
      this.jobs.length > 0
        ? this.jobs
        : candidates.map((candidate) => ({
            candidate_summary: candidate.summary,
            status: "accepted_async",
          }))
    ) as SubmittedWriteBackJob[];
  }
}

class StubLlmExtractor implements LlmExtractor {
  constructor(private readonly result: LlmExtractionResult, private readonly shouldFail = false) {}

  async extract(): Promise<LlmExtractionResult> {
    if (this.shouldFail) {
      throw new Error("writeback llm timeout");
    }
    return this.result;
  }
}

function createRuntime(overrides?: {
  records?: CandidateMemory[];
  embeddingsClient?: EmbeddingsClient;
  storageClient?: StorageWritebackClient;
  llmExtractor?: LlmExtractor;
  config?: Partial<AppConfig>;
}) {
  const repository = new InMemoryRuntimeRepository();
  const logger = pino({ enabled: false });
  const dependencyGuard = new DependencyGuard(repository, logger);
  const readModelRepository = new InMemoryReadModelRepository(overrides?.records ?? sampleRecords);
  const embeddingsClient = overrides?.embeddingsClient ?? new StubEmbeddingsClient();
  const storageClient = overrides?.storageClient ?? new StubStorageClient();
  const config = { ...baseConfig, ...overrides?.config };

  const service = new RetrievalRuntimeService(
    new TriggerEngine(config, embeddingsClient, readModelRepository, dependencyGuard, logger),
    new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
    new InjectionEngine(config),
    new WritebackEngine(config, storageClient, dependencyGuard, overrides?.llmExtractor),
    repository,
    dependencyGuard,
    logger,
  );

  return { service, repository };
}

describe("retrieval-runtime service", () => {
  it("returns an injection block when history reference trigger hits", async () => {
    const { service } = createRuntime();

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      thread_id: "thread-1",
      turn_id: "turn-1",
      phase: "before_response",
      current_input: "上次定过的接口结构这轮继续沿用。",
    });

    expect(response.trigger).toBe(true);
    expect(response.injection_block).not.toBeNull();
    expect(response.injection_block?.memory_records.length).toBeGreaterThan(0);
    expect(response.memory_packet?.records.length).toBeGreaterThan(0);
    expect(response.injection_block?.memory_mode).toBe("workspace_plus_global");
    expect(response.injection_block?.requested_scopes).toContain("workspace");
    expect(response.injection_block?.memory_summary).toContain("偏好与约束");
    expect(response.memory_packet?.injection_hint).toContain("优先");
  });

  it("returns no injection when trigger is not hit", async () => {
    const { service } = createRuntime({
      embeddingsClient: new StubEmbeddingsClient([0, 0, 1]),
    });

    const response = await service.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "嗯",
    });

    expect(response.trigger).toBe(false);
    expect(response.injection_block).toBeNull();
    expect(response.memory_packet).toBeNull();
  });

  it("degrades query when embeddings dependency fails", async () => {
    const { service } = createRuntime({
      embeddingsClient: new StubEmbeddingsClient([1, 0, 0], true),
    });

    const response = await service.prepareContext({
      host: "custom_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "task_start",
      current_input: "开始这个任务",
    });

    expect(response.trigger).toBe(true);
    expect(response.degraded).toBe(true);
    expect(response.dependency_status.embeddings.status).not.toBe("healthy");
  });

  it("trims injection records when budget is exceeded", async () => {
    const { service } = createRuntime();

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "task_start",
      current_input: "任务继续",
    });

    expect(response.injection_block).not.toBeNull();
    expect(response.injection_block?.trimmed_record_ids.length).toBeGreaterThan(0);
    expect(response.injection_block?.memory_records.length).toBeLessThanOrEqual(baseConfig.INJECTION_RECORD_LIMIT);
    expect(response.injection_block?.selected_scopes.length).toBeGreaterThan(0);
  });

  it("filters low-value writeback content and submits structured candidates", async () => {
    const { service } = createRuntime();

    const response = await service.finalizeTurn({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-2",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。下一步: 完成接口测试。我会把写回链路补齐。",
      tool_results_summary: "tool summary: storage connection failed once and then recovered",
    });

    expect(response.candidate_count).toBeGreaterThan(0);
    expect(response.writeback_submitted).toBe(true);
    expect(response.submitted_jobs.every((job) => job.status === "accepted_async")).toBe(true);
    expect(
      response.write_back_candidates.every((candidate) =>
        ["fact_preference", "task_state", "episodic"].includes(candidate.candidate_type),
      ),
    ).toBe(true);
    expect(response.write_back_candidates.every((candidate) => candidate.source.service_name === "retrieval-runtime")).toBe(true);
    expect(response.memory_mode).toBe("workspace_plus_global");
  });

  it("uses configured llm extraction before falling back to rules", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            summary: "默认用中文输出",
            importance: 5,
            confidence: 0.92,
            write_reason: "user preference confirmed in this turn",
          },
        ],
      }),
    });

    const response = await service.finalizeTurn({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "后续都用中文",
      assistant_output: "收到，我会统一改成中文输出。",
    });

    expect(response.write_back_candidates).toHaveLength(1);
    expect(response.write_back_candidates[0]?.source.source_type).toBe("writeback_llm");
    expect(response.write_back_candidates[0]?.summary).toBe("默认用中文输出");
    expect(response.write_back_candidates[0]?.scope).toBe("user");
  });

  it("falls back to rules when llm extraction fails", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({ candidates: [] }, true),
    });

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。下一步: 继续补测试。",
    });

    expect(response.write_back_candidates.length).toBeGreaterThan(0);
    expect(response.write_back_candidates.some((candidate) => candidate.source.source_type !== "writeback_llm")).toBe(true);
  });

  it("applies writeback max candidates to llm extraction output", async () => {
    const { service } = createRuntime({
      config: { WRITEBACK_MAX_CANDIDATES: 2 },
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            summary: "默认使用中文输出",
            importance: 5,
            confidence: 0.95,
            write_reason: "reason one",
          },
          {
            candidate_type: "task_state",
            scope: "task",
            summary: "继续补齐运行时分页接口",
            importance: 4,
            confidence: 0.86,
            write_reason: "reason two",
          },
          {
            candidate_type: "episodic",
            scope: "session",
            summary: "上一轮已经确认桥接脚本可用",
            importance: 4,
            confidence: 0.81,
            write_reason: "reason three",
          },
        ],
      }),
    });

    const response = await service.finalizeTurn({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      current_input: "继续",
      assistant_output: "好的",
    });

    expect(response.write_back_candidates).toHaveLength(2);
    expect(response.filtered_reasons).toContain("candidate_limit_exceeded");
  });

  it("returns degraded writeback result when storage dependency is unavailable", async () => {
    const { service } = createRuntime({
      storageClient: new StubStorageClient([], true),
    });

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    });

    expect(response.degraded).toBe(true);
    expect(response.submitted_jobs[0]?.status).toBe("dependency_unavailable");
  });

  it("does not read global user memory in workspace_only mode", async () => {
    const { service } = createRuntime();

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "上次那个仓库约束继续沿用。",
      memory_mode: "workspace_only",
    });

    expect(response.injection_block).not.toBeNull();
    expect(response.memory_packet?.requested_scopes).not.toContain("user");
    expect(response.injection_block?.requested_scopes).not.toContain("user");
    expect(response.injection_block?.memory_records.some((record) => record.scope === "user")).toBe(false);
    expect(response.injection_block?.memory_records.some((record) => record.scope === "workspace")).toBe(true);
  });

  it("reads workspace and global user memory in workspace_plus_global mode", async () => {
    const { service } = createRuntime();

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "上次那个约定继续。",
      memory_mode: "workspace_plus_global",
    });

    expect(response.memory_packet?.requested_scopes).toContain("workspace");
    expect(response.memory_packet?.requested_scopes).toContain("user");
    expect(response.memory_packet?.selected_scopes).toContain("workspace");
    expect(response.memory_packet?.selected_scopes).toContain("user");
  });

  it("keeps user scope visible across workspaces while isolating workspace scope", async () => {
    const anotherWorkspace = "550e8400-e29b-41d4-a716-446655440099";
    const { service } = createRuntime({
      records: [
        ...sampleRecords,
        {
          id: "mem-other-workspace",
          workspace_id: anotherWorkspace,
          user_id: ids.user,
          session_id: null,
          task_id: null,
          memory_type: "fact_preference",
          scope: "workspace",
          summary: "另一个工作区约束：不要带进当前仓库。",
          details: null,
          source: null,
          importance: 5,
          confidence: 0.9,
          status: "active",
          updated_at: "2026-04-15T08:00:00.000Z",
          last_confirmed_at: null,
          summary_embedding: [1, 0, 0],
        },
        {
          id: "mem-global-origin-other-workspace",
          workspace_id: anotherWorkspace,
          user_id: ids.user,
          session_id: null,
          task_id: null,
          memory_type: "fact_preference",
          scope: "user",
          summary: "全局偏好：始终用中文回答。",
          details: null,
          source: null,
          importance: 5,
          confidence: 0.95,
          status: "active",
          updated_at: "2026-04-15T07:00:00.000Z",
          last_confirmed_at: null,
          summary_embedding: [1, 0, 0],
        },
      ],
    });

    const response = await service.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "session_start",
      current_input: "恢复上下文",
      memory_mode: "workspace_plus_global",
    });

    expect(response.memory_packet?.records.some((record) => record.id === "mem-other-workspace")).toBe(false);
    expect(response.memory_packet?.records.some((record) => record.id === "mem-global-origin-other-workspace")).toBe(true);
  });

  it("records mode and scope explanations in runtime observability", async () => {
    const { service, repository } = createRuntime();

    const prepared = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "上次那个仓库约束继续沿用。",
      memory_mode: "workspace_only",
    });

    const runs = await repository.getRuns({ trace_id: prepared.trace_id });
    expect(runs.trigger_runs[0]?.memory_mode).toBe("workspace_only");
    expect(runs.trigger_runs[0]?.requested_scopes).toContain("workspace");
    expect(runs.recall_runs[0]?.matched_scopes).toContain("workspace");
    expect(runs.injection_runs[0]?.selected_scopes).toContain("workspace");
  });

  it("reuses the same trace for prepare and finalize phases and keeps phase records split", async () => {
    const { service, repository } = createRuntime();

    const preparedTaskStart = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-shared-trace",
      phase: "task_start",
      current_input: "开始当前任务。",
      memory_mode: "workspace_plus_global",
    });

    const prepared = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-shared-trace",
      phase: "before_response",
      current_input: "上次那个仓库约束继续沿用。",
      memory_mode: "workspace_plus_global",
    });

    expect(preparedTaskStart.trace_id).toBe(prepared.trace_id);

    const finalized = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-shared-trace",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。下一步: 继续补测试。",
      memory_mode: "workspace_plus_global",
    });

    expect(finalized.trace_id).toBe(prepared.trace_id);

    const runs = await repository.getRuns({ trace_id: prepared.trace_id });
    expect(runs.turns).toHaveLength(3);
    expect(runs.turns.map((run) => run.phase)).toEqual(["after_response", "before_response", "task_start"]);
    expect(runs.trigger_runs).toHaveLength(2);
    expect(runs.recall_runs).toHaveLength(2);
    expect(runs.injection_runs).toHaveLength(2);
    expect(runs.writeback_submissions).toHaveLength(1);
    expect(runs.writeback_submissions[0]?.phase).toBe("after_response");
  });

  it("does not mark writeback as submitted when storage dependency is unavailable", async () => {
    const { service } = createRuntime({
      storageClient: new StubStorageClient([], true),
    });

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    });

    expect(response.degraded).toBe(true);
    expect(response.writeback_submitted).toBe(false);
  });

  it("classifies stable preferences as user scope and project rules as workspace scope", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "workspace",
            summary: "默认使用中文输出",
            importance: 5,
            confidence: 0.95,
            write_reason: "stable user preference",
          },
          {
            candidate_type: "fact_preference",
            scope: "workspace",
            summary: "仓库规则：提交前必须跑接口测试",
            importance: 5,
            confidence: 0.92,
            write_reason: "repository constraint",
          },
        ],
      }),
    });

    const response = await service.finalizeTurn({
      host: "custom_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "继续",
      assistant_output: "好的",
    });

    expect(response.write_back_candidates.map((candidate) => candidate.scope)).toEqual(["user", "workspace"]);
  });

  it("serves public HTTP endpoints with stable response shapes", async () => {
    const { service } = createRuntime();
    const app = createApp(service);

    const prepareResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        host: "claude_code_plugin",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        turn_id: "http-turn-1",
        phase: "before_response",
        current_input: "上次定过的接口结构这轮继续沿用。",
      },
    });

    const finalizeResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/finalize-turn",
      payload: {
        host: "codex_app_server",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        turn_id: "http-turn-2",
        current_input: "我偏好: 默认中文输出",
        assistant_output: "已确认: 后续都用中文。",
      },
    });

    const livenessResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime/health/liveness",
    });
    const readinessResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime/health/readiness",
    });
    const dependenciesResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime/health/dependencies",
    });

    expect(prepareResponse.statusCode).toBe(200);
    expect(finalizeResponse.statusCode).toBe(200);
    expect(livenessResponse.json()).toEqual({ status: "alive" });
    expect(readinessResponse.json()).toEqual({ status: "ready" });
    expect(dependenciesResponse.json()).toHaveProperty("read_model");
    expect(prepareResponse.json().injection_block.memory_summary).toBeTruthy();
    expect(finalizeResponse.json().write_back_candidates.length).toBeGreaterThan(0);
  });

  it("returns structured injection data from session start context", async () => {
    const { service } = createRuntime();

    const response = await service.sessionStartContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "session_start",
      current_input: "恢复当前会话",
      turn_id: "session-start-turn",
      memory_mode: "workspace_plus_global",
    });

    expect(response.injection_block).not.toBeNull();
    expect(response.additional_context).toContain("恢复");
    expect(response.injection_block?.memory_summary).toContain("偏好与约束");
  });

  it("returns validation errors for missing host identity boundaries instead of accepting fake namespaces", async () => {
    const { service } = createRuntime();
    const app = createApp(service);

    const response = await app.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        host: "claude_code_plugin",
        session_id: ids.session,
        phase: "before_response",
        current_input: "上次那个约定继续沿用。",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("accepts memory_native_agent across prepare and finalize runtime endpoints", async () => {
    const { service } = createRuntime();
    const app = createApp(service);

    const prepareResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        host: "memory_native_agent",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        turn_id: "mna-turn-1",
        phase: "before_response",
        current_input: "延续上次已经确认的约束。",
      },
    });

    const finalizeResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/finalize-turn",
      payload: {
        host: "memory_native_agent",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        turn_id: "mna-turn-1",
        current_input: "我偏好默认中文输出",
        assistant_output: "收到，后续都会保持中文输出。",
      },
    });

    const sessionStartResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/session-start-context",
      payload: {
        host: "memory_native_agent",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        recent_context_summary: "恢复当前工作区的上下文。",
      },
    });

    expect(prepareResponse.statusCode).toBe(200);
    expect(prepareResponse.json().trigger).toBe(true);
    expect(finalizeResponse.statusCode).toBe(200);
    expect(finalizeResponse.json().candidate_count).toBeGreaterThanOrEqual(0);
    expect(sessionStartResponse.statusCode).toBe(200);
    expect(sessionStartResponse.json().memory_mode).toBe("workspace_plus_global");
  });
});

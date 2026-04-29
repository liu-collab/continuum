import { describe, expect, it, vi } from "vitest";

import type { AgentConfig } from "../../config/index.js";
import type {
  FinalizeTurnResult,
  PrepareContextResult,
  SessionStartResult,
  WriteProjectionStatusResult,
} from "../../memory-client/index.js";
import type { MaterializedSkillContext } from "../../skills/index.js";
import { AgentRunner } from "../agent-runner.js";

function createIo() {
  return {
    emitAssistantDelta: vi.fn(),
    emitToolCallStart: vi.fn(),
    emitToolCallResult: vi.fn(),
    emitInjectionBanner: vi.fn(),
    emitPhaseResult: vi.fn(),
    emitTaskChange: vi.fn(),
    emitPlan: vi.fn(),
    emitEvaluation: vi.fn(),
    emitTrace: vi.fn(),
    emitTurnEnd: vi.fn(),
    emitError: vi.fn(),
    recordPrepareContextLatency: vi.fn(),
    recordProviderCall: vi.fn(),
    recordProviderFirstTokenLatency: vi.fn(),
    requestPlanConfirm: vi.fn(async () => ({ outcome: "approve" as const })),
    recordRetry: vi.fn(),
    recordContextDrop: vi.fn(),
    recordToolBatch: vi.fn(),
    recordPlanConfirmation: vi.fn(),
    requestConfirm: vi.fn(async () => "allow" as const),
  };
}

function createMemoryClient() {
  const sessionStartContext = vi.fn(async (): Promise<SessionStartResult> => ({
    trace_id: "trace-session",
    additional_context: "",
    active_task_summary: null,
    injection_block: null,
    memory_mode: "workspace_plus_global" as const,
    dependency_status: {
      read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
      memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
    },
    degraded: false,
  }));
  const prepareContext = vi.fn(async ({ phase }: { phase: string }): Promise<PrepareContextResult> => ({
    trace_id: `trace-${phase}`,
    trigger: phase === "before_response",
    trigger_reason: phase,
    memory_packet: null,
    injection_block: phase === "before_response"
      ? {
          injection_reason: "history reference",
          memory_summary: "remembered",
          memory_records: [],
          token_estimate: 0,
          memory_mode: "workspace_plus_global" as const,
          requested_scopes: ["workspace"],
          selected_scopes: ["workspace"],
          trimmed_record_ids: [],
          trim_reasons: [],
        }
      : null,
    degraded: false,
    dependency_status: {
      read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
      memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
    },
    budget_used: 0,
    memory_packet_ids: [],
  }));
  const finalizeTurn = vi.fn(async (): Promise<FinalizeTurnResult> => ({
    trace_id: "trace-finalize",
    write_back_candidates: [],
    submitted_jobs: [],
    memory_mode: "workspace_plus_global" as const,
    candidate_count: 0,
    filtered_count: 0,
    filtered_reasons: [],
    writeback_submitted: false,
    degraded: false,
    dependency_status: {
      read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
      memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
    },
  }));
  const getWriteProjectionStatuses = vi.fn(async (): Promise<WriteProjectionStatusResult> => ({
    items: [],
  }));

  return {
    sessionStartContext,
    prepareContext,
    finalizeTurn,
    getWriteProjectionStatuses,
  };
}

function createConfig(): AgentConfig {
  return {
    runtime: {
      baseUrl: "http://127.0.0.1:3002",
      requestTimeoutMs: 800,
      finalizeTimeoutMs: 1500,
    },
    provider: {
      kind: "ollama",
      model: "qwen2.5-coder",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2,
    },
    memory: {
      mode: "workspace_plus_global" as const,
      userId: "550e8400-e29b-41d4-a716-446655440001",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      cwd: "C:/workspace",
      injectionTokenBudget: 1_500,
    },
    mcp: { servers: [] },
    tools: {
      maxOutputChars: 8_192,
      approvalMode: "confirm",
      shellExec: {
        enabled: true,
        timeoutMs: 30_000,
        denyPatterns: [],
      },
    },
    cli: {
      systemPrompt: null,
    },
    context: {
      maxTokens: null,
      reserveTokens: 4_096,
      compactionStrategy: "truncate",
    },
    planning: {
      planMode: "advisory",
    },
    logging: {
      level: "info",
      format: "json",
    },
    streaming: {
      flushChars: 2,
      flushIntervalMs: 1_000,
    },
    skills: {
      enabled: true,
      autoDiscovery: false,
      discoveryPaths: [],
    },
    locale: "zh-CN" as const,
  };
}

describe("AgentRunner", () => {
  it("runs before_response and finalizes a plain text turn", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const config = createConfig();
    config.memory.injectionTokenBudget = 777;
    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "hello" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config,
      io,
    });

    await runner.start();
    await runner.submit("继续这个任务", "turn-1");

    expect(io.emitInjectionBanner).toHaveBeenCalled();
    expect(io.emitAssistantDelta).toHaveBeenCalled();
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-1", "stop");
    expect(io.recordPrepareContextLatency).toHaveBeenCalledWith("before_response", expect.any(Number));
    expect(io.recordProviderCall).toHaveBeenCalledWith("ollama");
    expect(io.recordProviderFirstTokenLatency).toHaveBeenCalledWith("ollama", expect.any(Number));
    expect(memoryClient.sessionStartContext).toHaveBeenCalledWith(expect.objectContaining({
      injection_token_budget: 777,
    }));
    expect(memoryClient.prepareContext).toHaveBeenCalledWith(expect.objectContaining({
      phase: "before_response",
      injection_token_budget: 777,
    }));
  });

  it("runs task_switch, task_start, before_plan, and before_response in order", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("帮我规划一下支付链路重构", "turn-1");

    const phaseOffset = io.emitPhaseResult.mock.calls.length;
    const taskOffset = io.emitTaskChange.mock.calls.length;

    await runner.submit("帮我换成修复登录接口，先看日志再给方案", "turn-2");

    const phases = io.emitPhaseResult.mock.calls.slice(phaseOffset).map((call) => call[1]);
    const taskChanges = io.emitTaskChange.mock.calls.slice(taskOffset).map((call) => call[1]);
    const preparePhases = memoryClient.prepareContext.mock.calls.slice(-4).map((call) => call[0].phase);

    expect(phases).toEqual(["task_switch", "task_start", "before_plan", "before_response"]);
    expect(preparePhases).toEqual(["task_switch", "task_start", "before_plan", "before_response"]);
    expect(taskChanges.map((item) => item.change)).toEqual(["switch", "start"]);
    expect(io.emitTaskChange.mock.invocationCallOrder[taskOffset]!).toBeLessThan(
      io.emitPhaseResult.mock.invocationCallOrder[phaseOffset]!,
    );
  });

  it("continues with later phases when one prepareContext phase fails", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.prepareContext
      .mockImplementationOnce(async ({ phase }: { phase: string }) => ({
        trace_id: `trace-${phase}`,
        trigger: false,
        trigger_reason: phase,
        memory_packet: null,
        injection_block: null,
        degraded: false,
        dependency_status: {
          read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
          embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
          storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
          memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
        },
        budget_used: 0,
        memory_packet_ids: [],
      }))
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("runtime timeout"), {
          code: "runtime_unavailable",
        });
      })
      .mockImplementationOnce(async ({ phase }: { phase: string }) => ({
        trace_id: `trace-${phase}`,
        trigger: false,
        trigger_reason: phase,
        memory_packet: null,
        injection_block: {
          injection_reason: "later phase recovered",
          memory_summary: "recovered injection",
          memory_records: [],
          token_estimate: 0,
          memory_mode: "workspace_plus_global" as const,
          requested_scopes: ["workspace"],
          selected_scopes: ["workspace"],
          trimmed_record_ids: [],
          trim_reasons: [],
        },
        degraded: false,
        dependency_status: {
          read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
          embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
          storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
          memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
        },
        budget_used: 0,
        memory_packet_ids: [],
      }));

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "hello" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("帮我换成修复登录接口，先看日志再给方案", "turn-partial-fail");

    const phases = io.emitPhaseResult.mock.calls.slice(-3).map((call) => call[1]);
    expect(phases).toEqual(["task_start", "before_plan", "before_response"]);
    expect(io.emitError).toHaveBeenCalledWith(
      "session",
      expect.objectContaining({
        code: "runtime_unavailable",
        message: "runtime timeout",
      }),
    );
    expect(io.emitInjectionBanner).toHaveBeenLastCalledWith(
      "turn-partial-fail",
      expect.objectContaining({
        phase: "before_response",
      }),
      true,
    );
    expect(io.emitAssistantDelta).toHaveBeenCalledWith("turn-partial-fail", "hello");
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-partial-fail", "stop");
  });

  it("resumes a matching historical task instead of creating a new task", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("帮我规划一下支付链路重构", "turn-task-a");
    await runner.submit("帮我规划一下修复登录接口", "turn-task-b");

    const taskOffset = io.emitTaskChange.mock.calls.length;
    const phaseOffset = io.emitPhaseResult.mock.calls.length;

    await runner.submit("帮我换成支付链路重构", "turn-task-resume");

    const taskChanges = io.emitTaskChange.mock.calls.slice(taskOffset).map((call) => call[1]);
    const phases = io.emitPhaseResult.mock.calls.slice(phaseOffset).map((call) => call[1]);

    expect(taskChanges).toEqual([
      expect.objectContaining({
        change: "resume",
        label: "帮我规划一下支付链路重构",
      }),
    ]);
    expect(phases).toEqual(["task_switch", "before_response"]);
  });

  it("emits turn errors before turn_end when provider streaming fails mid-turn", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "partial" } as const;
          throw Object.assign(new Error("provider stream broke"), {
            code: "provider_stream_error",
          });
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("继续", "turn-error");

    expect(io.emitAssistantDelta).toHaveBeenCalled();
    expect(io.emitError).toHaveBeenCalledWith(
      "turn",
      expect.objectContaining({
        code: "provider_stream_error",
        message: "provider stream broke",
      }),
      "turn-error",
    );
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-error", "error");
    expect(io.emitError.mock.invocationCallOrder[0]!).toBeLessThan(io.emitTurnEnd.mock.invocationCallOrder[0]!);
    expect(io.recordProviderCall).toHaveBeenCalledWith("ollama");
    expect(io.recordProviderFirstTokenLatency).toHaveBeenCalledWith("ollama", expect.any(Number));
  });

  it("emits writeback failures as non-terminal turn errors", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.finalizeTurn.mockRejectedValueOnce(new Error("runtime timeout"));

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "hello" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("继续这个任务", "turn-writeback-error");
    await Promise.resolve();

    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-writeback-error", "stop");
    expect(io.emitError).toHaveBeenCalledWith(
      "turn",
      expect.objectContaining({
        code: "memory_writeback_incomplete",
        message: "memory writeback incomplete",
        reason: "runtime_timeout",
      }),
      "turn-writeback-error",
    );
    expect(io.emitError.mock.calls.some((call) => call[0] === "session" && call[1]?.code === "memory_writeback_incomplete")).toBe(false);
  });

  it("emits degraded writeback results as non-terminal turn errors", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.finalizeTurn.mockResolvedValueOnce({
      trace_id: "trace-finalize-storage-down",
      write_back_candidates: [
        {
          workspace_id: "550e8400-e29b-41d4-a716-446655440000",
          user_id: "550e8400-e29b-41d4-a716-446655440001",
          task_id: null,
          session_id: "session-001",
          scope: "workspace",
          candidate_type: "fact_preference",
          summary: "用户偏好默认中文输出。",
          details: {},
          importance: 7,
          confidence: 0.9,
          write_reason: "用户明确要求记住偏好。",
          source: {
            source_type: "turn",
            source_ref: "turn-writeback-storage-down",
            service_name: "memory-native-agent",
          },
          idempotency_key: "cand-storage-down",
        },
      ],
      submitted_jobs: [
        {
          candidate_summary: "用户偏好默认中文输出。",
          status: "dependency_unavailable",
          reason: "storage unavailable",
        },
      ],
      memory_mode: "workspace_plus_global",
      candidate_count: 1,
      filtered_count: 0,
      filtered_reasons: [],
      writeback_submitted: false,
      degraded: true,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "unavailable", detail: "storage unavailable", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
    });

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "好的。" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("记住这个偏好", "turn-writeback-storage-down");
    await Promise.resolve();

    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-writeback-storage-down", "stop");
    expect(io.emitError).toHaveBeenCalledWith(
      "turn",
      expect.objectContaining({
        code: "memory_writeback_incomplete",
        message: "memory writeback incomplete",
        reason: "storage_write_failed",
      }),
      "turn-writeback-storage-down",
    );
  });

  it("warns then pauses writeback after repeated finalize failures", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.finalizeTurn.mockRejectedValue(new Error("runtime timeout"));

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "已确认默认用中文。" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    for (let index = 0; index < 9; index += 1) {
      await runner.submit("记住默认用中文回复", `turn-writeback-health-${index}`);
      await Promise.resolve();
    }

    expect(memoryClient.finalizeTurn).toHaveBeenCalledTimes(8);
    expect(io.emitError.mock.calls.filter((call) => call[1]?.code === "memory_writeback_degraded")).toHaveLength(1);
    expect(io.emitError.mock.calls.filter((call) => call[1]?.code === "memory_writeback_paused")).toHaveLength(1);
  });

  it("emits a session error once when store writes fail but still completes the turn", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const store = {
      appendMessage: vi.fn(() => {
        throw new Error("db readonly");
      }),
      openTurn: vi.fn(() => {
        throw new Error("db readonly");
      }),
      closeTurn: vi.fn(() => {
        throw new Error("db readonly");
      }),
      saveDispatchedMessages: vi.fn(() => {
        throw new Error("db readonly");
      }),
      getMessages: vi.fn(() => []),
    };

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "hello" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
      store: store as never,
    });

    await runner.start();
    await runner.submit("继续", "turn-store-error");

    expect(io.emitError).toHaveBeenCalledWith(
      "session",
      expect.objectContaining({
        code: "session_store_unavailable",
        message: "db readonly",
      }),
    );
    expect(io.emitError.mock.calls.filter((call) => call[0] === "session")).toHaveLength(1);
    expect(io.emitAssistantDelta).toHaveBeenCalledWith("turn-store-error", "hello");
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-store-error", "stop");
  });

  it("runs a tool loop, stores wrapped tool output, and saves round-two dispatched messages", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const invoke = vi.fn(async () => ({
      ok: true,
      output: "README body",
      trust_level: "builtin_read" as const,
      permission_decision: "auto" as const,
    }));
    const saveDispatchedMessages = vi.fn();
    const appendMessage = vi.fn();

    const chat = vi.fn(async function* (request: { messages: Array<{ role: string }> }) {
      const hasToolMessage = request.messages.some((message) => message.role === "tool");
      if (!hasToolMessage) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "fs_read",
            args: {
              path: "README.md",
            },
          },
        } as const;
        yield {
          type: "end",
          finish_reason: "tool_use",
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
          },
        } as const;
        return;
      }

      yield { type: "text_delta", text: "read result" } as const;
      yield {
        type: "end",
        finish_reason: "stop",
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
        },
      } as const;
    });

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat,
      },
      tools: {
        listTools: () => [
          {
            name: "fs_read",
            description: "Read a file",
            parameters: {
              type: "object",
            },
          },
        ],
        invoke,
      } as never,
      config: createConfig(),
      io,
      store: {
        openTurn: vi.fn(),
        appendMessage,
        closeTurn: vi.fn(),
        saveDispatchedMessages,
        getMessages: vi.fn(() => []),
      } as never,
    });

    await runner.start();
    await runner.submit("读取 README", "turn-tool-loop");

    expect(io.emitToolCallStart).toHaveBeenCalledWith(
      "turn-tool-loop",
      expect.objectContaining({
        id: "call-1",
        name: "fs_read",
      }),
    );
    expect(io.emitToolCallResult).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({
        ok: true,
        trust_level: "builtin_read",
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "call-1",
        name: "fs_read",
      }),
      expect.objectContaining({
        turnId: "turn-tool-loop",
      }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining("<tool_output tool=\"fs_read\" call_id=\"call-1\" trust=\"builtin_read\">"),
      }),
    );
    expect(saveDispatchedMessages).toHaveBeenCalledTimes(3);
    expect(saveDispatchedMessages).toHaveBeenNthCalledWith(
      1,
      "turn-tool-loop",
      expect.objectContaining({
        provider_id: "ollama",
        model: "qwen2.5-coder",
      }),
    );
    expect(saveDispatchedMessages).toHaveBeenNthCalledWith(
      2,
      "turn-tool-loop",
      expect.objectContaining({
        provider_id: "ollama",
        model: "qwen2.5-coder",
      }),
    );
    expect(saveDispatchedMessages).toHaveBeenNthCalledWith(
      3,
      "turn-tool-loop",
      expect.objectContaining({
        provider_id: "ollama",
        model: "qwen2.5-coder",
      }),
    );
    const firstDispatch = saveDispatchedMessages.mock.calls[0]?.[1] as { messages_json: string };
    const secondDispatch = saveDispatchedMessages.mock.calls[1]?.[1] as { messages_json: string };
    const firstMessages = JSON.parse(firstDispatch.messages_json) as Array<Record<string, unknown>>;
    const secondMessages = JSON.parse(secondDispatch.messages_json) as Array<Record<string, unknown>>;
    expect(firstMessages.filter((message) => message.role === "user" && message.content === "读取 README")).toHaveLength(1);
    expect(secondMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              id: "call-1",
              name: "fs_read",
            }),
          ],
        }),
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
        }),
      ]),
    );
    expect(chat).toHaveBeenCalledTimes(2);
    expect(io.emitAssistantDelta).toHaveBeenCalledWith("turn-tool-loop", "read result");
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-tool-loop", "stop");
  });

  it("only finalizes turns when user input and assistant output contain writeback signals", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const finalizeTurn = memoryClient.finalizeTurn;

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("...", "turn-no-assistant-output");

    expect(finalizeTurn).not.toHaveBeenCalled();

    const secondRunner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "hello" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io: createIo(),
    });

    await secondRunner.start();
    await secondRunner.submit("记住默认用中文回复", "turn-with-output");

    expect(finalizeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        turn_id: "turn-with-output",
        current_input: "记住默认用中文回复",
        assistant_output: "hello",
      }),
    );
  });

  it("passes computed max_tokens to the provider when context budget is configured", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const config = createConfig();
    config.context.maxTokens = 12_000;
    config.context.reserveTokens = 2_000;
    const chat = vi.fn(async function* () {
      yield { type: "text_delta", text: "hello" } as const;
      yield {
        type: "end",
        finish_reason: "stop",
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
        },
      } as const;
    });

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "anthropic",
        model: () => "claude-sonnet",
        chat,
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config,
      io,
    });

    await runner.start();
    await runner.submit("继续", "turn-budget");

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 10_000,
      }),
    );
  });

  it("persists budget plan, plan, evaluation, and trace spans in dispatched payload", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const saveDispatchedMessages = vi.fn();

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "ok" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
      store: {
        openTurn: vi.fn(),
        appendMessage: vi.fn(),
        closeTurn: vi.fn(),
        saveDispatchedMessages,
        getMessages: vi.fn(() => []),
      } as never,
    });

    await runner.start();
    await runner.submit("先规划一下再继续", "turn-observe");

    const payload = saveDispatchedMessages.mock.calls.at(-1)?.[1] as {
      budget_plan_json?: string | null;
      plan_json?: string | null;
      trace_spans_json?: string | null;
      evaluation_json?: string | null;
    };

    expect(payload.budget_plan_json).toBeTruthy();
    expect(payload.plan_json).toBeTruthy();
    expect(payload.trace_spans_json).toBeTruthy();
    expect(payload.evaluation_json).toBeTruthy();
    expect(JSON.parse(payload.plan_json ?? "{}")).toEqual(
      expect.objectContaining({
        goal: "先规划一下再继续",
      }),
    );
  });

  it("emits plan and evaluation events for planning turns", async () => {
    const io = createIo();
    io.emitPlan = vi.fn();
    io.emitEvaluation = vi.fn();
    const memoryClient = createMemoryClient();

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "ok" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("给我一个方案，先做 A，再做 B，再做 C", "turn-plan");

    expect(io.emitPlan).toHaveBeenCalled();
    expect(io.emitEvaluation).toHaveBeenCalledWith(
      "turn-plan",
      expect.objectContaining({
        scope: "turn",
      }),
    );
  });

  it("waits for plan confirmation before continuing when plan mode is confirm", async () => {
    const io = createIo();
    io.emitPlan = vi.fn();
    io.requestPlanConfirm = vi.fn(async () => ({ outcome: "approve" as const }));
    const memoryClient = createMemoryClient();
    const config = createConfig();
    config.planning.planMode = "confirm";

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "ok" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config,
      io,
    });

    await runner.start();
    await runner.submit("给我一个方案，先做 A，再做 B，再做 C", "turn-plan-confirm");

    expect(io.requestPlanConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        turn_id: "turn-plan-confirm",
      }),
    );
    expect(io.recordPlanConfirmation).toHaveBeenCalledWith("approve");
    expect(io.emitAssistantDelta).toHaveBeenCalledWith("turn-plan-confirm", "ok");
  });

  it("retries a failed tool once and records retry metrics", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        output: "first failed",
        trust_level: "shell" as const,
        permission_decision: "auto" as const,
        error: {
          code: "tool_execution_failed",
          message: "failed",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        output: "second ok",
        trust_level: "shell" as const,
        permission_decision: "auto" as const,
      });

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* (request: { messages: Array<{ role: string }> }) {
          const hasToolMessage = request.messages.some((message) => message.role === "tool");
          if (!hasToolMessage) {
            yield {
              type: "tool_call",
              call: {
                id: "call-retry",
                name: "shell_exec",
                args: {
                  command: "dir",
                },
              },
            } as const;
            yield {
              type: "end",
              finish_reason: "tool_use",
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
              },
            } as const;
            return;
          }

          yield { type: "text_delta", text: "recovered" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [
          {
            name: "shell_exec",
            description: "Execute shell",
            parameters: {
              type: "object",
            },
            parallelism: "safe",
          },
        ],
        invoke,
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("执行命令并给我结果", "turn-tool-retry");

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(io.recordRetry).toHaveBeenCalledWith("shell_exec");
    expect(io.emitAssistantDelta).toHaveBeenCalledWith("turn-tool-retry", "recovered");
  });

  it("deduplicates repeated memory records across phases before building the prompt", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.prepareContext.mockImplementation((async ({ phase }: { phase: string }) => ({
      trace_id: `trace-${phase}`,
      trigger: true,
      trigger_reason: phase,
      memory_packet: null,
      injection_block: {
        injection_reason: "history reference",
        memory_summary: "用户长期偏好与当前任务上下文",
        memory_records: [
          {
            id: "pref-1",
            memory_type: "fact_preference",
            scope: "workspace",
            summary: "默认用中文回答",
            importance: 0.95,
            confidence: 0.98,
          },
        ],
        token_estimate: 0,
        memory_mode: "workspace_plus_global" as const,
        requested_scopes: ["workspace"],
        selected_scopes: ["workspace"],
        trimmed_record_ids: [],
        trim_reasons: [],
      },
      degraded: false,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
      budget_used: 0,
      memory_packet_ids: [],
    })) as never);
    const saveDispatchedMessages = vi.fn();

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
      store: {
        openTurn: vi.fn(),
        appendMessage: vi.fn(),
        closeTurn: vi.fn(),
        saveDispatchedMessages,
        getMessages: vi.fn(() => []),
      } as never,
    });

    await runner.start();
    await runner.submit("帮我规划一下支付链路重构", "turn-dedupe");

    expect(saveDispatchedMessages).toHaveBeenCalled();
    const payload = saveDispatchedMessages.mock.calls[0]?.[1] as {
      messages_json: string;
      prompt_segments_json: string;
      phase_results_json: string;
    };
    const promptSegments = JSON.parse(payload.prompt_segments_json) as Array<{ kind: string }>;
    const messages = JSON.parse(payload.messages_json) as Array<{ role: string }>;
    const phaseResults = JSON.parse(payload.phase_results_json) as Array<{ phase: string; injection_summary?: string }>;

    expect(promptSegments.filter((segment) => segment.kind === "memory_high")).toHaveLength(1);
    expect(promptSegments.some((segment) => segment.kind === "memory_summary")).toBe(false);
    expect(messages.filter((message) => message.role === "system")).toHaveLength(2);
    expect(phaseResults.map((result) => result.phase)).toEqual(["task_start", "before_plan", "before_response"]);
    expect(phaseResults.every((result) => result.injection_summary === "用户长期偏好与当前任务上下文")).toBe(true);
  });

  it("persists degraded skip reason in dispatched phase results", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.prepareContext.mockImplementation((async ({ phase }: { phase: string }) => ({
      trace_id: `trace-${phase}`,
      trigger: phase !== "before_response",
      trigger_reason: phase,
      memory_packet: null,
      injection_block: null,
      degraded: phase === "before_response",
      degraded_skip_reason:
        phase === "before_response" ? "trigger_dependencies_unavailable" : undefined,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
      budget_used: 0,
      memory_packet_ids: [],
    })) as never);
    const saveDispatchedMessages = vi.fn();

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
      store: {
        openTurn: vi.fn(),
        appendMessage: vi.fn(),
        closeTurn: vi.fn(),
        saveDispatchedMessages,
        getMessages: vi.fn(() => []),
      } as never,
    });

    await runner.start();
    await runner.submit("继续刚才那个方案", "turn-degraded-phase");

    const payload = saveDispatchedMessages.mock.calls.at(-1)?.[1] as {
      phase_results_json: string;
    };
    const phaseResults = JSON.parse(payload.phase_results_json) as Array<{
      phase: string;
      degraded: boolean;
      degraded_skip_reason?: string;
    }>;

    expect(phaseResults).toEqual([
      {
        phase: "task_start",
        trace_id: "trace-task_start",
        degraded: false,
      },
      {
        phase: "before_response",
        trace_id: "trace-before_response",
        degraded: true,
        degraded_skip_reason: "trigger_dependencies_unavailable",
      },
    ]);
  });

  it("keeps session_start stable memories as resident prompt content across turns", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.sessionStartContext.mockResolvedValue({
      trace_id: "trace-session",
      additional_context: "恢复基础偏好与任务状态",
      active_task_summary: "当前任务：补齐测试",
      injection_block: {
        injection_reason: "会话启动恢复",
        memory_summary: "稳定偏好与当前任务",
        memory_records: [
          {
            id: "resident-pref",
            memory_type: "fact_preference",
            scope: "user",
            summary: "默认用中文回答",
            importance: 5,
            confidence: 0.98,
          },
          {
            id: "resident-task",
            memory_type: "task_state",
            scope: "task",
            summary: "当前任务：补齐测试",
            importance: 5,
            confidence: 0.95,
          },
        ],
        token_estimate: 0,
        memory_mode: "workspace_plus_global" as const,
        requested_scopes: ["workspace", "user", "task"],
        selected_scopes: ["user", "task"],
        trimmed_record_ids: [],
        trim_reasons: [],
      },
      memory_mode: "workspace_plus_global" as const,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
      degraded: false,
    });
    memoryClient.prepareContext.mockResolvedValue({
      trace_id: "trace-before-response",
      trigger: false,
      trigger_reason: "no incremental memory",
      memory_packet: null,
      injection_block: null,
      degraded: false,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
      budget_used: 0,
      memory_packet_ids: [],
    });
    const saveDispatchedMessages = vi.fn();

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
      store: {
        openTurn: vi.fn(),
        appendMessage: vi.fn(),
        closeTurn: vi.fn(),
        saveDispatchedMessages,
        getMessages: vi.fn(() => []),
      } as never,
    });

    await runner.start();
    await runner.submit("继续当前任务", "turn-resident");

    const payload = saveDispatchedMessages.mock.calls[0]?.[1] as {
      prompt_segments_json: string;
    };
    const promptSegments = JSON.parse(payload.prompt_segments_json) as Array<{ kind: string; preview: string }>;
    expect(promptSegments.some((segment) => segment.kind === "memory_high" && segment.preview.includes("稳定偏好与当前任务"))).toBe(true);
  });

  it("refreshes resident memory on the next turn after resident writeback candidates appear", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.sessionStartContext
      .mockResolvedValueOnce({
        trace_id: "trace-session-1",
        additional_context: "第一次恢复",
        active_task_summary: null,
        injection_block: {
          injection_reason: "会话启动恢复",
          memory_summary: "默认中文输出",
          memory_records: [
            {
              id: "resident-pref-1",
              memory_type: "fact_preference",
              scope: "user",
              summary: "默认用中文回答",
              importance: 5,
              confidence: 0.98,
            },
          ],
          token_estimate: 0,
          memory_mode: "workspace_plus_global" as const,
          requested_scopes: ["user"],
          selected_scopes: ["user"],
          trimmed_record_ids: [],
          trim_reasons: [],
        },
        memory_mode: "workspace_plus_global" as const,
        dependency_status: {
          read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
          embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
          storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
          memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
        },
        degraded: false,
      })
      .mockResolvedValueOnce({
        trace_id: "trace-session-2",
        additional_context: "第二次恢复",
        active_task_summary: null,
        injection_block: {
          injection_reason: "会话启动恢复",
          memory_summary: "默认改成英文输出",
          memory_records: [
            {
              id: "resident-pref-2",
              memory_type: "fact_preference",
              scope: "user",
              summary: "默认用英文回答",
              importance: 5,
              confidence: 0.98,
            },
          ],
          token_estimate: 0,
          memory_mode: "workspace_plus_global" as const,
          requested_scopes: ["user"],
          selected_scopes: ["user"],
          trimmed_record_ids: [],
          trim_reasons: [],
        },
        memory_mode: "workspace_plus_global" as const,
        dependency_status: {
          read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
          embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
          storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
          memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
        },
        degraded: false,
      });
    const finalizeTurn = memoryClient.finalizeTurn;
    finalizeTurn.mockResolvedValueOnce({
      trace_id: "trace-finalize-1",
      write_back_candidates: [
        {
          workspace_id: "550e8400-e29b-41d4-a716-446655440000",
          user_id: "550e8400-e29b-41d4-a716-446655440001",
          task_id: null,
          session_id: "550e8400-e29b-41d4-a716-446655440002",
          candidate_type: "fact_preference",
          scope: "user",
          summary: "默认用英文回答",
          details: {},
          importance: 5,
          confidence: 0.95,
          write_reason: "updated preference",
          source: {
            source_type: "memory_llm",
            source_ref: "turn-1",
            service_name: "retrieval-runtime",
          },
          idempotency_key: "resident-update",
        },
      ],
      submitted_jobs: [
        {
          candidate_summary: "默认用英文回答",
          job_id: "550e8400-e29b-41d4-a716-446655440060",
          status: "accepted_async",
        },
      ],
      memory_mode: "workspace_plus_global" as const,
      candidate_count: 1,
      filtered_count: 0,
      filtered_reasons: [],
      writeback_submitted: true,
      degraded: false,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
    });
    memoryClient.getWriteProjectionStatuses.mockResolvedValueOnce({
      items: [
        {
          job_id: "550e8400-e29b-41d4-a716-446655440060",
          write_job_status: "succeeded",
          result_record_id: "550e8400-e29b-41d4-a716-446655440061",
          result_status: "insert_new",
          latest_refresh_job: {
            job_id: "550e8400-e29b-41d4-a716-446655440062",
            source_record_id: "550e8400-e29b-41d4-a716-446655440061",
            refresh_type: "insert",
            job_status: "succeeded",
            created_at: "2026-04-23T00:00:00.000Z",
            finished_at: "2026-04-23T00:00:01.000Z",
            error_message: null,
          },
          projection_ready: true,
        },
      ],
    });
    const saveDispatchedMessages = vi.fn();

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "ok" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
      store: {
        openTurn: vi.fn(),
        appendMessage: vi.fn(),
        closeTurn: vi.fn(),
        saveDispatchedMessages,
        getMessages: vi.fn(() => []),
      } as never,
    });

    await runner.start();
    await runner.submit("继续当前任务", "turn-refresh-1");
    await Promise.resolve();
    await runner.submit("继续当前任务", "turn-refresh-2");

    expect(memoryClient.sessionStartContext).toHaveBeenCalledTimes(2);
  });

  it("injects skill context and forwards model override plus preapproved tools", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    const invoke = vi.fn(async () => ({
      ok: true,
      output: "updated",
      trust_level: "builtin_write" as const,
      permission_decision: "preapproved" as const,
    }));
    const chat = vi.fn(async function* () {
      yield {
        type: "tool_call",
        call: {
          id: "call-skill",
          name: "fs_write",
          args: {
            path: "notes.txt",
            content: "body",
          },
        },
      } as const;
      yield {
        type: "end",
        finish_reason: "tool_use",
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
        },
      } as const;
      yield { type: "text_delta", text: "done" } as const;
      yield {
        type: "end",
        finish_reason: "stop",
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
        },
      } as const;
    });
    const skillContext: MaterializedSkillContext = {
      skill: {
        id: "skill-1",
        name: "Deploy Helper",
        description: "desc",
        source: {
          kind: "claude-skill",
          rootDir: "C:/workspace",
          entryFile: "C:/workspace/SKILL.md",
        },
        content: {
          markdown: "body",
          resources: [],
        },
        invocation: {
          userInvocable: true,
          modelInvocable: false,
          slashName: "deploy-helper",
        },
        runtime: {
          model: "claude-sonnet-4",
          effort: "high",
        },
        permissions: {
          preapprovedTools: ["fs_write"],
        },
      },
      input: {
        skill: null as unknown as MaterializedSkillContext["skill"],
        rawInput: "/deploy-helper prod api",
        rawArguments: "prod api",
        positionalArguments: ["prod", "api"],
      },
      systemPrompt: "skill prompt",
      modelOverride: "claude-sonnet-4",
      effort: "high",
      preapprovedTools: ["fs_write"],
    };
    skillContext.input.skill = skillContext.skill;

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "openai-compatible",
        model: () => "gpt-4.1-mini",
        chat,
      },
      tools: {
        listTools: () => [
          {
            name: "fs_write",
            description: "Write a file",
            parameters: { type: "object" },
          },
        ],
        invoke,
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("/deploy-helper prod api", "turn-skill", { skillContext });

    expect(chat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: "claude-sonnet-4",
        effort: "high",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("skill prompt"),
          }),
        ]),
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "fs_write",
      }),
      expect.objectContaining({
        preapprovedTools: ["fs_write"],
      }),
    );
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-skill", "stop");
  });

  it("emits after_response phase summary when finalize turn returns pending confirmation candidates", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.finalizeTurn.mockResolvedValueOnce({
      trace_id: "trace-finalize-pending",
      write_back_candidates: [
        {
          workspace_id: "550e8400-e29b-41d4-a716-446655440000",
          user_id: "550e8400-e29b-41d4-a716-446655440001",
          task_id: null,
          session_id: "550e8400-e29b-41d4-a716-446655440002",
          candidate_type: "fact_preference",
          scope: "user",
          summary: "默认改成 tab 缩进",
          details: {},
          importance: 5,
          confidence: 0.94,
          write_reason: "updated preference",
          suggested_status: "pending_confirmation",
          source: {
            source_type: "memory_llm",
            source_ref: "turn-pending",
            service_name: "retrieval-runtime",
          },
          idempotency_key: "pending-pref",
        },
      ],
      submitted_jobs: [
        {
          candidate_summary: "默认改成 tab 缩进",
          job_id: "550e8400-e29b-41d4-a716-446655440071",
          status: "accepted_async",
        },
      ],
      memory_mode: "workspace_plus_global" as const,
      candidate_count: 1,
      filtered_count: 0,
      filtered_reasons: [],
      writeback_submitted: true,
      degraded: false,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
    });

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "ok" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
      store: {
        openTurn: vi.fn(),
        appendMessage: vi.fn(),
        closeTurn: vi.fn(),
        saveDispatchedMessages: vi.fn(),
        getMessages: vi.fn(() => []),
      } as never,
    });

    await runner.start();
    await runner.submit("还是用 tab 吧", "turn-pending-confirmation");
    await Promise.resolve();

    expect(io.emitPhaseResult).toHaveBeenCalledWith(
      "turn-pending-confirmation",
      "after_response",
      expect.objectContaining({
        trigger_reason: "pending_confirmation_notice",
        injection_block: expect.objectContaining({
          memory_summary: expect.stringContaining("待确认记忆"),
        }),
      }),
    );
  });

  it("keeps resident memory when write projection is not ready yet", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.sessionStartContext
      .mockResolvedValueOnce({
        trace_id: "trace-session-1",
        additional_context: "",
        active_task_summary: null,
        injection_block: {
          injection_reason: "会话启动恢复",
          memory_summary: "默认用中文回答",
          memory_records: [
            {
              id: "resident-pref-1",
              memory_type: "fact_preference",
              scope: "user",
              summary: "默认用中文回答",
              importance: 5,
              confidence: 0.98,
            },
          ],
          token_estimate: 0,
          memory_mode: "workspace_plus_global" as const,
          requested_scopes: ["user"],
          selected_scopes: ["user"],
          trimmed_record_ids: [],
          trim_reasons: [],
        },
        memory_mode: "workspace_plus_global" as const,
        dependency_status: {
          read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
          embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
          storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
          memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
        },
        degraded: false,
      });
    memoryClient.finalizeTurn.mockResolvedValueOnce({
      trace_id: "trace-finalize-1",
      write_back_candidates: [
        {
          workspace_id: "550e8400-e29b-41d4-a716-446655440000",
          user_id: "550e8400-e29b-41d4-a716-446655440001",
          task_id: null,
          session_id: "550e8400-e29b-41d4-a716-446655440002",
          candidate_type: "fact_preference",
          scope: "user",
          summary: "默认用英文回答",
          details: {},
          importance: 5,
          confidence: 0.95,
          write_reason: "updated preference",
          source: {
            source_type: "memory_llm",
            source_ref: "turn-1",
            service_name: "retrieval-runtime",
          },
          idempotency_key: "resident-update",
        },
      ],
      submitted_jobs: [
        {
          candidate_summary: "默认用英文回答",
          job_id: "550e8400-e29b-41d4-a716-446655440010",
          status: "accepted_async",
        },
      ],
      memory_mode: "workspace_plus_global" as const,
      candidate_count: 1,
      filtered_count: 0,
      filtered_reasons: [],
      writeback_submitted: true,
      degraded: false,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
    });
    memoryClient.getWriteProjectionStatuses.mockResolvedValueOnce({
      items: [
        {
          job_id: "550e8400-e29b-41d4-a716-446655440010",
          write_job_status: "succeeded",
          result_record_id: "550e8400-e29b-41d4-a716-446655440011",
          result_status: "insert_new",
          latest_refresh_job: {
            job_id: "550e8400-e29b-41d4-a716-446655440012",
            source_record_id: "550e8400-e29b-41d4-a716-446655440011",
            refresh_type: "insert",
            job_status: "processing",
            created_at: "2026-04-23T00:00:00.000Z",
            finished_at: null,
            error_message: null,
          },
          projection_ready: false,
        },
      ],
    });

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "ok" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("继续当前任务", "turn-projection-pending-1");
    await Promise.resolve();
    await runner.submit("继续当前任务", "turn-projection-pending-2");

    expect(memoryClient.getWriteProjectionStatuses).toHaveBeenCalledWith({
      job_ids: ["550e8400-e29b-41d4-a716-446655440010"],
    });
    expect(memoryClient.sessionStartContext).toHaveBeenCalledTimes(1);
  });

  it("emits one stale warning and cools down repeated resident refresh misses", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.finalizeTurn.mockResolvedValueOnce({
      trace_id: "trace-finalize-1",
      write_back_candidates: [
        {
          workspace_id: "550e8400-e29b-41d4-a716-446655440000",
          user_id: "550e8400-e29b-41d4-a716-446655440001",
          task_id: null,
          session_id: "550e8400-e29b-41d4-a716-446655440002",
          candidate_type: "fact_preference",
          scope: "user",
          summary: "默认用英文回答",
          details: {},
          importance: 5,
          confidence: 0.95,
          write_reason: "updated preference",
          source: {
            source_type: "memory_llm",
            source_ref: "turn-1",
            service_name: "retrieval-runtime",
          },
          idempotency_key: "resident-update",
        },
      ],
      submitted_jobs: [
        {
          candidate_summary: "默认用英文回答",
          job_id: "550e8400-e29b-41d4-a716-446655440030",
          status: "accepted_async",
        },
      ],
      memory_mode: "workspace_plus_global" as const,
      candidate_count: 1,
      filtered_count: 0,
      filtered_reasons: [],
      writeback_submitted: true,
      degraded: false,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
    });

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "ok" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("记住默认用英文回答", "turn-stale-seed");
    await Promise.resolve();

    for (let index = 0; index < 6; index += 1) {
      await runner.submit("继续当前任务", `turn-stale-${index}`);
      await Promise.resolve();
    }

    expect(memoryClient.getWriteProjectionStatuses).toHaveBeenCalledTimes(5);
    expect(memoryClient.sessionStartContext).toHaveBeenCalledTimes(1);
    expect(io.emitError.mock.calls.filter((call) => call[1]?.code === "resident_memory_stale")).toHaveLength(1);
  });

  it("refreshes resident memory after write projection becomes ready", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
    memoryClient.sessionStartContext
      .mockResolvedValueOnce({
        trace_id: "trace-session-1",
        additional_context: "",
        active_task_summary: null,
        injection_block: {
          injection_reason: "会话启动恢复",
          memory_summary: "默认用中文回答",
          memory_records: [
            {
              id: "resident-pref-1",
              memory_type: "fact_preference",
              scope: "user",
              summary: "默认用中文回答",
              importance: 5,
              confidence: 0.98,
            },
          ],
          token_estimate: 0,
          memory_mode: "workspace_plus_global" as const,
          requested_scopes: ["user"],
          selected_scopes: ["user"],
          trimmed_record_ids: [],
          trim_reasons: [],
        },
        memory_mode: "workspace_plus_global" as const,
        dependency_status: {
          read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
          embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
          storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
          memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
        },
        degraded: false,
      })
      .mockResolvedValueOnce({
        trace_id: "trace-session-2",
        additional_context: "",
        active_task_summary: null,
        injection_block: {
          injection_reason: "会话启动恢复",
          memory_summary: "默认用英文回答",
          memory_records: [
            {
              id: "resident-pref-2",
              memory_type: "fact_preference",
              scope: "user",
              summary: "默认用英文回答",
              importance: 5,
              confidence: 0.98,
            },
          ],
          token_estimate: 0,
          memory_mode: "workspace_plus_global" as const,
          requested_scopes: ["user"],
          selected_scopes: ["user"],
          trimmed_record_ids: [],
          trim_reasons: [],
        },
        memory_mode: "workspace_plus_global" as const,
        dependency_status: {
          read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
          embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
          storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
          memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
        },
        degraded: false,
      });
    memoryClient.finalizeTurn.mockResolvedValueOnce({
      trace_id: "trace-finalize-1",
      write_back_candidates: [
        {
          workspace_id: "550e8400-e29b-41d4-a716-446655440000",
          user_id: "550e8400-e29b-41d4-a716-446655440001",
          task_id: null,
          session_id: "550e8400-e29b-41d4-a716-446655440002",
          candidate_type: "fact_preference",
          scope: "user",
          summary: "默认用英文回答",
          details: {},
          importance: 5,
          confidence: 0.95,
          write_reason: "updated preference",
          source: {
            source_type: "memory_llm",
            source_ref: "turn-1",
            service_name: "retrieval-runtime",
          },
          idempotency_key: "resident-update",
        },
      ],
      submitted_jobs: [
        {
          candidate_summary: "默认用英文回答",
          job_id: "550e8400-e29b-41d4-a716-446655440020",
          status: "accepted_async",
        },
      ],
      memory_mode: "workspace_plus_global" as const,
      candidate_count: 1,
      filtered_count: 0,
      filtered_reasons: [],
      writeback_submitted: true,
      degraded: false,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
        memory_llm: { name: "memory_llm", status: "healthy", detail: "", last_checked_at: "now" },
      },
    });
    memoryClient.getWriteProjectionStatuses.mockResolvedValueOnce({
      items: [
        {
          job_id: "550e8400-e29b-41d4-a716-446655440020",
          write_job_status: "succeeded",
          result_record_id: "550e8400-e29b-41d4-a716-446655440021",
          result_status: "insert_new",
          latest_refresh_job: {
            job_id: "550e8400-e29b-41d4-a716-446655440022",
            source_record_id: "550e8400-e29b-41d4-a716-446655440021",
            refresh_type: "insert",
            job_status: "succeeded",
            created_at: "2026-04-23T00:00:00.000Z",
            finished_at: "2026-04-23T00:00:01.000Z",
            error_message: null,
          },
          projection_ready: true,
        },
      ],
    });

    const runner = new AgentRunner({
      memoryClient: memoryClient as never,
      provider: {
        id: () => "ollama",
        model: () => "qwen2.5-coder",
        chat: async function* () {
          yield { type: "text_delta", text: "ok" } as const;
          yield {
            type: "end",
            finish_reason: "stop",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          } as const;
        },
      },
      tools: {
        listTools: () => [],
        invoke: vi.fn(),
      } as never,
      config: createConfig(),
      io,
    });

    await runner.start();
    await runner.submit("继续当前任务", "turn-projection-ready-1");
    await Promise.resolve();
    await runner.submit("继续当前任务", "turn-projection-ready-2");

    expect(memoryClient.getWriteProjectionStatuses).toHaveBeenCalledWith({
      job_ids: ["550e8400-e29b-41d4-a716-446655440020"],
    });
    expect(memoryClient.sessionStartContext).toHaveBeenCalledTimes(2);
  });
});

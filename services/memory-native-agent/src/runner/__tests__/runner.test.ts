import { describe, expect, it, vi } from "vitest";

import type { AgentConfig } from "../../config/index.js";
import { AgentRunner } from "../agent-runner.js";

function createIo() {
  return {
    emitAssistantDelta: vi.fn(),
    emitToolCallStart: vi.fn(),
    emitToolCallResult: vi.fn(),
    emitInjectionBanner: vi.fn(),
    emitPhaseResult: vi.fn(),
    emitTaskChange: vi.fn(),
    emitTurnEnd: vi.fn(),
    emitError: vi.fn(),
    requestConfirm: vi.fn(async () => "allow" as const),
  };
}

function createMemoryClient() {
  return {
    sessionStartContext: vi.fn(async () => ({
      trace_id: "trace-session",
      additional_context: "",
      active_task_summary: null,
      injection_block: null,
      memory_mode: "workspace_plus_global" as const,
      dependency_status: {
        read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
        embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
        storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
      },
      degraded: false,
    })),
    prepareContext: vi.fn(async ({ phase }: { phase: string }) => ({
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
      },
      budget_used: 0,
      memory_packet_ids: [],
    })),
    finalizeTurn: vi.fn(async () => ({
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
      },
    })),
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
    },
    mcp: { servers: [] },
    tools: {
      shellExec: {
        enabled: true,
        timeoutMs: 30_000,
        denyPatterns: [],
      },
    },
    cli: {
      systemPrompt: null,
    },
    streaming: {
      flushChars: 2,
      flushIntervalMs: 1_000,
    },
    locale: "zh-CN" as const,
  };
}

describe("AgentRunner", () => {
  it("runs before_response and finalizes a plain text turn", async () => {
    const io = createIo();
    const memoryClient = createMemoryClient();
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
    await runner.submit("继续这个任务", "turn-1");

    expect(io.emitInjectionBanner).toHaveBeenCalled();
    expect(io.emitAssistantDelta).toHaveBeenCalled();
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-1", "stop");
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
    );
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-error", "error");
    expect(io.emitError.mock.invocationCallOrder[0]!).toBeLessThan(io.emitTurnEnd.mock.invocationCallOrder[0]!);
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
    expect(saveDispatchedMessages).toHaveBeenCalledTimes(2);
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

  it("only finalizes turns when both user input and assistant output are present", async () => {
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
    await secondRunner.submit("继续", "turn-with-output");

    expect(finalizeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        turn_id: "turn-with-output",
        current_input: "继续",
        assistant_output: "hello",
      }),
    );
  });
});

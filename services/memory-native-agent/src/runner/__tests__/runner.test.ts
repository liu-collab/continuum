import { describe, expect, it, vi } from "vitest";

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

describe("AgentRunner", () => {
  it("runs before_response and finalizes a plain text turn", async () => {
    const io = createIo();
    const runner = new AgentRunner({
      memoryClient: {
        sessionStartContext: vi.fn(async () => ({
          trace_id: "trace-session",
          additional_context: "",
          active_task_summary: null,
          injection_block: null,
          memory_mode: "workspace_plus_global",
          dependency_status: {
            read_model: { name: "read_model", status: "healthy", detail: "", last_checked_at: "now" },
            embeddings: { name: "embeddings", status: "healthy", detail: "", last_checked_at: "now" },
            storage_writeback: { name: "storage_writeback", status: "healthy", detail: "", last_checked_at: "now" },
          },
          degraded: false,
        })),
        prepareContext: vi.fn(async ({ phase }) => ({
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
                memory_mode: "workspace_plus_global",
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
          memory_mode: "workspace_plus_global",
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
      } as never,
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
      config: {
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
          mode: "workspace_plus_global",
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
        locale: "zh-CN",
      },
      io,
    });

    await runner.start();
    await runner.submit("继续这个任务", "turn-1");

    expect(io.emitInjectionBanner).toHaveBeenCalled();
    expect(io.emitAssistantDelta).toHaveBeenCalled();
    expect(io.emitTurnEnd).toHaveBeenCalledWith("turn-1", "stop");
  });
});

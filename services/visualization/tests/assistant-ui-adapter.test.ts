import { describe, expect, it, vi } from "vitest";

import {
  createContinuumThreadStore,
  readContinuumMeta
} from "@/app/agent/_lib/assistant-ui-adapter";
import type { AgentTurnState } from "@/app/agent/_lib/event-reducer";

function createTurn(overrides: Partial<AgentTurnState> = {}): AgentTurnState {
  return {
    turnId: "turn-1",
    userInput: "查看一下项目结构",
    assistantOutput: "我先读取一下 README。",
    toolMessages: [],
    toolCalls: [],
    phases: [],
    injection: null,
    finishReason: "stop",
    promptAvailable: true,
    errors: [],
    taskLabel: null,
    status: "complete",
    ...overrides
  };
}

describe("assistant-ui adapter", () => {
  it("maps a turn into user and assistant messages with metadata", () => {
    const store = createContinuumThreadStore({
      turns: [
        createTurn({
          injection: {
            phase: "before_response",
            injection_reason: "workspace_recall",
            memory_summary: "恢复了 2 条工作区偏好",
            memory_records: []
          },
          phases: [
            {
              phase: "before_response",
              traceId: "trace-1",
              degraded: false,
              injectionSummary: "2 memories"
            }
          ]
        })
      ],
      isRunning: false,
      onSend: vi.fn(),
      onAbort: vi.fn()
    });

    expect(store.messages).toHaveLength(2);
    expect(store.messages?.[0]).toMatchObject({
      id: "turn-1:user",
      role: "user"
    });
    expect(store.messages?.[1]).toMatchObject({
      id: "turn-1:assistant",
      role: "assistant"
    });

    const assistantMeta = readContinuumMeta(store.messages?.[1]!);
    expect(assistantMeta?.turnId).toBe("turn-1");
    expect(assistantMeta?.injection?.memory_summary).toBe("恢复了 2 条工作区偏好");
    expect(assistantMeta?.phases[0]?.phase).toBe("before_response");
  });

  it("maps tool calls into assistant-ui tool-call parts", () => {
    const store = createContinuumThreadStore({
      turns: [
        createTurn({
          turnId: "turn-tool",
          finishReason: "tool_use",
          toolCalls: [
            {
              callId: "call-1",
              name: "fs_read",
              argsPreview: "{\"path\":\"README.md\"}",
              status: "ok",
              outputPreview: "读取成功",
              trustLevel: "builtin_read",
              artifactRef: null
            }
          ]
        })
      ],
      isRunning: false,
      onSend: vi.fn(),
      onAbort: vi.fn()
    });

    const assistant = store.messages?.[1];
    expect(assistant?.role).toBe("assistant");
    const toolCall = assistant?.content.find((part) => part.type === "tool-call");
    expect(toolCall).toMatchObject({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "fs_read",
      argsText: "{\"path\":\"README.md\"}",
      result: {
        ok: true,
        outputPreview: "读取成功"
      }
    });
  });

  it("maps streaming and error turns to assistant-ui statuses", () => {
    const store = createContinuumThreadStore({
      turns: [
        createTurn({
          turnId: "turn-stream",
          status: "streaming",
          finishReason: null
        }),
        createTurn({
          turnId: "turn-error",
          status: "error",
          finishReason: "error",
          errors: [
            {
              code: "provider_stream_error",
              message: "stream interrupted"
            }
          ]
        })
      ],
      isRunning: true,
      onSend: vi.fn(),
      onAbort: vi.fn()
    });

    expect(store.isRunning).toBe(true);
    expect(store.messages?.[1]?.status).toEqual({
      type: "running"
    });
    expect(store.messages?.[3]?.status).toEqual({
      type: "incomplete",
      reason: "error",
      error: "stream interrupted"
    });
  });

  it("extracts user text from append messages before forwarding", async () => {
    const onSend = vi.fn();
    const store = createContinuumThreadStore({
      turns: [],
      isRunning: false,
      onSend,
      onAbort: vi.fn()
    });

    await store.onNew({
      role: "user",
      parentId: null,
      sourceId: null,
      createdAt: new Date(),
      runConfig: {},
      attachments: [],
      metadata: {
        custom: {}
      },
      content: [
        {
          type: "text",
          text: "继续分析一下"
        }
      ]
    });

    expect(onSend).toHaveBeenCalledWith("继续分析一下");
  });
});

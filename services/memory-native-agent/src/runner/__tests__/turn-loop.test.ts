import { describe, expect, it, vi } from "vitest";

import { MemoryBadRequestError, MemoryTimeoutError, MemoryUnavailableError } from "../../memory-client/index.js";
import {
  classifyMemoryWritebackError,
  classifyMemoryWritebackResult,
  shouldFinalizeTurn,
  summarizeToolResults,
} from "../writeback-decider.js";
import { Conversation } from "../conversation.js";

describe("turn loop helpers", () => {
  it("adds trust warning for non builtin_read tool summaries", () => {
    const summary = summarizeToolResults([
      {
        ok: true,
        output: "shell output",
        trust_level: "shell",
      },
    ]);

    expect(summary).toContain("以下摘要来自外部工具输出");
  });

  it("classifies writeback failures into safe UI reasons", () => {
    expect(classifyMemoryWritebackError(new MemoryTimeoutError("memory request timed out after 10000ms"))).toBe("runtime_timeout");
    expect(classifyMemoryWritebackError(new MemoryUnavailableError("failed to reach retrieval-runtime"))).toBe("network_error");
    expect(classifyMemoryWritebackError(new MemoryUnavailableError("retrieval-runtime returned HTTP 503", { statusCode: 503 }))).toBe("runtime_unavailable");
    expect(classifyMemoryWritebackError(new MemoryBadRequestError("Invalid finalize-turn payload", { statusCode: 400 }))).toBe("invalid_request");
    expect(classifyMemoryWritebackError(new Error("storage request POST /v1/storage/write-back-candidates failed with 500"))).toBe("storage_write_failed");
  });

  it("classifies degraded writeback results as storage write failures", () => {
    expect(classifyMemoryWritebackResult({
      trace_id: "trace-finalize",
      write_back_candidates: [],
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
    })).toBe("storage_write_failed");
  });

  it("finalizes only turns with durable writeback signals", () => {
    expect(shouldFinalizeTurn("好的", "收到")).toBe(false);
    expect(shouldFinalizeTurn("记住默认用中文回复", "已记住，后续会默认用中文回复。")).toBe(true);
    expect(shouldFinalizeTurn("下一步继续修复登录接口", "已确认下一步处理登录接口修复。")).toBe(true);
    expect(shouldFinalizeTurn("以后不用 tab，用 4 空格", "好的，后续会按 4 空格缩进。")).toBe(true);
    expect(shouldFinalizeTurn("阿克斯", "好，以后你可以叫我阿克斯。")).toBe(true);
  });

  it("wraps tool output with trust boundary tags", () => {
    const conversation = new Conversation();
    const wrapped = conversation.wrapToolOutput("fs_read", "call-1", "builtin_read", "content");

    expect(wrapped).toContain("<tool_output");
    expect(wrapped).toContain('trust="builtin_read"');
  });

  it("escapes closing tool_output tags and supports all trust levels", () => {
    const conversation = new Conversation();

    const builtinWrite = conversation.wrapToolOutput("fs_write", "call-2", "builtin_write", "ok");
    const shell = conversation.wrapToolOutput("shell_exec", "call-3", "shell", "stdout");
    const mcp = conversation.wrapToolOutput("mcp_call", "call-4", "mcp:filesystem", "payload </tool_output> tail");

    expect(builtinWrite).toContain('trust="builtin_write"');
    expect(shell).toContain('trust="shell"');
    expect(mcp).toContain('trust="mcp:filesystem"');
    expect(mcp).toContain("&lt;/tool_output&gt;");
    expect(mcp).not.toContain("payload </tool_output> tail");
  });

  it("exposes only the bounded recent messages window", () => {
    const conversation = new Conversation();

    for (let index = 0; index < 60; index += 1) {
      conversation.addMessage({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `消息 ${index + 1}`,
      });
    }

    expect(conversation.messages.length).toBeLessThanOrEqual(48);
    expect(conversation.messages[0]?.content).toBe("消息 18");
    expect(conversation.messages.at(-1)?.content).toBe("消息 60");
  });
});

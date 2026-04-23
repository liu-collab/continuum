import { describe, expect, it, afterEach } from "vitest";
import { z } from "zod";

// resolveField 是 memory-bridge.mjs 唯一导出的函数
// 签名：resolveField(event, keys, envKey, label)
// 优先从 event 对象中按 keys 顺序找非空 string 值
// 找不到就从 process.env[envKey] 取
// 都没有就 throw Error
import { resolveField } from "../host-adapters/memory-claude-plugin/bin/memory-bridge.mjs";
import {
  prepareContextInputSchema,
  finalizeTurnInputSchema,
} from "../src/host-adapters/types.js";

describe("Claude Code bridge (memory-bridge.mjs)", () => {
  // ──────────────────────────────────────────────
  // resolveField 单元测试
  // ──────────────────────────────────────────────
  describe("resolveField", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("resolves from event object using first matching key", () => {
      const event = { session_id: "ses-123", sessionId: "ses-456" };
      const result = resolveField(
        event,
        ["session_id", "sessionId"],
        "MEMORY_SESSION_ID",
        "session_id",
      );
      expect(result).toBe("ses-123");
    });

    it("falls back to second key when first is absent", () => {
      const event = { sessionId: "ses-456" };
      const result = resolveField(
        event,
        ["session_id", "sessionId"],
        "MEMORY_SESSION_ID",
        "session_id",
      );
      expect(result).toBe("ses-456");
    });

    it("falls back to environment variable when event has no matching keys", () => {
      process.env.MEMORY_SESSION_ID = "env-ses-789";
      const event = {};
      const result = resolveField(
        event,
        ["session_id", "sessionId"],
        "MEMORY_SESSION_ID",
        "session_id",
      );
      expect(result).toBe("env-ses-789");
    });

    it("throws when neither event nor env has the value", () => {
      delete process.env.MEMORY_SESSION_ID;
      const event = {};
      expect(() =>
        resolveField(
          event,
          ["session_id", "sessionId"],
          "MEMORY_SESSION_ID",
          "session_id",
        ),
      ).toThrow(/missing required identity field/);
    });

    it("trims whitespace from resolved values", () => {
      const event = { user_id: "  uid-trim  " };
      const result = resolveField(
        event,
        ["user_id"],
        "MEMORY_USER_ID",
        "user_id",
      );
      expect(result).toBe("uid-trim");
    });

    it("skips empty string values in event", () => {
      process.env.MEMORY_USER_ID = "env-uid";
      const event = { user_id: "", userId: "  " };
      const result = resolveField(
        event,
        ["user_id", "userId"],
        "MEMORY_USER_ID",
        "user_id",
      );
      expect(result).toBe("env-uid");
    });
  });

  // ──────────────────────────────────────────────
  // payload 契约测试
  // 验证 bridge 产生的 payload 格式与 runtime API schema 保持一致
  // 通过手动构造与 bridge 相同逻辑的 payload，验证 zod schema 能 parse
  // ──────────────────────────────────────────────
  describe("payload contract verification", () => {
    // SessionStartRequest 在 types.ts 中只有 interface，没有 zod schema，
    // 这里内联一个与 interface 等价的 schema 做契约验证
    const sessionStartSchema = z.object({
      host: z.enum([
        "claude_code_plugin",
        "codex_app_server",
        "custom_agent",
        "memory_native_agent",
      ]),
      session_id: z.string().min(1),
      cwd: z.string().optional(),
      source: z.string().optional(),
      user_id: z.string().uuid(),
      workspace_id: z.string().uuid(),
      task_id: z.string().uuid().optional(),
      recent_context_summary: z.string().optional(),
      memory_mode: z
        .enum(["workspace_only", "workspace_plus_global"])
        .optional(),
    });

    it("session-start payload matches runtime schema", () => {
      // 模拟 bridge 的 buildSessionStartPayload 逻辑
      const event = {
        session_id: "ses-100",
        cwd: "C:/workspace",
        user_id: "550e8400-e29b-41d4-a716-446655440001",
        workspace_id: "550e8400-e29b-41d4-a716-446655440000",
      };
      const payload = {
        host: "claude_code_plugin" as const,
        session_id: event.session_id,
        cwd: event.cwd,
        source: "claude_hook",
        user_id: event.user_id,
        workspace_id: event.workspace_id,
        task_id: undefined,
        recent_context_summary: undefined,
        memory_mode: undefined,
      };

      const parsed = sessionStartSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it("prepare-context payload matches runtime schema", () => {
      const event = {
        workspace_id: "550e8400-e29b-41d4-a716-446655440000",
        user_id: "550e8400-e29b-41d4-a716-446655440001",
        session_id: "ses-100",
        thread_id: "th-1",
        turn_id: "tu-1",
        phase: "before_response",
        user_prompt: "帮我看看这段代码",
        cwd: "C:/workspace",
      };
      const payload = {
        host: "claude_code_plugin" as const,
        workspace_id: event.workspace_id,
        user_id: event.user_id,
        session_id: event.session_id,
        thread_id: event.thread_id,
        turn_id: event.turn_id,
        phase: event.phase as "before_response",
        current_input: event.user_prompt,
        cwd: event.cwd,
        source: "claude_hook",
      };

      const parsed = prepareContextInputSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it("finalize-turn payload matches runtime schema", () => {
      const payload = {
        host: "claude_code_plugin" as const,
        workspace_id: "550e8400-e29b-41d4-a716-446655440000",
        user_id: "550e8400-e29b-41d4-a716-446655440001",
        session_id: "ses-100",
        thread_id: "th-1",
        turn_id: "tu-1",
        current_input: "帮我看代码",
        assistant_output: "代码没问题",
        tool_results_summary: "read_file: success",
      };

      const parsed = finalizeTurnInputSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });
  });
});

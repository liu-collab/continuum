import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../src/host-adapters/claude-code-adapter.js";
import { CodexAppServerAdapter } from "../src/host-adapters/codex-app-server-adapter.js";
import type {
  FinalizeTurnRequest,
  PrepareContextInput,
  SessionStartRequest,
} from "../src/host-adapters/types.js";

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "session-abc",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

// ---------------------------------------------------------------------------
// Helper: generates adapter-level tests for both adapters sharing the same logic
// ---------------------------------------------------------------------------
function describeAdapter(
  name: string,
  AdapterClass: new () =>
    | InstanceType<typeof ClaudeCodeAdapter>
    | InstanceType<typeof CodexAppServerAdapter>,
  expectedHost: "claude_code_plugin" | "codex_app_server",
) {
  describe(name, () => {
    // ── toTriggerContext ──────────────────────────────────────────────
    describe("toTriggerContext", () => {
      it(`maps PrepareContextInput with all fields, host fixed to ${expectedHost}`, () => {
        const adapter = new AdapterClass();
        const input: PrepareContextInput = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          thread_id: "thread-1",
          turn_id: "turn-1",
          phase: "before_response",
          current_input: "what is the project structure?",
          recent_context_summary: "user asked about files",
          cwd: "/home/dev/project",
          source: "editor",
          memory_mode: "workspace_plus_global",
          injection_token_budget: 640,
        };

        const result = adapter.toTriggerContext(input);

        expect(result).toEqual({
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          thread_id: "thread-1",
          turn_id: "turn-1",
          phase: "before_response",
          current_input: "what is the project structure?",
          recent_context_summary: "user asked about files",
          cwd: "/home/dev/project",
          source: "editor",
          memory_mode: "workspace_plus_global",
          injection_token_budget: 640,
        });
      });

      it("maps SessionStartRequest with phase=session_start", () => {
        const adapter = new AdapterClass();
        const input: SessionStartRequest = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          recent_context_summary: "resuming previous work",
          cwd: "/home/dev/project",
          source: "cli",
          memory_mode: "workspace_only",
          injection_token_budget: 512,
        };

        const result = adapter.toTriggerContext(input);

        expect(result.host).toBe(expectedHost);
        expect(result.phase).toBe("session_start");
        expect(result.workspace_id).toBe(ids.workspace);
        expect(result.user_id).toBe(ids.user);
        expect(result.session_id).toBe(ids.session);
        expect(result.task_id).toBe(ids.task);
        expect(result.current_input).toBe("resuming previous work");
        expect(result.recent_context_summary).toBe("resuming previous work");
        expect(result.cwd).toBe("/home/dev/project");
        expect(result.source).toBe("cli");
        expect(result.memory_mode).toBe("workspace_only");
        expect(result.injection_token_budget).toBe(512);
      });

      it('uses "session start" as current_input when recent_context_summary is absent in SessionStartRequest', () => {
        const adapter = new AdapterClass();
        const input: SessionStartRequest = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
        };

        const result = adapter.toTriggerContext(input);

        expect(result.current_input).toBe("session start");
        expect(result.recent_context_summary).toBeUndefined();
      });

      it("uses recent_context_summary as current_input when provided in SessionStartRequest", () => {
        const adapter = new AdapterClass();
        const input: SessionStartRequest = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          recent_context_summary: "user was debugging auth module",
        };

        const result = adapter.toTriggerContext(input);

        expect(result.current_input).toBe("user was debugging auth module");
        expect(result.recent_context_summary).toBe(
          "user was debugging auth module",
        );
      });

      it("passes through optional fields: thread_id, turn_id, task_id, cwd, source, memory_mode", () => {
        const adapter = new AdapterClass();
        const input: PrepareContextInput = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          thread_id: "thread-42",
          turn_id: "turn-99",
          phase: "task_start",
          current_input: "start new task",
          cwd: "/opt/app",
          source: "vscode",
          memory_mode: "workspace_only",
          injection_token_budget: 300,
        };

        const result = adapter.toTriggerContext(input);

        expect(result.thread_id).toBe("thread-42");
        expect(result.turn_id).toBe("turn-99");
        expect(result.task_id).toBe(ids.task);
        expect(result.cwd).toBe("/opt/app");
        expect(result.source).toBe("vscode");
        expect(result.memory_mode).toBe("workspace_only");
        expect(result.injection_token_budget).toBe(300);
      });

      it("outputs undefined for absent optional fields", () => {
        const adapter = new AdapterClass();
        const input: PrepareContextInput = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          phase: "before_plan",
          current_input: "plan the refactor",
        };

        const result = adapter.toTriggerContext(input);

        expect(result.host).toBe(expectedHost);
        expect(result.phase).toBe("before_plan");
        expect(result.current_input).toBe("plan the refactor");
        expect(result.task_id).toBeUndefined();
        expect(result.thread_id).toBeUndefined();
        expect(result.turn_id).toBeUndefined();
        expect(result.cwd).toBeUndefined();
        expect(result.source).toBeUndefined();
        expect(result.recent_context_summary).toBeUndefined();
        expect(result.memory_mode).toBeUndefined();
        expect(result.injection_token_budget).toBeUndefined();
      });
    });

    // ── toFinalizeInput ──────────────────────────────────────────────
    describe("toFinalizeInput", () => {
      it(`maps all fields with host=${expectedHost}`, () => {
        const adapter = new AdapterClass();
        const input: FinalizeTurnRequest = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          thread_id: "thread-7",
          turn_id: "turn-3",
          current_input: "explain the auth flow",
          assistant_output: "The auth flow works as follows...",
          tool_results_summary: "read 3 files",
          memory_mode: "workspace_plus_global",
        };

        const result = adapter.toFinalizeInput(input);

        expect(result).toEqual({
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          thread_id: "thread-7",
          turn_id: "turn-3",
          current_input: "explain the auth flow",
          assistant_output: "The auth flow works as follows...",
          tool_results_summary: "read 3 files",
          memory_mode: "workspace_plus_global",
        });
      });

      it("passes through optional fields: thread_id, turn_id, task_id, tool_results_summary, memory_mode", () => {
        const adapter = new AdapterClass();

        // With all optional fields present
        const withOptionals: FinalizeTurnRequest = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          thread_id: "thread-x",
          turn_id: "turn-y",
          current_input: "do something",
          assistant_output: "done",
          tool_results_summary: "executed 2 tools",
          memory_mode: "workspace_only",
        };

        const resultWith = adapter.toFinalizeInput(withOptionals);
        expect(resultWith.task_id).toBe(ids.task);
        expect(resultWith.thread_id).toBe("thread-x");
        expect(resultWith.turn_id).toBe("turn-y");
        expect(resultWith.tool_results_summary).toBe("executed 2 tools");
        expect(resultWith.memory_mode).toBe("workspace_only");

        // Without optional fields
        const withoutOptionals: FinalizeTurnRequest = {
          host: expectedHost,
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          current_input: "just a question",
          assistant_output: "here is the answer",
        };

        const resultWithout = adapter.toFinalizeInput(withoutOptionals);
        expect(resultWithout.task_id).toBeUndefined();
        expect(resultWithout.thread_id).toBeUndefined();
        expect(resultWithout.turn_id).toBeUndefined();
        expect(resultWithout.tool_results_summary).toBeUndefined();
        expect(resultWithout.memory_mode).toBeUndefined();
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Run tests for both adapters
// ---------------------------------------------------------------------------
describeAdapter("ClaudeCodeAdapter", ClaudeCodeAdapter, "claude_code_plugin");
describeAdapter(
  "CodexAppServerAdapter",
  CodexAppServerAdapter,
  "codex_app_server",
);

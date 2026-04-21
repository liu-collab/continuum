import { describe, expect, it } from "vitest";

import { initialAgentState, reduceAgentEvent } from "@/app/agent/_lib/event-reducer";

describe("agent event reducer", () => {
  it("hydrates session messages into turns", () => {
    const state = reduceAgentEvent(initialAgentState, {
      type: "hydrate_session",
      session: {
        id: "session-1",
        workspace_id: "workspace-a",
        title: "Demo",
        memory_mode: "workspace_plus_global",
        locale: "zh-CN",
        created_at: "2026-04-18T10:00:00.000Z",
        last_active_at: "2026-04-18T10:00:00.000Z",
        closed_at: null
      },
      messages: [
        {
          id: "m1",
          session_id: "session-1",
          turn_id: "turn-1",
          role: "user",
          content: "hello",
          tool_call_id: null,
          token_in: null,
          token_out: null,
          created_at: "2026-04-18T10:00:00.000Z"
        },
        {
          id: "m2",
          session_id: "session-1",
          turn_id: "turn-1",
          role: "assistant",
          content: "world",
          tool_call_id: null,
          token_in: 1,
          token_out: 2,
          created_at: "2026-04-18T10:00:01.000Z"
        }
      ]
    });

    expect(state.sessionId).toBe("session-1");
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.userInput).toBe("hello");
    expect(state.turns[0]?.assistantOutput).toBe("world");
    expect(state.connection).toBe("connecting");
  });

  it("collects websocket events into current turn state", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "user_turn_submitted",
      turnId: "turn-2",
      text: "create summary"
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "phase_result",
        turn_id: "turn-2",
        phase: "before_response",
        trace_id: "trace-2",
        degraded: false,
        injection_summary: "1 memory injected"
      }
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "tool_confirm_needed",
        confirm_id: "confirm-1",
        call_id: "call-1",
        tool: "shell_exec",
        params_preview: "npm test",
        risk_hint: "shell"
      }
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "assistant_delta",
        turn_id: "turn-2",
        text: "done"
      }
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "turn_end",
        turn_id: "turn-2",
        finish_reason: "stop"
      }
    });

    expect(state.pendingConfirm?.tool).toBe("shell_exec");
    expect(state.turns[0]?.assistantOutput).toBe("done");
    expect(state.turns[0]?.phases[0]?.phase).toBe("before_response");
    expect(state.turns[0]?.status).toBe("complete");
    expect(state.pendingConfirm).toEqual({
      confirmId: "confirm-1",
      callId: "call-1",
      tool: "shell_exec",
      paramsPreview: "npm test",
      riskHint: "shell"
    });
  });

  it("keeps pending turn state until turn_end after a turn error", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "user_turn_submitted",
      turnId: "turn-error",
      text: "stream then fail"
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "error",
        scope: "turn",
        code: "provider_stream_error",
        message: "stream interrupted"
      }
    });

    expect(state.turns[0]?.status).toBe("error");
    expect(state.turns[0]?.finishReason).toBeNull();
    expect(state.turns[0]?.errors).toEqual([
      {
        code: "provider_stream_error",
        message: "stream interrupted"
      }
    ]);

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "turn_end",
        turn_id: "turn-error",
        finish_reason: "error"
      }
    });

    expect(state.turns[0]?.finishReason).toBe("error");
    expect(state.turns[0]?.status).toBe("error");
  });

  it("updates session metadata from session_started without dropping turns", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "hydrate_session",
      session: {
        id: "session-1",
        workspace_id: "workspace-a",
        title: "Demo",
        memory_mode: "workspace_plus_global",
        locale: "zh-CN",
        created_at: "2026-04-18T10:00:00.000Z",
        last_active_at: "2026-04-18T10:00:00.000Z",
        closed_at: null
      },
      messages: [
        {
          id: "m1",
          session_id: "session-1",
          turn_id: "turn-1",
          role: "user",
          content: "hello",
          tool_call_id: null,
          token_in: null,
          token_out: null,
          created_at: "2026-04-18T10:00:00.000Z"
        }
      ]
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "session_started",
        session_id: "session-2",
        workspace_id: "workspace-b",
        memory_mode: "workspace_only",
        locale: "en-US"
      }
    });

    expect(state.sessionId).toBe("session-2");
    expect(state.session?.id).toBe("session-2");
    expect(state.session?.workspace_id).toBe("workspace-b");
    expect(state.session?.memory_mode).toBe("workspace_only");
    expect(state.locale).toBe("en-US");
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.userInput).toBe("hello");
  });

  it("tracks task changes in activeTask and recentTasks", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "user_turn_submitted",
      turnId: "turn-task",
      text: "switch task"
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "task_change",
        turn_id: "turn-task",
        change: "start",
        task_id: "task-1",
        label: "Task one"
      }
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "task_change",
        turn_id: "turn-task",
        change: "switch",
        task_id: "task-2",
        label: "Task two",
        previous_task_id: "task-1"
      }
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "task_change",
        turn_id: "turn-task",
        change: "resume",
        task_id: "task-1",
        label: "Task one",
        previous_task_id: "task-2"
      }
    });

    expect(state.activeTask).toEqual({
      change: "resume",
      taskId: "task-1",
      label: "Task one",
      previousTaskId: "task-2"
    });
    expect(state.recentTasks).toEqual([
      {
        change: "resume",
        taskId: "task-1",
        label: "Task one",
        previousTaskId: "task-2"
      },
      {
        change: "switch",
        taskId: "task-2",
        label: "Task two",
        previousTaskId: "task-1"
      }
    ]);
    expect(state.turns[0]?.taskLabel).toBe("Task one");
  });

  it("keeps recentTasks deduped and capped at eight entries", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "user_turn_submitted",
      turnId: "turn-task-limit",
      text: "switch tasks"
    });

    for (let index = 1; index <= 9; index += 1) {
      state = reduceAgentEvent(state, {
        type: "server_event",
        event: {
          kind: "task_change",
          turn_id: "turn-task-limit",
          change: "switch",
          task_id: `task-${index}`,
          label: `Task ${index}`,
          previous_task_id: index > 1 ? `task-${index - 1}` : undefined
        }
      });
    }

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "task_change",
        turn_id: "turn-task-limit",
        change: "resume",
        task_id: "task-5",
        label: "Task 5",
        previous_task_id: "task-9"
      }
    });

    expect(state.recentTasks).toHaveLength(8);
    expect(state.recentTasks[0]).toMatchObject({
      taskId: "task-5",
      change: "resume"
    });
    expect(state.recentTasks.some((entry) => entry.taskId === "task-1")).toBe(false);
    expect(state.recentTasks.filter((entry) => entry.taskId === "task-5")).toHaveLength(1);
  });

  it("marks replay gaps without clearing accumulated state", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "user_turn_submitted",
      turnId: "turn-gap",
      text: "hello"
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "assistant_delta",
        turn_id: "turn-gap",
        text: "partial"
      }
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "replay_gap",
        last_event_id: 12
      }
    });

    expect(state.replayGapDetected).toBe(true);
    expect(state.turns[0]?.assistantOutput).toBe("partial");
  });

  it("does not create a fake turn from session_start replay events", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "hydrate_session",
      session: {
        id: "session-bootstrap",
        workspace_id: "workspace-a",
        title: "Demo",
        memory_mode: "workspace_plus_global",
        locale: "zh-CN",
        created_at: "2026-04-18T10:00:00.000Z",
        last_active_at: "2026-04-18T10:00:00.000Z",
        closed_at: null
      },
      messages: []
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "phase_result",
        turn_id: "session-bootstrap",
        phase: "session_start",
        trace_id: "trace-bootstrap",
        degraded: false
      }
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "injection_banner",
        turn_id: "session-bootstrap",
        degraded: false,
        injection: {
          phase: "session_start",
          injection_reason: "restore",
          memory_summary: "summary",
          memory_records: []
        }
      }
    });

    expect(state.turns).toHaveLength(0);
  });

  it("stores session scope errors separately from turn errors", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "user_turn_submitted",
      turnId: "turn-session-error",
      text: "hello"
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "error",
        scope: "session",
        code: "session_store_unavailable",
        message: "session store unavailable"
      }
    });

    expect(state.sessionError).toBe("session store unavailable");
    expect(state.sessionErrorCode).toBe("session_store_unavailable");
    expect(state.turns[0]?.errors).toEqual([]);
  });

  it("keeps artifact references from tool results", () => {
    let state = reduceAgentEvent(initialAgentState, {
      type: "server_event",
      event: {
        kind: "tool_call_start",
        turn_id: "turn-artifact",
        call_id: "call-1",
        name: "shell_exec",
        args_preview: "npm test"
      }
    });

    state = reduceAgentEvent(state, {
      type: "server_event",
      event: {
        kind: "tool_call_result",
        call_id: "call-1",
        ok: true,
        output_preview: "done",
        artifact_ref: "session-1/call-1.txt",
        trust_level: "shell"
      }
    });

    expect(state.turns[0]?.toolCalls[0]).toMatchObject({
      callId: "call-1",
      artifactRef: "session-1/call-1.txt",
      trustLevel: "shell"
    });
  });
});

import { describe, expect, it } from "vitest";

import { initialAgentState, reduceAgentEvent } from "@/app/agent/_lib/event-reducer";

describe("agent event reducer", () => {
  it("hydrates session messages into turns", () => {
    const state = reduceAgentEvent(initialAgentState, {
      type: "hydrate_session",
      session: {
        id: "session-1",
        workspace_id: "workspace-a",
        user_id: "user-a",
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
  });
});

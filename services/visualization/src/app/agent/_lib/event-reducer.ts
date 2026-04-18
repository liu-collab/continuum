import type { AgentTokenBootstrapResponse } from "@/lib/contracts";

import type {
  AgentConnectionState,
  AgentLocale,
  AgentMemoryMode,
  AgentToolTrustLevel,
  MnaInjectionBlock,
  MnaServerEventEnvelope,
  MnaSessionDetail,
  MnaSessionMessage,
  MnaSessionSummary
} from "./openapi-types";

export type AgentToolCallState = {
  callId: string;
  name: string;
  argsPreview: string;
  status: "pending" | "ok" | "error";
  outputPreview: string;
  trustLevel: AgentToolTrustLevel | null;
  artifactRef: string | null;
};

export type AgentTurnState = {
  turnId: string;
  userInput: string;
  assistantOutput: string;
  toolMessages: string[];
  toolCalls: AgentToolCallState[];
  phases: Array<{
    phase: string;
    traceId: string | null;
    degraded: boolean;
    injectionSummary?: string;
  }>;
  injection: MnaInjectionBlock | null;
  finishReason: string | null;
  promptAvailable: boolean;
  errors: Array<{
    code: string;
    message: string;
  }>;
  taskLabel: string | null;
  status: "idle" | "streaming" | "complete" | "error";
};

export type AgentPendingConfirm = {
  confirmId: string;
  callId: string;
  tool: string;
  paramsPreview: string;
  riskHint?: "write" | "shell" | "mcp";
};

export type AgentTaskEntry = {
  change: "start" | "switch" | "resume";
  taskId: string | null;
  label: string;
  previousTaskId?: string | null;
};

export type AgentState = {
  bootstrapStatus: "loading" | AgentTokenBootstrapResponse["status"];
  bootstrapReason: string | null;
  sessionId: string | null;
  session: MnaSessionDetail | null;
  sessionList: MnaSessionSummary[];
  connection: AgentConnectionState;
  degraded: boolean;
  turns: AgentTurnState[];
  pendingConfirm: AgentPendingConfirm | null;
  locale: AgentLocale;
  activeTask: AgentTaskEntry | null;
  recentTasks: AgentTaskEntry[];
  replayGapDetected: boolean;
  sessionError: string | null;
};

export type AgentEvent =
  | { type: "bootstrap_loaded"; bootstrapStatus: AgentState["bootstrapStatus"]; reason: string | null }
  | { type: "hydrate_session"; session: MnaSessionDetail; messages: MnaSessionMessage[] }
  | { type: "session_list_loaded"; items: MnaSessionSummary[] }
  | { type: "connection_changed"; connection: AgentConnectionState }
  | { type: "user_turn_submitted"; turnId: string; text: string }
  | { type: "pending_confirm_cleared" }
  | { type: "session_title_updated"; sessionId: string; title: string }
  | { type: "session_mode_updated"; sessionId: string; memoryMode: AgentMemoryMode }
  | { type: "session_removed"; sessionId: string }
  | { type: "server_event"; event: MnaServerEventEnvelope };

export const initialAgentState: AgentState = {
  bootstrapStatus: "loading",
  bootstrapReason: null,
  sessionId: null,
  session: null,
  sessionList: [],
  connection: "closed",
  degraded: false,
  turns: [],
  pendingConfirm: null,
  locale: "zh-CN",
  activeTask: null,
  recentTasks: [],
  replayGapDetected: false,
  sessionError: null
};

export function reduceAgentEvent(state: AgentState, event: AgentEvent): AgentState {
  switch (event.type) {
    case "bootstrap_loaded":
      return {
        ...state,
        bootstrapStatus: event.bootstrapStatus,
        bootstrapReason: event.reason
      };
    case "hydrate_session":
      return {
        ...state,
        sessionId: event.session.id,
        session: event.session,
        locale: event.session.locale,
        turns: hydrateTurnsFromMessages(event.messages),
        degraded: false,
        sessionError: null
      };
    case "session_list_loaded":
      return {
        ...state,
        sessionList: event.items
      };
    case "connection_changed":
      return {
        ...state,
        connection: event.connection
      };
    case "user_turn_submitted":
      return {
        ...state,
        turns: upsertTurn(state.turns, event.turnId, (turn) => ({
          ...turn,
          turnId: event.turnId,
          userInput: event.text,
          promptAvailable: true,
          status: "streaming"
        })),
        sessionError: null
      };
    case "pending_confirm_cleared":
      return {
        ...state,
        pendingConfirm: null
      };
    case "session_title_updated":
      return {
        ...state,
        session:
          state.session?.id === event.sessionId
            ? {
                ...state.session,
                title: event.title
              }
            : state.session,
        sessionList: state.sessionList.map((item) =>
          item.id === event.sessionId
            ? {
                ...item,
                title: event.title
              }
            : item
        )
      };
    case "session_mode_updated":
      return {
        ...state,
        session:
          state.session?.id === event.sessionId
            ? {
                ...state.session,
                memory_mode: event.memoryMode
              }
            : state.session,
        sessionList: state.sessionList.map((item) =>
          item.id === event.sessionId
            ? {
                ...item,
                memory_mode: event.memoryMode
              }
            : item
        )
      };
    case "session_removed":
      return {
        ...state,
        sessionList: state.sessionList.filter((item) => item.id !== event.sessionId)
      };
    case "server_event":
      return reduceServerEvent(state, event.event);
  }
}

function reduceServerEvent(state: AgentState, event: MnaServerEventEnvelope): AgentState {
  switch (event.kind) {
    case "session_started":
      return {
        ...state,
        sessionId: event.session_id,
        session: state.session
          ? {
              ...state.session,
              id: event.session_id,
              memory_mode: event.memory_mode,
              workspace_id: event.workspace_id,
              locale: event.locale
            }
          : state.session,
        locale: event.locale
      };
    case "assistant_delta":
      return {
        ...state,
        turns: upsertTurn(state.turns, event.turn_id, (turn) => ({
          ...turn,
          assistantOutput: `${turn.assistantOutput}${event.text}`,
          status: "streaming"
        }))
      };
    case "tool_call_start":
      return {
        ...state,
        turns: upsertTurn(state.turns, event.turn_id, (turn) => ({
          ...turn,
          toolCalls: [
            ...turn.toolCalls,
            {
              callId: event.call_id,
              name: event.name,
              argsPreview: event.args_preview,
              status: "pending",
              outputPreview: "",
              trustLevel: null,
              artifactRef: null
            }
          ]
        }))
      };
    case "tool_call_result":
      return {
        ...state,
        turns: state.turns.map((turn) => ({
          ...turn,
          toolCalls: turn.toolCalls.map((call) =>
            call.callId === event.call_id
              ? {
                  ...call,
                  status: event.ok ? "ok" : "error",
                  outputPreview: event.output_preview,
                  trustLevel: event.trust_level,
                  artifactRef: event.artifact_ref ?? null
                }
              : call
          )
        }))
      };
    case "injection_banner":
      return {
        ...state,
        degraded: state.degraded || event.degraded,
        turns: upsertTurn(state.turns, event.turn_id, (turn) => ({
          ...turn,
          injection: event.injection,
          status: turn.status === "idle" ? "streaming" : turn.status
        }))
      };
    case "phase_result":
      return {
        ...state,
        degraded: state.degraded || event.degraded,
        turns: upsertTurn(state.turns, event.turn_id, (turn) => ({
          ...turn,
          phases: dedupePhases([
            ...turn.phases,
            {
              phase: event.phase,
              traceId: event.trace_id,
              degraded: event.degraded,
              injectionSummary: event.injection_summary
            }
          ])
        }))
      };
    case "task_change": {
      const task = {
        change: event.change,
        taskId: event.task_id ?? null,
        label: event.label,
        previousTaskId: event.previous_task_id
      } satisfies AgentTaskEntry;

      return {
        ...state,
        activeTask: task,
        recentTasks: [task, ...state.recentTasks.filter((item) => item.taskId !== task.taskId)].slice(0, 8),
        turns: upsertTurn(state.turns, event.turn_id, (turn) => ({
          ...turn,
          taskLabel: event.label
        }))
      };
    }
    case "turn_end":
      return {
        ...state,
        turns: upsertTurn(state.turns, event.turn_id, (turn) => ({
          ...turn,
          finishReason: event.finish_reason,
          status: event.finish_reason === "error" ? "error" : "complete"
        }))
      };
    case "error":
      return event.scope === "turn"
        ? {
            ...state,
            turns: attachErrorToLatestTurn(state.turns, event.code, event.message)
          }
        : {
            ...state,
            sessionError: event.message
          };
    case "tool_confirm_needed":
      return {
        ...state,
        pendingConfirm: {
          confirmId: event.confirm_id,
          callId: event.call_id,
          tool: event.tool,
          paramsPreview: event.params_preview,
          riskHint: event.risk_hint
        }
      };
    case "replay_gap":
      return {
        ...state,
        replayGapDetected: true
      };
    case "pong":
      return state;
  }
}

function hydrateTurnsFromMessages(messages: MnaSessionMessage[]): AgentTurnState[] {
  const grouped = new Map<string, AgentTurnState>();

  for (const message of messages) {
    const turn = grouped.get(message.turn_id) ?? createEmptyTurn(message.turn_id);

    if (message.role === "user" && !turn.userInput) {
      turn.userInput = message.content;
    }

    if (message.role === "assistant") {
      turn.assistantOutput = `${turn.assistantOutput}${message.content}`;
    }

    if (message.role === "tool") {
      turn.toolMessages.push(message.content);
    }

    turn.promptAvailable = true;
    grouped.set(message.turn_id, turn);
  }

  return Array.from(grouped.values());
}

function dedupePhases(phases: AgentTurnState["phases"]) {
  const seen = new Set<string>();
  return phases.filter((phase) => {
    const key = `${phase.phase}:${phase.traceId ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function attachErrorToLatestTurn(turns: AgentTurnState[], code: string, message: string) {
  const nextTurns = [...turns];
  const latestIndex = nextTurns.length - 1;

  if (latestIndex < 0) {
    return nextTurns;
  }

  const latest = nextTurns[latestIndex];
  if (!latest) {
    return nextTurns;
  }

  nextTurns[latestIndex] = {
    ...latest,
    status: "error",
    errors: [...latest.errors, { code, message }]
  };

  return nextTurns;
}

function upsertTurn(
  turns: AgentTurnState[],
  turnId: string,
  updater: (turn: AgentTurnState) => AgentTurnState
) {
  const index = turns.findIndex((turn) => turn.turnId === turnId);
  if (index === -1) {
    return [...turns, updater(createEmptyTurn(turnId))];
  }

  return turns.map((turn, currentIndex) => (currentIndex === index ? updater(turn) : turn));
}

function createEmptyTurn(turnId: string): AgentTurnState {
  return {
    turnId,
    userInput: "",
    assistantOutput: "",
    toolMessages: [],
    toolCalls: [],
    phases: [],
    injection: null,
    finishReason: null,
    promptAvailable: false,
    errors: [],
    taskLabel: null,
    status: "idle"
  };
}

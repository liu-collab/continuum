export type AgentConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export type AgentState = {
  sessionId: string | null;
  connection: AgentConnectionState;
  degraded: boolean;
};

export type AgentEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "connection_changed"; connection: AgentConnectionState }
  | { type: "degraded"; degraded: boolean };

export function reduceAgentEvent(state: AgentState, event: AgentEvent): AgentState {
  switch (event.type) {
    case "session_started":
      return { ...state, sessionId: event.sessionId };
    case "connection_changed":
      return { ...state, connection: event.connection };
    case "degraded":
      return { ...state, degraded: event.degraded };
  }
}

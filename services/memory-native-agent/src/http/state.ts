import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { AgentConfig } from "../config/index.js";
import { McpRegistry } from "../mcp-client/index.js";
import { MemoryClient } from "../memory-client/index.js";
import { createProvider, type ChatMessage, type IModelProvider } from "../providers/index.js";
import { AgentRunner, type RunnerIO } from "../runner/index.js";
import { SqliteSessionStore, type SessionStore } from "../session-store/index.js";
import { createDefaultToolDispatcher, type ToolDispatcher, type ToolResult } from "../tools/index.js";
import type { MemoryMode } from "../config/schema.js";
import { resolveArtifactsRoot, resolveMnaHomeDirectory } from "../shared/token.js";

export interface ServerEventEnvelope {
  id: number;
  createdAt: number;
  payload: Record<string, unknown>;
}

export interface SessionState {
  sessionId: string;
  workspaceId: string;
  memoryMode: MemoryMode;
  locale: AgentConfig["locale"];
  runner: AgentRunner;
  events: ServerEventEnvelope[];
  nextEventId: number;
  pendingConfirms: Map<string, (decision: "allow" | "deny" | "allow_session") => void>;
  sockets: Set<{ send(data: string): void }>;
}

export interface ServerMetrics {
  startedAt: number;
  turnsTotal: number;
  turnsByFinishReason: Record<string, number>;
  providerCallsTotal: Record<string, number>;
  providerErrorsTotal: Record<string, number>;
  toolInvocationsTotal: Record<string, number>;
  toolDenialsTotal: Record<string, number>;
  streamFlushedEventsTotal: number;
  streamDroppedAfterAbortTotal: number;
  runtimeErrorsTotal: Record<string, number>;
}

export interface MnaRuntimeState {
  config: AgentConfig;
  memoryClient: MemoryClient;
  provider: IModelProvider;
  mcpRegistry: McpRegistry;
  store: SessionStore;
  tools: ToolDispatcher;
  sessions: Map<string, SessionState>;
  metrics: ServerMetrics;
  artifactsRoot: string;
}

export interface RuntimeStateOptions {
  homeDirectory?: string;
}

const SESSION_EVENT_BUFFER_LIMIT = 200;
const SESSION_EVENT_TTL_MS = 10 * 60 * 1000;

export function createRuntimeState(config: AgentConfig, options: RuntimeStateOptions = {}): MnaRuntimeState {
  const artifactsRoot = resolveArtifactsRoot(options.homeDirectory);
  fs.mkdirSync(artifactsRoot, { recursive: true });

  const store = new SqliteSessionStore({
    dbPath: path.join(resolveMnaHomeDirectory(options.homeDirectory), "sessions.db"),
    artifactsRoot,
  });
  store.markInterruptedTurnsAsCrashed();

  const mcpRegistry = new McpRegistry();
  for (const server of config.mcp.servers) {
    void mcpRegistry.addServer(server).catch(() => undefined);
  }

  return {
    config,
    memoryClient: new MemoryClient({
      baseUrl: config.runtime.baseUrl,
      requestTimeoutMs: config.runtime.requestTimeoutMs,
      finalizeTimeoutMs: config.runtime.finalizeTimeoutMs,
    }),
    provider: createProvider(config.provider),
    mcpRegistry,
    store,
    tools: createDefaultToolDispatcher({
      config,
      mcpRegistry,
      sessionStore: store,
      artifactsRoot,
    }),
    sessions: new Map(),
    metrics: {
      startedAt: Date.now(),
      turnsTotal: 0,
      turnsByFinishReason: {},
      providerCallsTotal: {},
      providerErrorsTotal: {},
      toolInvocationsTotal: {},
      toolDenialsTotal: {},
      streamFlushedEventsTotal: 0,
      streamDroppedAfterAbortTotal: 0,
      runtimeErrorsTotal: {},
    },
    artifactsRoot,
  };
}

export function createSessionState(state: MnaRuntimeState, sessionId: string): SessionState {
  const persistedSession = state.store.getSession(sessionId);
  const memoryMode = persistedSession?.memory_mode ?? state.config.memory.mode;
  const workspaceId = persistedSession?.workspace_id ?? state.config.memory.workspaceId;
  const locale = persistedSession?.locale ?? state.config.locale;
  const session: SessionState = {
    sessionId,
    workspaceId,
    memoryMode,
    locale,
    runner: null as unknown as AgentRunner,
    events: [],
    nextEventId: 1,
    pendingConfirms: new Map(),
    sockets: new Set(),
  };

  session.runner = new AgentRunner({
      memoryClient: state.memoryClient,
      provider: state.provider,
      tools: state.tools,
      config: {
        ...state.config,
        memory: {
          ...state.config.memory,
          mode: memoryMode,
          workspaceId,
        },
        locale,
      },
      io: createRunnerIo(state, session),
      store: state.store,
      sessionId,
      initialMessages: loadInitialMessages(state.store, sessionId),
  });

  state.sessions.set(sessionId, session);
  return session;
}

export function pushSessionEvent(session: SessionState, payload: Record<string, unknown>) {
  pruneSessionEvents(session, Date.now());

  const event = {
    id: session.nextEventId,
    createdAt: Date.now(),
    payload,
  } satisfies ServerEventEnvelope;

  session.events.push(event);
  session.nextEventId += 1;

  if (session.events.length > SESSION_EVENT_BUFFER_LIMIT) {
    session.events.splice(0, session.events.length - SESSION_EVENT_BUFFER_LIMIT);
  }

  for (const socket of session.sockets) {
    socket.send(JSON.stringify({
      event_id: event.id,
      ...event.payload,
    }));
  }
}

export function createConfirmId(): string {
  return randomUUID();
}

export function getSessionReplayFromEventId(session: SessionState, lastEventId?: number): {
  events: ServerEventEnvelope[];
  gapDetected: boolean;
} {
  pruneSessionEvents(session, Date.now());

  if (lastEventId === undefined) {
    return {
      events: [...session.events],
      gapDetected: false,
    };
  }

  const nextEvents = session.events.filter((event) => event.id > lastEventId);
  const oldestEventId = session.events[0]?.id;
  const gapDetected = oldestEventId !== undefined && lastEventId + 1 < oldestEventId;

  return {
    events: nextEvents,
    gapDetected,
  };
}

export function updateSessionMode(state: MnaRuntimeState, sessionId: string, memoryMode: MemoryMode) {
  state.store.updateSession(sessionId, {
    memory_mode: memoryMode,
  });

  const session = state.sessions.get(sessionId);
  if (!session) {
    return;
  }

  session.memoryMode = memoryMode;
  session.runner = new AgentRunner({
    memoryClient: state.memoryClient,
    provider: state.provider,
      tools: state.tools,
    config: {
      ...state.config,
      memory: {
        ...state.config.memory,
        mode: memoryMode,
        workspaceId: session.workspaceId,
      },
      locale: session.locale,
    },
    io: createRunnerIo(state, session),
    store: state.store,
    sessionId,
    initialMessages: loadInitialMessages(state.store, sessionId),
  });
}

function createRunnerIo(state: MnaRuntimeState, session: SessionState): RunnerIO {
  return {
    emitAssistantDelta(turnId, text) {
      state.metrics.streamFlushedEventsTotal += 1;
      pushSessionEvent(session, {
        kind: "assistant_delta",
        turn_id: turnId,
        text,
      });
    },
    emitToolCallStart(turnId, call) {
      incrementCounter(state.metrics.toolInvocationsTotal, call.name);
      pushSessionEvent(session, {
        kind: "tool_call_start",
        turn_id: turnId,
        call_id: call.id,
        name: call.name,
        args_preview: JSON.stringify(call.args).slice(0, 256),
      });
    },
    emitToolCallResult(callId, result) {
      if (result.permission_decision === "denied" || result.permission_decision === "timeout" || result.permission_decision === "blocked_pattern") {
        incrementCounter(state.metrics.toolDenialsTotal, result.permission_decision);
      }

      pushSessionEvent(session, {
        kind: "tool_call_result",
        call_id: callId,
        ok: result.ok,
        output_preview: result.output.slice(0, 1024),
        artifact_ref: result.artifact_ref,
        trust_level: result.trust_level,
      });
    },
    emitInjectionBanner(turnId, injection, degraded) {
      pushSessionEvent(session, {
        kind: "injection_banner",
        turn_id: turnId,
        injection,
        degraded,
      });
    },
    emitPhaseResult(turnId, phase, resp) {
      pushSessionEvent(session, {
        kind: "phase_result",
        turn_id: turnId,
        phase,
        trace_id: resp && "trace_id" in resp ? resp.trace_id : null,
        degraded: Boolean(resp && "degraded" in resp && resp.degraded),
        injection_summary: resp && "injection_block" in resp && resp.injection_block ? resp.injection_block.memory_summary : undefined,
      });
    },
    emitTaskChange(turnId, change) {
      pushSessionEvent(session, {
        kind: "task_change",
        turn_id: turnId,
        ...change,
      });
    },
    emitTurnEnd(turnId, finishReason) {
      state.metrics.turnsTotal += 1;
      incrementCounter(state.metrics.turnsByFinishReason, finishReason);
      pushSessionEvent(session, {
        kind: "turn_end",
        turn_id: turnId,
        finish_reason: finishReason,
      });
    },
    emitError(scope, err) {
      incrementCounter(state.metrics.runtimeErrorsTotal, err.code ?? "unknown");
      pushSessionEvent(session, {
        kind: "error",
        scope,
        code: err.code ?? "unknown",
        message: err.message,
      });
    },
    requestConfirm(payload) {
      const confirmId = createConfirmId();
      return new Promise((resolve) => {
        session.pendingConfirms.set(confirmId, resolve);
        pushSessionEvent(session, {
          kind: "tool_confirm_needed",
          confirm_id: confirmId,
          ...payload,
        });
      });
    },
  };
}

function loadInitialMessages(store: SessionStore, sessionId: string): ChatMessage[] {
  return store.getMessages(sessionId).map((message) => ({
    role: message.role,
    content: message.content,
    tool_call_id: message.tool_call_id ?? undefined,
  }));
}

function incrementCounter(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function pruneSessionEvents(session: SessionState, now: number) {
  const ttlCutoff = now - SESSION_EVENT_TTL_MS;
  while (session.events[0] && session.events[0].createdAt < ttlCutoff) {
    session.events.shift();
  }
}

import { ZodError, z } from "zod";
import { URL } from "node:url";

import { decodeClientEvent, encodeGapDetectedEvent, encodeServerEvent } from "./event-codec.js";
import { createSessionState, getSessionReplayFromEventId } from "../state.js";
import { materializeSkillContext, resolveSkillInvocation, SkillError } from "../../skills/index.js";
import type { RuntimeFastifyInstance } from "../types.js";
import type { WebSocketLike } from "../ws-types.js";
import type { ClientEvent } from "./event-codec.js";
import type { SessionState } from "../state.js";

const WS_OPEN = 1;

const wsQuerySchema = z.object({
  token: z.string().optional(),
  last_event_id: z.coerce.number().int().min(0).optional(),
});

export function registerSessionWebsocket(app: RuntimeFastifyInstance) {
  app.get("/v1/agent/sessions/:id/ws", { websocket: true }, async (socket, request) => {
    const ws = socket as unknown as WebSocketLike;
    const parsed = parseWebsocketRequest(request.raw.url ?? request.url, request.params, request.query);
    if (!parsed.ok) {
      sendAndClose(ws, {
        kind: "error",
        scope: "session",
        code: parsed.code,
        message: parsed.message,
      }, 1008);
      return;
    }

    const { params, query } = parsed;
    if (!query.token || query.token !== app.mnaToken) {
      sendAndClose(ws, {
        kind: "error",
        scope: "session",
        code: "token_invalid",
        message: "Invalid or missing token.",
      }, 1008);
      return;
    }

    const existingSession = app.runtimeState.store.getSession(params.id);
    if (!existingSession) {
      sendAndClose(ws, {
        kind: "error",
        scope: "session",
        code: "session_not_found",
        message: "Session not found.",
      }, 1008);
      return;
    }

    const session = app.runtimeState.sessions.get(params.id) ?? await createSessionState(app.runtimeState, params.id);
    session.sockets.add(ws);
    safeSend(session, ws, JSON.stringify({
      kind: "session_started",
      session_id: session.sessionId,
      memory_mode: session.memoryMode,
      workspace_id: session.workspaceId,
      locale: session.locale,
    }));

    const replay = getSessionReplayFromEventId(session, query.last_event_id);
    if (replay.gapDetected && query.last_event_id !== undefined) {
      safeSend(session, ws, encodeGapDetectedEvent(query.last_event_id));
    }

    for (const event of replay.events) {
      safeSend(session, ws, encodeServerEvent(event.id, event.payload));
    }

    ws.on("close", () => {
      session.sockets.delete(ws);
    });

    ws.on("error", () => {
      session.sockets.delete(ws);
    });

    ws.on("message", (raw) => {
      void handleClientMessage(app, session, ws, raw.toString());
    });
  });
}

async function handleClientMessage(
  app: RuntimeFastifyInstance,
  session: SessionState,
  ws: WebSocketLike,
  raw: string,
) {
  let event: ClientEvent;
  try {
    event = decodeClientEvent(raw);
  } catch (error) {
    const message = error instanceof ZodError || error instanceof SyntaxError
      ? "Invalid websocket message."
      : error instanceof Error ? error.message : "Invalid websocket message.";
    safeSend(session, ws, JSON.stringify({
      kind: "error",
      scope: "session",
      code: "invalid_client_event",
      message,
    }));
    return;
  }

  try {
    if (event.kind === "ping") {
      safeSend(session, ws, JSON.stringify({ kind: "pong" }));
      return;
    }

    if (event.kind === "tool_confirm") {
      const resolver = session.pendingConfirms.get(event.confirm_id);
      if (resolver) {
        session.pendingConfirms.delete(event.confirm_id);
        resolver(event.decision);
      }
      return;
    }

    if (event.kind === "plan_confirm") {
      const resolver = session.pendingPlanConfirms.get(event.confirm_id);
      if (resolver) {
        session.pendingPlanConfirms.delete(event.confirm_id);
        resolver({
          outcome: event.decision,
          feedback: event.feedback,
        });
      }
      return;
    }

    if (event.kind === "abort") {
      session.runner.abort(event.turn_id);
      return;
    }

    if (event.kind === "user_input") {
      const invocation = resolveSkillInvocation(app.runtimeState.skills, event.text);
      if (invocation) {
        try {
          const skillContext = await materializeSkillContext(invocation, {
            cwd: session.workspaceRoot,
          });
          await session.runner.submit(event.text, event.turn_id, { skillContext });
        } catch (error) {
          const skillError = error instanceof SkillError
            ? error
            : new SkillError("skill_runtime_error", error instanceof Error ? error.message : String(error));
          safeSend(session, ws, JSON.stringify({
            kind: "error",
            scope: "turn",
            turn_id: event.turn_id,
            code: skillError.code,
            message: skillError.message,
          }));
        }
        return;
      }

      await session.runner.submit(event.text, event.turn_id);
    }

    if (event.kind === "skill_input") {
      const text = `/${event.skill}${event.arguments ? ` ${event.arguments}` : ""}`;
      const invocation = resolveSkillInvocation(app.runtimeState.skills, text);
      if (!invocation) {
        safeSend(session, ws, JSON.stringify({
          kind: "error",
          scope: "turn",
          turn_id: event.turn_id,
          code: "skill_not_found",
          message: `Skill not found: ${event.skill}`,
        }));
        return;
      }

      try {
        const skillContext = await materializeSkillContext(invocation, {
          cwd: session.workspaceRoot,
        });
        await session.runner.submit(text, event.turn_id, { skillContext });
      } catch (error) {
        const skillError = error instanceof SkillError
          ? error
          : new SkillError("skill_runtime_error", error instanceof Error ? error.message : String(error));
        safeSend(session, ws, JSON.stringify({
          kind: "error",
          scope: "turn",
          turn_id: event.turn_id,
          code: skillError.code,
          message: skillError.message,
        }));
      }
    }
  } catch (error) {
    const scopedPayload = "turn_id" in event
      ? { scope: "turn", turn_id: event.turn_id }
      : { scope: "session" };
    safeSend(session, ws, JSON.stringify({
      kind: "error",
      ...scopedPayload,
      code: "websocket_message_failed",
      message: error instanceof Error ? error.message : "Failed to handle websocket message.",
    }));
  }
}

function parseWebsocketRequest(rawUrl: string | undefined, rawParams: unknown, rawQuery: unknown) {
  try {
    const safeUrl = rawUrl ?? "/";
    const parsedUrl = new URL(safeUrl, "http://127.0.0.1");
    const paramsObject = rawParams && typeof rawParams === "object" ? rawParams as Record<string, unknown> : {};
    const queryObject = rawQuery && typeof rawQuery === "object" ? rawQuery as Record<string, unknown> : {};
    const matchedSessionId = safeUrl.includes("/sessions/")
      ? safeUrl.split("/sessions/")[1]?.split("/ws")[0]?.split("?")[0]
      : undefined;

    return {
      ok: true as const,
      params: z.object({ id: z.string().min(1) }).parse({
        id: typeof paramsObject.id === "string" ? paramsObject.id : matchedSessionId,
      }),
      query: wsQuerySchema.parse({
        token: typeof queryObject.token === "string" ? queryObject.token : parsedUrl.searchParams.get("token") ?? undefined,
        last_event_id: typeof queryObject.last_event_id === "string"
          ? queryObject.last_event_id
          : parsedUrl.searchParams.get("last_event_id") ?? undefined,
      }),
    };
  } catch {
    return {
      ok: false as const,
      code: "invalid_websocket_request",
      message: "Invalid websocket request.",
    };
  }
}

function sendAndClose(ws: WebSocketLike, payload: Record<string, unknown>, code: number) {
  safeSocketSend(ws, JSON.stringify(payload));
  safeClose(ws, code);
}

function safeSend(session: SessionState, ws: WebSocketLike, payload: string) {
  const sent = safeSocketSend(ws, payload);
  if (!sent) {
    session.sockets.delete(ws);
  }
  return sent;
}

function safeSocketSend(ws: WebSocketLike, payload: string) {
  try {
    if (ws.readyState !== undefined && ws.readyState !== WS_OPEN) {
      return false;
    }
    ws.send(payload);
    return true;
  } catch {
    return false;
  }
}

function safeClose(ws: WebSocketLike, code: number) {
  try {
    ws.close(code);
  } catch {
    // The peer may already have disappeared.
  }
}

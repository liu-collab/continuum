import { z } from "zod";
import { URL } from "node:url";

import { decodeClientEvent, encodeGapDetectedEvent, encodeServerEvent } from "./event-codec.js";
import { createSessionState, getSessionReplayFromEventId } from "../state.js";
import { materializeSkillContext, resolveSkillInvocation, SkillError } from "../../skills/index.js";
import type { RuntimeFastifyInstance } from "../types.js";
import type { WebSocketLike } from "../ws-types.js";

const wsQuerySchema = z.object({
  token: z.string().optional(),
  last_event_id: z.coerce.number().int().min(0).optional(),
});

export function registerSessionWebsocket(app: RuntimeFastifyInstance) {
  app.get("/v1/agent/sessions/:id/ws", { websocket: true }, async (socket, request) => {
    const ws = socket as unknown as WebSocketLike;
    const { params, query } = parseWebsocketRequest(request.raw.url ?? request.url, request.params, request.query);
    if (!query.token || query.token !== app.mnaToken) {
      ws.send(JSON.stringify({
        kind: "error",
        scope: "session",
        code: "token_invalid",
        message: "Invalid or missing token.",
      }));
      ws.close(1008);
      return;
    }

    const existingSession = app.runtimeState.store.getSession(params.id);
    if (!existingSession) {
      ws.send(JSON.stringify({
        kind: "error",
        scope: "session",
        code: "session_not_found",
        message: "Session not found.",
      }));
      ws.close();
      return;
    }

    const session = app.runtimeState.sessions.get(params.id) ?? await createSessionState(app.runtimeState, params.id);
    session.sockets.add(ws);
    ws.send(JSON.stringify({
      kind: "session_started",
      session_id: session.sessionId,
      memory_mode: session.memoryMode,
      workspace_id: session.workspaceId,
      locale: session.locale,
    }));

    const replay = getSessionReplayFromEventId(session, query.last_event_id);
    if (replay.gapDetected && query.last_event_id !== undefined) {
      ws.send(encodeGapDetectedEvent(query.last_event_id));
    }

    for (const event of replay.events) {
      ws.send(encodeServerEvent(event.id, event.payload));
    }

    ws.on("close", () => {
      session.sockets.delete(ws);
    });

    ws.on("message", async (raw) => {
      const event = decodeClientEvent(raw.toString());

      if (event.kind === "ping") {
        ws.send(JSON.stringify({ kind: "pong" }));
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
            ws.send(JSON.stringify({
              kind: "error",
              scope: "turn",
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
          ws.send(JSON.stringify({
            kind: "error",
            scope: "turn",
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
          ws.send(JSON.stringify({
            kind: "error",
            scope: "turn",
            code: skillError.code,
            message: skillError.message,
          }));
        }
      }
    });
  });
}

function parseWebsocketRequest(rawUrl: string | undefined, rawParams: unknown, rawQuery: unknown) {
  const safeUrl = rawUrl ?? "/";
  const parsedUrl = new URL(safeUrl, "http://127.0.0.1");
  const paramsObject = rawParams && typeof rawParams === "object" ? rawParams as Record<string, unknown> : {};
  const queryObject = rawQuery && typeof rawQuery === "object" ? rawQuery as Record<string, unknown> : {};
  const matchedSessionId = safeUrl.includes("/sessions/")
    ? safeUrl.split("/sessions/")[1]?.split("/ws")[0]?.split("?")[0]
    : undefined;

  return {
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
}

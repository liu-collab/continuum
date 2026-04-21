import fs from "node:fs/promises";
import path from "node:path";

import type { FastifyReply } from "fastify";
import { z } from "zod";

import { WORKSPACE_MAP_FILENAME } from "../../config/defaults.js";
import { deriveWorkspaceId, normalizeWorkspacePath, persistWorkspaceMapping } from "../../config/resolver.js";
import { createSessionId } from "../../runner/index.js";
import { createSessionState, updateProviderSelection, updateSessionMode } from "../state.js";
import type { RuntimeFastifyInstance } from "../types.js";
import { pickWorkspaceDirectory } from "../workspace-picker.js";
import { readWorkspaceMappings, resolveWorkspaceRoot } from "../workspace-resolution.js";

const sessionParamsSchema = z.object({ id: z.string().min(1) });
const turnParamsSchema = z.object({ turnId: z.string().min(1) });
const fileQuerySchema = z.object({
  path: z.string().default("."),
  workspace_id: z.string().min(1).optional(),
});

const createSessionSchema = z.object({
  workspace_id: z.string().optional(),
  memory_mode: z.enum(["workspace_only", "workspace_plus_global"]).optional(),
  locale: z.enum(["zh-CN", "en-US"]).optional(),
});

const patchSessionSchema = z.object({
  title: z.string().trim().min(1),
});

const createWorkspaceSchema = z.object({
  cwd: z.string().trim().min(1),
});

function toWorkspaceShortId(workspaceId: string): string {
  const normalized = workspaceId.replace(/[^a-zA-Z0-9]/g, "");
  if (normalized.length >= 8) {
    return normalized.slice(0, 8).toLowerCase();
  }

  return workspaceId.slice(0, 8).toLowerCase();
}

export function registerSessionRoutes(app: RuntimeFastifyInstance) {
  app.post("/v1/agent/sessions", async (request, reply) => {
    const payload = createSessionSchema.parse(request.body ?? {});
    const sessionId = createSessionId();
    const memoryMode = payload.memory_mode ?? app.runtimeState.config.memory.mode;
    const locale = payload.locale ?? app.runtimeState.config.locale;
    const workspaceId = payload.workspace_id ?? app.runtimeState.config.memory.workspaceId;

    app.runtimeState.store.createSession({
      id: sessionId,
      workspace_id: workspaceId,
      user_id: app.runtimeState.config.memory.userId,
      memory_mode: memoryMode,
      locale,
    });

    const session = await createSessionState(app.runtimeState, sessionId);
    await session.runner.start();

    const serverAddress = app.server.address();
    const port = serverAddress && typeof serverAddress !== "string" ? serverAddress.port : 4193;

    return reply.code(201).send({
      session_id: sessionId,
      ws_url: `ws://127.0.0.1:${port}/v1/agent/sessions/${sessionId}/ws?token=${app.mnaToken}`,
      memory_mode: memoryMode,
      workspace_id: workspaceId,
      workspace_short_id: toWorkspaceShortId(workspaceId),
      locale,
    });
  });

  app.get("/v1/agent/sessions", async (request) => {
    const query = z.object({
      workspace_id: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }).parse(request.query ?? {});

    const result = app.runtimeState.store.listSessions({
      workspace_id: query.workspace_id,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      ...result,
      items: result.items.map((session) => {
        const { user_id: _userId, ...sessionWithoutUser } = session;
        return sessionWithoutUser;
      }),
    };
  });

  app.get("/v1/agent/sessions/:id", async (request, reply) => {
    const params = sessionParamsSchema.parse(request.params);
    const query = z.object({
      workspace_id: z.string().optional(),
    }).parse(request.query ?? {});
    const session = app.runtimeState.store.getSession(params.id);
    if (!session) {
      return reply.code(404).send({
        error: {
          code: "session_not_found",
          message: "Session not found.",
        },
      });
    }

    if (query.workspace_id && session.workspace_id !== query.workspace_id) {
      return reply.code(409).send({
        error: {
          code: "workspace_mismatch",
          message: "Session workspace does not match the requested workspace.",
        },
      });
    }

    const liveSession = app.runtimeState.sessions.get(params.id);
    const latestEventId = liveSession?.events.at(-1)?.id ?? null;
    const { user_id: _userId, ...sessionWithoutUser } = session;

    return {
      session: sessionWithoutUser,
      messages: app.runtimeState.store.getMessages(params.id),
      latest_event_id: latestEventId,
    };
  });

  app.patch("/v1/agent/sessions/:id", async (request, reply) => {
    const params = sessionParamsSchema.parse(request.params);
    const payload = patchSessionSchema.parse(request.body ?? {});

    if (!app.runtimeState.store.getSession(params.id)) {
      return reply.code(404).send({
        error: {
          code: "session_not_found",
          message: "Session not found.",
        },
      });
    }

    app.runtimeState.store.updateSession(params.id, {
      title: payload.title,
    });

    return {
      ok: true,
    };
  });

  app.delete("/v1/agent/sessions/:id", async (request, reply) => {
    const params = sessionParamsSchema.parse(request.params);
    const query = z.object({
      purge: z.string().optional(),
    }).parse(request.query ?? {});

    if (!app.runtimeState.store.getSession(params.id)) {
      return reply.code(404).send({
        error: {
          code: "session_not_found",
          message: "Session not found.",
        },
      });
    }

    if (query.purge === "all") {
      app.runtimeState.store.deleteSession(params.id, {
        purgeArtifacts: true,
      });
      app.runtimeState.sessions.delete(params.id);
      return {
        ok: true,
        purged: true,
      };
    }

    app.runtimeState.store.updateSession(params.id, {
      closed_at: new Date().toISOString(),
    });
    return {
      ok: true,
      purged: false,
    };
  });

  app.post("/v1/agent/sessions/:id/mode", async (request, reply) => {
    const params = sessionParamsSchema.parse(request.params);
    const payload = z.object({
      memory_mode: z.enum(["workspace_only", "workspace_plus_global"]),
    }).parse(request.body ?? {});

    if (!app.runtimeState.store.getSession(params.id)) {
      return reply.code(404).send({
        error: {
          code: "session_not_found",
          message: "Session not found.",
        },
      });
    }

    updateSessionMode(app.runtimeState, params.id, payload.memory_mode);
    return {
      ok: true,
      memory_mode: payload.memory_mode,
    };
  });

  app.post("/v1/agent/sessions/:id/provider", async (request, reply) => {
    const params = sessionParamsSchema.parse(request.params);
    if (!app.runtimeState.store.getSession(params.id)) {
      return reply.code(404).send({
        error: {
          code: "session_not_found",
          message: "Session not found.",
        },
      });
    }

    const payload = z.object({
      provider_id: z.string().min(1),
      model: z.string().min(1),
      temperature: z.number().optional(),
    }).parse(request.body ?? {});

    if (payload.provider_id !== app.runtimeState.provider.id()) {
      return reply.code(400).send({
        error: {
          code: "provider_not_registered",
          message: "Requested provider is not registered.",
        },
      });
    }

    updateProviderSelection(app.runtimeState, {
      ...app.runtimeState.config.provider,
      kind: payload.provider_id as typeof app.runtimeState.config.provider.kind,
      model: payload.model,
      temperature: payload.temperature ?? app.runtimeState.config.provider.temperature,
    });

    return {
      ok: true,
      provider_id: payload.provider_id,
      model: payload.model,
      applies_to: "next_turn",
    };
  });

  app.get("/v1/agent/turns/:turnId/dispatched-messages", async (request, reply) => {
    const params = turnParamsSchema.parse(request.params);

    const payload = app.runtimeState.store.getDispatchedMessages(params.turnId);
    if (!payload) {
      return reply.code(404).send({
        error: {
          code: "turn_not_found",
          message: "Turn not found.",
        },
      });
    }

    return {
      turn_id: params.turnId,
      provider_id: payload.provider_id,
      model: payload.model,
      round: payload.round,
      messages: JSON.parse(payload.messages_json),
      prompt_segments: payload.prompt_segments_json ? JSON.parse(payload.prompt_segments_json) : [],
      phase_results: payload.phase_results_json ? JSON.parse(payload.phase_results_json) : [],
      tools: JSON.parse(payload.tools_json),
    };
  });

  app.get("/v1/agent/fs/tree", async (request, reply) => {
    const query = fileQuerySchema.parse(request.query ?? {});
    const workspaceRoot = await resolveRequestedWorkspaceRoot(app, query.workspace_id, reply);
    if (!workspaceRoot) {
      return;
    }
    let targetPath: string;
    try {
      targetPath = resolveWorkspaceScopedPath(workspaceRoot, query.path);
    } catch (error) {
      return sendPathDenied(reply, error);
    }

    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return {
      path: query.path,
      workspace_id: query.workspace_id ?? app.runtimeState.config.memory.workspaceId,
      workspace_short_id: toWorkspaceShortId(query.workspace_id ?? app.runtimeState.config.memory.workspaceId),
      entries: entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      })).sort((left, right) => {
        if (left.type === right.type) {
          return left.name.localeCompare(right.name);
        }
        return left.type === "directory" ? -1 : 1;
      }),
    };
  });

  app.get("/v1/agent/fs/file", async (request, reply) => {
    const query = z.object({
      path: z.string().min(1),
      workspace_id: z.string().min(1).optional(),
    }).parse(request.query ?? {});
    const workspaceRoot = await resolveRequestedWorkspaceRoot(app, query.workspace_id, reply);
    if (!workspaceRoot) {
      return;
    }
    let targetPath: string;
    try {
      targetPath = resolveWorkspaceScopedPath(workspaceRoot, query.path);
    } catch (error) {
      return sendPathDenied(reply, error);
    }

    const content = await fs.readFile(targetPath, "utf8").catch(() => null);
    if (content === null) {
      return reply.code(404).send({
        error: {
          code: "file_not_found",
          message: "File not found.",
        },
      });
    }
    return {
      path: query.path,
      workspace_id: query.workspace_id ?? app.runtimeState.config.memory.workspaceId,
      workspace_short_id: toWorkspaceShortId(query.workspace_id ?? app.runtimeState.config.memory.workspaceId),
      content,
    };
  });

  app.get("/v1/agent/workspaces", async () => {
    return {
      items: await listWorkspaceMappings(app),
    };
  });

  app.post("/v1/agent/workspaces", async (request, reply) => {
    const payload = createWorkspaceSchema.parse(request.body ?? {});

    let normalizedCwd: string;
    try {
      normalizedCwd = normalizeWorkspacePath(payload.cwd);
    } catch {
      return reply.code(400).send({
        error: {
          code: "workspace_path_invalid",
          message: "Workspace directory does not exist.",
        },
      });
    }

    const stat = await fs.stat(normalizedCwd).catch(() => null);
    if (!stat?.isDirectory()) {
      return reply.code(400).send({
        error: {
          code: "workspace_path_invalid",
          message: "Workspace directory does not exist.",
        },
      });
    }

    const workspaceId = deriveWorkspaceId(normalizedCwd);
    persistWorkspaceMapping(app.runtimeState.mnaHomeDirectory, normalizedCwd, workspaceId);

    const items = await listWorkspaceMappings(app);
    const created = items.find((item) => item.workspace_id === workspaceId);

    return reply.code(201).send({
      workspace: created ?? mapWorkspaceSummary(
        workspaceId,
        normalizedCwd,
        normalizedCwd === app.runtimeState.config.memory.cwd
      ),
    });
  });

  app.post("/v1/agent/workspaces/pick", async (_request, reply) => {
    let selectedCwd: string | null;
    try {
      selectedCwd = await pickWorkspaceDirectory();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code === "workspace_picker_unsupported") {
        return reply.code(400).send({
          error: {
            code: "workspace_picker_unsupported",
            message: error instanceof Error ? error.message : "当前系统没有可用的文件夹选择器，请改用手动输入路径。",
          },
        });
      }
      throw error;
    }

    if (!selectedCwd) {
      return reply.code(200).send({
        cancelled: true,
      });
    }

    let normalizedCwd: string;
    try {
      normalizedCwd = normalizeWorkspacePath(selectedCwd);
    } catch {
      return reply.code(400).send({
        error: {
          code: "workspace_path_invalid",
          message: "Workspace directory does not exist.",
        },
      });
    }

    const stat = await fs.stat(normalizedCwd).catch(() => null);
    if (!stat?.isDirectory()) {
      return reply.code(400).send({
        error: {
          code: "workspace_path_invalid",
          message: "Workspace directory does not exist.",
        },
      });
    }

    const workspaceId = deriveWorkspaceId(normalizedCwd);
    persistWorkspaceMapping(app.runtimeState.mnaHomeDirectory, normalizedCwd, workspaceId);

    const items = await listWorkspaceMappings(app);
    const created = items.find((item) => item.workspace_id === workspaceId);

    return reply.code(200).send({
      cancelled: false,
      workspace: created ?? mapWorkspaceSummary(
        workspaceId,
        normalizedCwd,
        normalizedCwd === app.runtimeState.config.memory.cwd
      ),
    });
  });

  app.get("/v1/agent/artifacts/:sessionId/:file", async (request, reply) => {
    const params = z.object({
      sessionId: z.string().min(1),
      file: z.string().min(1),
    }).parse(request.params);

    if (params.file.includes("/") || params.file.includes("\\") || params.file.includes("..")) {
      return reply.code(400).send({
        error: {
          code: "artifact_not_found",
          message: "Artifact not found.",
        },
      });
    }

    const targetPath = path.join(app.runtimeState.artifactsRoot, params.sessionId, params.file);
    const content = await fs.readFile(targetPath, "utf8").catch(() => null);
    if (content === null) {
      return reply.code(404).send({
        error: {
          code: "artifact_not_found",
          message: "Artifact not found.",
        },
      });
    }
    reply.type("text/plain; charset=utf-8");
    return content;
  });
}

async function listWorkspaceMappings(app: RuntimeFastifyInstance) {
  const rawMappings = await readWorkspaceMappings(app.runtimeState);

  const items = Object.entries(rawMappings)
    .map(([cwd, workspaceId]) => mapWorkspaceSummary(workspaceId, cwd, cwd === app.runtimeState.config.memory.cwd))
    .sort((left, right) => {
      if (left.is_current !== right.is_current) {
        return left.is_current ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });

  if (items.some((item) => item.workspace_id === app.runtimeState.config.memory.workspaceId)) {
    return items;
  }

  return [
    mapWorkspaceSummary(app.runtimeState.config.memory.workspaceId, app.runtimeState.config.memory.cwd, true),
    ...items,
  ];
}

async function resolveRequestedWorkspaceRoot(
  app: RuntimeFastifyInstance,
  workspaceId: string | undefined,
  reply: FastifyReply
) {
  const workspaceRoot = await resolveWorkspaceRoot(app.runtimeState, workspaceId);
  if (workspaceRoot) {
    return workspaceRoot;
  }

  await reply.code(404).send({
    error: {
      code: "workspace_not_found",
      message: "Workspace mapping not found.",
    },
  });
  return null;
}

function resolveWorkspaceScopedPath(workspaceRoot: string, relativePath: string): string {
  const rootResolved = path.resolve(workspaceRoot);
  const targetPath = path.resolve(rootResolved, relativePath);
  const relative = path.relative(rootResolved, targetPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Object.assign(new Error("Resolved path escapes the workspace root."), {
      code: "tool_denied_path",
    });
  }

  return targetPath;
}

function sendPathDenied(reply: FastifyReply, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
  if (code !== "tool_denied_path") {
    throw error;
  }

  return reply.code(400).send({
    error: {
      code: "tool_denied_path",
      message: error instanceof Error ? error.message : "Resolved path escapes the workspace root.",
    },
  });
}

function mapWorkspaceSummary(
  workspaceId: string,
  cwd: string,
  isCurrent: boolean
) {
  return {
    workspace_id: workspaceId,
    short_id: toWorkspaceShortId(workspaceId),
    cwd,
    label: path.basename(cwd) || cwd,
    is_current: isCurrent,
  };
}

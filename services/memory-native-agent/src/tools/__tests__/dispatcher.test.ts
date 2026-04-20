import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpServerUnavailableError, type McpRegistry } from "../../mcp-client/index.js";
import type { SessionStore } from "../../session-store/index.js";
import { createFsWriteTool } from "../builtin/fs-write.js";
import { createMcpCallTool } from "../builtin/mcp-call.js";
import { ToolDispatcher } from "../dispatcher.js";
import { PermissionGate } from "../permission-gate.js";
import { ToolRegistry } from "../registry.js";
import type { ToolContext } from "../types.js";

const tempRoots: string[] = [];

function createContext(root: string, decision: "allow" | "deny" | "allow_session" = "allow"): ToolContext {
  const artifactsRoot = path.join(root, ".artifacts");
  fs.mkdirSync(artifactsRoot, { recursive: true });
  return {
    callId: "call-1",
    sessionId: "session-1",
    turnId: "turn-1",
    cwd: root,
    workspaceRoot: root,
    artifactsRoot,
    abort: new AbortController().signal,
    confirm: async () => decision,
  };
}

describe("ToolDispatcher", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("caches allow_session decisions and records audits", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-tools-dispatch-"));
    tempRoots.push(root);
    const recordToolInvocation = vi.fn<SessionStore["recordToolInvocation"]>();
    const registry = new ToolRegistry();
    registry.register(createFsWriteTool());
    const dispatcher = new ToolDispatcher({
      registry,
      gate: new PermissionGate(),
      sessionStore: {
        recordToolInvocation,
      } as unknown as SessionStore,
    });

    const first = await dispatcher.invoke(
      {
        id: "call-1",
        name: "fs_write",
        args: {
          path: "note.txt",
          content: "alpha",
        },
      },
      createContext(root, "allow_session"),
    );

    const second = await dispatcher.invoke(
      {
        id: "call-2",
        name: "fs_write",
        args: {
          path: "note-2.txt",
          content: "beta",
        },
      },
      {
        ...createContext(root, "deny"),
        callId: "call-2",
      },
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(recordToolInvocation).toHaveBeenCalledTimes(2);
    expect(recordToolInvocation.mock.calls[0]?.[0].permission_decision).toBe("allowed_session");
    expect(recordToolInvocation.mock.calls[1]?.[0].permission_decision).toBe("allowed_session");
  });

  it("denies confirmed tools and forwards MCP calls", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-tools-dispatch-"));
    tempRoots.push(root);
    const registry = new ToolRegistry();
    const mcpRegistry = {
      callTool: vi.fn(async () => ({
        server: "echo",
        tool: "repeat",
        is_error: false,
        content: [{ type: "text", text: "done" }],
      })),
    } as unknown as McpRegistry;
    registry.register(createFsWriteTool());
    registry.register(createMcpCallTool(mcpRegistry));
    const dispatcher = new ToolDispatcher({
      registry,
      gate: new PermissionGate(),
    });

    const denied = await dispatcher.invoke(
      {
        id: "call-1",
        name: "fs_write",
        args: {
          path: "note.txt",
          content: "alpha",
        },
      },
      createContext(root, "deny"),
    );
    const mcp = await dispatcher.invoke(
      {
        id: "call-2",
        name: "mcp_call",
        args: {
          server: "echo",
          tool: "repeat",
          args: { text: "done" },
        },
      },
      {
        ...createContext(root, "allow"),
        callId: "call-2",
      },
    );

    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe("tool_denied");
    expect(mcp.ok).toBe(true);
    expect(mcp.output).toContain("done");
  });

  it("maps MCP disconnection errors to tool results and exposes tool schema", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-tools-dispatch-"));
    tempRoots.push(root);
    const registry = new ToolRegistry();
    registry.register(
      createMcpCallTool({
        callTool: async () => {
          throw new McpServerUnavailableError("echo", "offline");
        },
      } as unknown as McpRegistry),
    );
    const dispatcher = new ToolDispatcher({
      registry,
      gate: new PermissionGate(),
    });

    const result = await dispatcher.invoke(
      {
        id: "call-1",
        name: "mcp_call",
        args: {
          server: "echo",
          tool: "repeat",
        },
      },
      createContext(root, "allow"),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("mcp_disconnected");
    expect(dispatcher.listTools()).toEqual([
      expect.objectContaining({
        name: "mcp_call",
      }),
    ]);
  });

  it("returns tool_confirm_timeout and records timeout audits", async () => {
    vi.useFakeTimers();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-tools-dispatch-"));
    tempRoots.push(root);
    const recordToolInvocation = vi.fn<SessionStore["recordToolInvocation"]>();
    const registry = new ToolRegistry();
    registry.register(createFsWriteTool());
    const dispatcher = new ToolDispatcher({
      registry,
      gate: new PermissionGate(10),
      sessionStore: {
        recordToolInvocation,
      } as unknown as SessionStore,
    });

    const resultPromise = dispatcher.invoke(
      {
        id: "call-timeout",
        name: "fs_write",
        args: {
          path: "note.txt",
          content: "alpha",
        },
      },
      {
        ...createContext(root, "allow"),
        callId: "call-timeout",
        confirm: async () => await new Promise<"allow" | "deny" | "allow_session">(() => undefined),
      },
    );

    await vi.advanceTimersByTimeAsync(20);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("tool_confirm_timeout");
    expect(result.permission_decision).toBe("timeout");
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        call_id: "call-timeout",
        permission_decision: "timeout",
        ok: false,
        error_code: "tool_confirm_timeout",
      }),
    );
  });
});

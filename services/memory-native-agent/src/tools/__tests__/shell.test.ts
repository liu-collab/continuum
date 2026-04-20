import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createShellExecTool } from "../builtin/shell-exec.js";
import { ToolDispatcher } from "../dispatcher.js";
import { PermissionGate } from "../permission-gate.js";
import { ToolRegistry } from "../registry.js";
import type { ToolContext } from "../types.js";

const tempRoots: string[] = [];

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-tools-shell-"));
  const artifactsRoot = path.join(root, ".artifacts");
  fs.mkdirSync(artifactsRoot, { recursive: true });
  tempRoots.push(root);
  return { root, artifactsRoot };
}

function createDispatcher() {
  const registry = new ToolRegistry();
  registry.register(
    createShellExecTool({
      denyPatterns: ["rm -rf /", "curl * | sh", "blocked command"],
      defaultTimeoutMs: 200,
    }),
  );
  return new ToolDispatcher({
    registry,
    gate: new PermissionGate(),
  });
}

function createContext(root: string, artifactsRoot: string, decision: "allow" | "deny" | "allow_session" = "allow"): ToolContext {
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

describe("shell_exec tool", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs a shell command after confirmation", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);
    const command = process.platform === "win32" ? "echo hello" : "printf 'hello'";

    const result = await dispatcher.invoke(
      {
        id: "call-1",
        name: "shell_exec",
        args: {
          command,
        },
      },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.output.toLowerCase()).toContain("hello");
  });

  it("blocks denied patterns and timeouts", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);

    const blocked = await dispatcher.invoke(
      {
        id: "call-1",
        name: "shell_exec",
        args: {
          command: "blocked command",
        },
      },
      context,
    );

    const slowCommand = process.platform === "win32"
      ? "powershell -NoLogo -NoProfile -Command Start-Sleep -Milliseconds 800"
      : "sleep 1";
    const timeout = await dispatcher.invoke(
      {
        id: "call-2",
        name: "shell_exec",
        args: {
          command: slowCommand,
        },
      },
      {
        ...context,
        callId: "call-2",
      },
    );

    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("tool_denied_pattern");
    expect(timeout.ok).toBe(false);
    expect(timeout.error?.code).toBe("tool_timeout");
  });

  it("aborts shell_exec and returns timeout-shaped error after killing the child", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const dispatcher = createDispatcher();
    const abortController = new AbortController();
    const context = {
      ...createContext(root, artifactsRoot),
      abort: abortController.signal,
    };

    const slowCommand = process.platform === "win32"
      ? "powershell -NoLogo -NoProfile -Command Start-Sleep -Milliseconds 1000"
      : "sleep 1";

    const invocation = dispatcher.invoke(
      {
        id: "call-abort",
        name: "shell_exec",
        args: {
          command: slowCommand,
          timeout_ms: 5_000,
        },
      },
      {
        ...context,
        callId: "call-abort",
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    abortController.abort();
    const result = await invocation;

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("tool_timeout");
    expect(result.error?.message).toContain("aborted");
  });

  it("supports max_output_bytes overrides for shell_exec", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);
    const command = process.platform === "win32"
      ? "for /L %i in (1,1,200) do @echo xxxxxxxxxx"
      : "python -c \"print('xxxxxxxxxx\\n' * 200, end='')\"";

    const result = await dispatcher.invoke(
      {
        id: "call-1",
        name: "shell_exec",
        args: {
          command,
          max_output_bytes: 256,
        },
      },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.artifact_ref).toBe("session-1/call-1.txt");
    expect(result.output).toContain("\n...\n");
  });
});

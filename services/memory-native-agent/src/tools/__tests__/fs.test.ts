import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ToolDispatcher } from "../dispatcher.js";
import { createFsEditTool } from "../builtin/fs-edit.js";
import { createFsReadTool } from "../builtin/fs-read.js";
import { createFsWriteTool } from "../builtin/fs-write.js";
import { PermissionGate } from "../permission-gate.js";
import { ToolRegistry } from "../registry.js";
import type { ToolContext, ToolCallEnvelope } from "../types.js";

const tempRoots: string[] = [];

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-tools-fs-"));
  const artifactsRoot = path.join(root, ".artifacts");
  fs.mkdirSync(artifactsRoot, { recursive: true });
  tempRoots.push(root);
  return { root, artifactsRoot };
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

function createDispatcher() {
  const registry = new ToolRegistry();
  registry.register(createFsReadTool());
  registry.register(createFsWriteTool());
  registry.register(createFsEditTool());
  return new ToolDispatcher({
    registry,
    gate: new PermissionGate(),
  });
}

async function invoke(dispatcher: ToolDispatcher, name: string, args: ToolCallEnvelope["args"], context: ToolContext) {
  return await dispatcher.invoke(
    {
      id: context.callId,
      name,
      args,
    },
    context,
  );
}

describe("fs tools", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads files and directories inside the workspace", async () => {
    const { root, artifactsRoot } = createWorkspace();
    fs.writeFileSync(path.join(root, "README.md"), "hello", "utf8");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });

    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);

    const fileResult = await invoke(dispatcher, "fs_read", { path: "README.md" }, context);
    const dirResult = await invoke(
      dispatcher,
      "fs_read",
      { path: "." },
      {
        ...context,
        callId: "call-2",
      },
    );

    expect(fileResult.ok).toBe(true);
    expect(fileResult.output).toContain("hello");
    expect(dirResult.ok).toBe(true);
    expect(dirResult.output).toContain("README.md");
  });

  it("supports byte and line limits for fs_read", async () => {
    const { root, artifactsRoot } = createWorkspace();
    fs.writeFileSync(path.join(root, "notes.txt"), "line-1\nline-2\nline-3\nline-4\n", "utf8");

    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);

    const result = await invoke(
      dispatcher,
      "fs_read",
      {
        path: "notes.txt",
        max_lines: 2,
        byte_limit: 64,
      },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("line-1");
    expect(result.output).toContain("line-2");
    expect(result.output).not.toContain("line-3");
  });

  it("rejects paths outside the workspace before confirmation", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);

    const result = await invoke(dispatcher, "fs_read", { path: "../secret.txt" }, context);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("tool_denied_path");
  });

  it("rejects symlink targets that escape the workspace", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mna-tools-fs-outside-"));
    tempRoots.push(outsideRoot);
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "secret", "utf8");
    fs.symlinkSync(path.join(outsideRoot, "secret.txt"), path.join(root, "linked-secret.txt"));

    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);

    const result = await invoke(dispatcher, "fs_read", { path: "linked-secret.txt" }, context);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("tool_denied_path");
  });

  it("writes files after confirmation and edits unique matches", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);

    const writeResult = await invoke(
      dispatcher,
      "fs_write",
      { path: "src/index.ts", content: "export const value = 1;\n" },
      context,
    );
    const editResult = await invoke(
      dispatcher,
      "fs_edit",
      {
        path: "src/index.ts",
        old_string: "value = 1",
        new_string: "value = 2",
      },
      {
        ...context,
        callId: "call-2",
      },
    );

    expect(writeResult.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, "src/index.ts"), "utf8")).toContain("value = 2");
    expect(editResult.ok).toBe(true);
    expect(editResult.output).toContain("+export const value = 2;");
  });

  it("fails fs_edit when old_string is not unique", async () => {
    const { root, artifactsRoot } = createWorkspace();
    fs.writeFileSync(path.join(root, "dup.txt"), "same\nsame\n", "utf8");
    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);

    const result = await invoke(
      dispatcher,
      "fs_edit",
      {
        path: "dup.txt",
        old_string: "same",
        new_string: "changed",
      },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("tool_edit_match_not_unique");
  });

  it("writes oversized diffs to artifacts and truncates inline output", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);
    const largeContent = "x".repeat(12 * 1024);

    const result = await invoke(
      dispatcher,
      "fs_write",
      { path: "src/large.txt", content: largeContent },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.artifact_ref).toBe("session-1/call-1.patch");
    expect(result.output).toContain("\n...\n");
    expect(result.output.length).toBeLessThan(largeContent.length);
    expect(fs.readFileSync(path.join(artifactsRoot, "session-1", "call-1.patch"), "utf8")).toContain("+++ src/large.txt");
  });

  it("rejects outputs larger than the artifact size cap", async () => {
    const { root, artifactsRoot } = createWorkspace();
    const dispatcher = createDispatcher();
    const context = createContext(root, artifactsRoot);
    const hugeContent = "x".repeat(6 * 1024 * 1024);

    const result = await invoke(
      dispatcher,
      "fs_write",
      { path: "src/huge.txt", content: hugeContent },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("tool_output_too_large");
  });
});

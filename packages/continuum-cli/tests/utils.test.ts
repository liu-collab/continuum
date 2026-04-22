import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { uninstallCodexMcpServer } from "../src/utils.js";

function createSpawnResult(options: { code: number; stdout?: string; stderr?: string }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
  };

  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });

  process.nextTick(() => {
    if (options.stdout) {
      child.stdout.emit("data", options.stdout);
    }
    if (options.stderr) {
      child.stderr.emit("data", options.stderr);
    }
    child.emit("exit", options.code);
  });

  return child;
}

describe("continuum utils", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    spawnMock.mockReset();
  });

  it("treats codex mcp remove not-found output as not installed even when exit code is zero", async () => {
    spawnMock.mockImplementation(() =>
      createSpawnResult({
        code: 0,
        stdout: "No MCP server named 'memory' found.\n",
      }),
    );

    await expect(
      uninstallCodexMcpServer({
        name: "memory",
        codexHome: "C:/tmp/.codex",
      }),
    ).resolves.toBe(false);
  });
});

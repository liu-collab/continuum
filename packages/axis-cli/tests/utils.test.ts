import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import {
  runCommand,
  terminateProcess,
  uninstallCodexMcpServer,
  waitForHealthy,
} from "../src/utils.js";

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

describe("axis utils", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
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

  it("runs commands through the shared cross-platform spawn wrapper", async () => {
    spawnMock.mockImplementation(() =>
      createSpawnResult({
        code: 0,
        stdout: "ok\n",
      }),
    );

    await expect(runCommand("node", ["--version"], { captureOutput: true })).resolves.toMatchObject({
      code: 0,
      stdout: "ok\n",
    });

    if (process.platform === "win32") {
      expect(spawnMock).toHaveBeenCalledWith(
        "cmd",
        ["/c", "node", "--version"],
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    } else {
      expect(spawnMock).toHaveBeenCalledWith(
        "node",
        ["--version"],
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    }
  });

  it("terminates managed processes through the shared helper", async () => {
    spawnMock.mockImplementation(() =>
      createSpawnResult({
        code: 0,
      }),
    );

    await terminateProcess(1234);

    if (process.platform === "win32") {
      expect(spawnMock).toHaveBeenCalledWith(
        "taskkill",
        ["/PID", "1234", "/T", "/F"],
        expect.objectContaining({
          stdio: "ignore",
          windowsHide: true,
        }),
      );
    } else {
      expect(spawnMock).not.toHaveBeenCalled();
    }
  });

  it("waits for a healthy response and can return its body", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue("{\"version\":\"1.2.3\"}"),
      }) as typeof fetch;

    await expect(
      waitForHealthy("http://127.0.0.1:4193/healthz", {
        timeoutMs: 1_000,
        intervalMs: 1,
        requestTimeoutMs: 100,
        extractBody: true,
      }),
    ).resolves.toEqual({
      version: "1.2.3",
    });
  });
});

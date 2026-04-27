import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const uninstallCodexMcpServerMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    uninstallCodexMcpServer: uninstallCodexMcpServerMock,
  };
});

import {
  runCodexInstallCommand,
  runCodexUninstallCommand,
  runCodexUseCommand,
} from "../src/codex-command.js";

function createChildProcess() {
  return new EventEmitter();
}

describe("continuum codex commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    uninstallCodexMcpServerMock.mockReset();
    spawnMock.mockReset();
  });

  it("reports that Codex install uses platform forced injection", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCodexInstallCommand(
      {
        "runtime-url": "http://127.0.0.1:3002",
        "codex-home": "C:/tmp/.codex",
        "server-name": "memory",
        force: true,
      },
      import.meta.url,
    );

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Codex uses platform forced memory injection; no MCP server install is required.\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith("Runtime URL: http://127.0.0.1:3002\n");
  });

  it("removes the installed Codex MCP server", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    uninstallCodexMcpServerMock.mockResolvedValue(true);

    await runCodexUninstallCommand({
      "codex-home": "C:/tmp/.codex",
      "server-name": "memory",
    });

    expect(uninstallCodexMcpServerMock).toHaveBeenCalledWith({
      name: "memory",
      codexHome: "C:/tmp/.codex",
    });
    expect(stdoutSpy).toHaveBeenCalledWith("Codex MCP server removed: memory\n");
  });

  it("reports when the Codex MCP server is not installed", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    uninstallCodexMcpServerMock.mockResolvedValue(false);

    await runCodexUninstallCommand({
      "server-name": "memory",
    });

    expect(stdoutSpy).toHaveBeenCalledWith("Codex MCP server is not installed: memory\n");
  });

  it("starts Codex with MCP disabled so memory is forced through the proxy", async () => {
    spawnMock.mockReturnValue(createChildProcess());

    await runCodexUseCommand(
      {
        "runtime-url": "http://127.0.0.1:3002",
        "client-command": "codex --remote ws://127.0.0.1:3788",
        "app-server-command": "codex app-server --listen ws://127.0.0.1:3777",
        "ensure-runtime": "false",
      },
      import.meta.url,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("memory-codex.mjs")],
      expect.objectContaining({
        env: expect.objectContaining({
          MEMORY_RUNTIME_BASE_URL: "http://127.0.0.1:3002",
          MEMORY_RUNTIME_START_COMMAND: "off",
          MEMORY_MCP_COMMAND: "off",
        }),
      }),
    );
  });
});

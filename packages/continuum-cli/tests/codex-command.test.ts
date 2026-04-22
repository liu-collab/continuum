import { afterEach, describe, expect, it, vi } from "vitest";

const installCodexMcpServerMock = vi.hoisted(() => vi.fn());
const uninstallCodexMcpServerMock = vi.hoisted(() => vi.fn());

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    installCodexMcpServer: installCodexMcpServerMock,
    uninstallCodexMcpServer: uninstallCodexMcpServerMock,
  };
});

import { runCodexInstallCommand, runCodexUninstallCommand } from "../src/codex-command.js";

describe("continuum codex commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    installCodexMcpServerMock.mockReset();
    uninstallCodexMcpServerMock.mockReset();
  });

  it("installs the Codex MCP server", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    installCodexMcpServerMock.mockResolvedValue(undefined);

    await runCodexInstallCommand(
      {
        "runtime-url": "http://127.0.0.1:3002",
        "codex-home": "C:/tmp/.codex",
        "server-name": "memory",
        force: true,
      },
      import.meta.url,
    );

    expect(installCodexMcpServerMock).toHaveBeenCalledWith({
      name: "memory",
      cliEntryPath: expect.stringContaining("dist"),
      runtimeUrl: "http://127.0.0.1:3002",
      codexHome: "C:/tmp/.codex",
      force: true,
    });
    expect(stdoutSpy).toHaveBeenCalledWith("Codex MCP server installed as memory\n");
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
});

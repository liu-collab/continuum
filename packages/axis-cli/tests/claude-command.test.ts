import { afterEach, describe, expect, it, vi } from "vitest";

const installClaudePluginMock = vi.hoisted(() => vi.fn());
const rewriteClaudePluginCommandsMock = vi.hoisted(() => vi.fn());
const uninstallClaudePluginMock = vi.hoisted(() => vi.fn());

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    installClaudePlugin: installClaudePluginMock,
    rewriteClaudePluginCommands: rewriteClaudePluginCommandsMock,
    uninstallClaudePlugin: uninstallClaudePluginMock,
  };
});

import { runClaudeInstallCommand, runClaudeUninstallCommand } from "../src/claude-command.js";

describe("axis claude commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    installClaudePluginMock.mockReset();
    rewriteClaudePluginCommandsMock.mockReset();
    uninstallClaudePluginMock.mockReset();
  });

  it("installs the Claude plugin and rewrites runtime commands", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    installClaudePluginMock.mockResolvedValue(undefined);
    rewriteClaudePluginCommandsMock.mockResolvedValue(undefined);

    await runClaudeInstallCommand(
      {
        "plugin-dir": "C:/tmp/axis-plugin",
        package: "axis-agent@0.1.0",
        force: true,
      },
      import.meta.url,
    );

    expect(installClaudePluginMock).toHaveBeenCalledWith({
      sourceDir: expect.stringContaining("vendor"),
      targetDir: "C:/tmp/axis-plugin",
      force: true,
    });
    expect(rewriteClaudePluginCommandsMock).toHaveBeenCalledWith(
      "C:/tmp/axis-plugin",
      "axis-agent@0.1.0",
    );
    expect(stdoutSpy).toHaveBeenCalledWith("Claude plugin installed to C:/tmp/axis-plugin\n");
  });

  it("removes the installed Claude plugin", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    uninstallClaudePluginMock.mockResolvedValue(true);

    await runClaudeUninstallCommand({
      "plugin-dir": "C:/tmp/axis-plugin",
    });

    expect(uninstallClaudePluginMock).toHaveBeenCalledWith("C:/tmp/axis-plugin");
    expect(stdoutSpy).toHaveBeenCalledWith("Claude plugin removed from C:/tmp/axis-plugin\n");
  });

  it("reports when the Claude plugin is not installed", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    uninstallClaudePluginMock.mockResolvedValue(false);

    await runClaudeUninstallCommand({
      "plugin-dir": "C:/tmp/axis-plugin",
    });

    expect(stdoutSpy).toHaveBeenCalledWith("Claude plugin is not installed at C:/tmp/axis-plugin\n");
  });
});

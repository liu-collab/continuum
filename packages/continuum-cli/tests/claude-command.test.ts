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

describe("continuum claude commands", () => {
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
        "plugin-dir": "C:/tmp/continuum-plugin",
        package: "@jiankarlin/continuum@0.2.3",
        force: true,
      },
      import.meta.url,
    );

    expect(installClaudePluginMock).toHaveBeenCalledWith({
      sourceDir: expect.stringContaining("vendor"),
      targetDir: "C:/tmp/continuum-plugin",
      force: true,
    });
    expect(rewriteClaudePluginCommandsMock).toHaveBeenCalledWith(
      "C:/tmp/continuum-plugin",
      "@jiankarlin/continuum@0.2.3",
    );
    expect(stdoutSpy).toHaveBeenCalledWith("Claude plugin installed to C:/tmp/continuum-plugin\n");
  });

  it("removes the installed Claude plugin", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    uninstallClaudePluginMock.mockResolvedValue(true);

    await runClaudeUninstallCommand({
      "plugin-dir": "C:/tmp/continuum-plugin",
    });

    expect(uninstallClaudePluginMock).toHaveBeenCalledWith("C:/tmp/continuum-plugin");
    expect(stdoutSpy).toHaveBeenCalledWith("Claude plugin removed from C:/tmp/continuum-plugin\n");
  });

  it("reports when the Claude plugin is not installed", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    uninstallClaudePluginMock.mockResolvedValue(false);

    await runClaudeUninstallCommand({
      "plugin-dir": "C:/tmp/continuum-plugin",
    });

    expect(stdoutSpy).toHaveBeenCalledWith("Claude plugin is not installed at C:/tmp/continuum-plugin\n");
  });
});

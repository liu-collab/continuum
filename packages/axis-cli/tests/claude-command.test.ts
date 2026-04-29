import { afterEach, describe, expect, it, vi } from "vitest";

const installClaudePluginMock = vi.hoisted(() => vi.fn());
const rewriteClaudePluginCommandsMock = vi.hoisted(() => vi.fn());
const uninstallClaudePluginMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const runForegroundMock = vi.hoisted(() => vi.fn());

vi.mock("../src/managed-process.js", () => ({
  runForeground: runForegroundMock,
}));

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    installClaudePlugin: installClaudePluginMock,
    pathExists: pathExistsMock,
    rewriteClaudePluginCommands: rewriteClaudePluginCommandsMock,
    uninstallClaudePlugin: uninstallClaudePluginMock,
  };
});

import {
  runClaudeCommand,
  runClaudeInstallCommand,
  runClaudeUninstallCommand,
} from "../src/claude-command.js";

describe("axis claude commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    installClaudePluginMock.mockReset();
    pathExistsMock.mockReset();
    rewriteClaudePluginCommandsMock.mockReset();
    runForegroundMock.mockReset();
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

  it("installs the default plugin when missing and launches Claude", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    pathExistsMock.mockResolvedValue(false);
    installClaudePluginMock.mockResolvedValue(undefined);
    rewriteClaudePluginCommandsMock.mockResolvedValue(undefined);
    runForegroundMock.mockResolvedValue(undefined);

    await runClaudeCommand(
      {
        "plugin-dir": "C:/tmp/axis-plugin",
        package: "axis-agent@0.1.0",
      },
      import.meta.url,
    );

    expect(installClaudePluginMock).toHaveBeenCalledWith({
      sourceDir: expect.stringContaining("vendor"),
      targetDir: "C:/tmp/axis-plugin",
      force: false,
    });
    expect(rewriteClaudePluginCommandsMock).toHaveBeenCalledWith(
      "C:/tmp/axis-plugin",
      "axis-agent@0.1.0",
    );
    expect(stdoutSpy).toHaveBeenCalledWith("Claude plugin installed to C:/tmp/axis-plugin\n");
    expect(runForegroundMock).toHaveBeenCalledWith("claude", ["--plugin-dir", "C:/tmp/axis-plugin"]);
  });

  it("launches Claude without reinstalling when the plugin already exists", async () => {
    pathExistsMock.mockResolvedValue(true);
    runForegroundMock.mockResolvedValue(undefined);

    await runClaudeCommand(
      {
        "plugin-dir": "C:/tmp/axis-plugin",
      },
      import.meta.url,
    );

    expect(installClaudePluginMock).not.toHaveBeenCalled();
    expect(rewriteClaudePluginCommandsMock).not.toHaveBeenCalled();
    expect(runForegroundMock).toHaveBeenCalledWith("claude", ["--plugin-dir", "C:/tmp/axis-plugin"]);
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

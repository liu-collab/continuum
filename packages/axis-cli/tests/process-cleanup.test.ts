import { afterEach, describe, expect, it, vi } from "vitest";

describe("process cleanup", () => {
  afterEach(() => {
    delete process.env.AXIS_REPO_ROOT;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("normalizes windows command lines before matching managed services", async () => {
    process.env.AXIS_REPO_ROOT = "C:\\workspace\\work\\agent-memory";
    const { buildWindowsLegacyAxisCleanupScript } = await import("../src/process-cleanup.js");
    const script = buildWindowsLegacyAxisCleanupScript();

    expect(script).toContain("-replace '\\\\','/'");
    expect(script).toContain("vendor/(storage/dist/src/server\\.js|storage/dist/src/worker\\.js|runtime/dist/src/index\\.js|visualization/standalone/server\\.js|memory-native-agent/bin/mna-server\\.mjs)");
    expect(script).toContain("local-embedding-service\\.js");
    expect(script).toContain("c:/workspace/work/agent-memory/services/");
  });

  it("invokes powershell directly on windows cleanup", async () => {
    const spawnMock = vi.fn().mockImplementation(() => ({
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "exit") {
          setImmediate(() => handler(0));
        }
        return this;
      },
    }));

    vi.doMock("node:child_process", () => ({
      spawn: spawnMock,
    }));
    vi.doMock("node:process", () => ({
      default: {
        ...process,
        platform: "win32",
        env: process.env,
      },
    }));

    const { stopLegacyAxisProcesses } = await import("../src/process-cleanup.js");
    await stopLegacyAxisProcesses();

    expect(spawnMock).toHaveBeenCalled();
    expect(spawnMock.mock.calls[0]?.[0]).toBe("powershell");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

describe("process cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("normalizes windows command lines before matching managed services", async () => {
    const { buildWindowsLegacyContinuumCleanupScript } = await import("../src/process-cleanup.js");
    const script = buildWindowsLegacyContinuumCleanupScript();

    expect(script).toContain("-replace '\\\\','/'");
    expect(script).toContain("vendor/(storage/dist/src/server\\.js|storage/dist/src/worker\\.js|runtime/dist/src/index\\.js|visualization/standalone/server\\.js)");
    expect(script).toContain("local-embedding-service\\.js");
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

    const { stopLegacyContinuumProcesses } = await import("../src/process-cleanup.js");
    await stopLegacyContinuumProcesses();

    expect(spawnMock).toHaveBeenCalled();
    expect(spawnMock.mock.calls[0]?.[0]).toBe("powershell");
  });
});

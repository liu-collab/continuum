import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const spawnMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
const readManagedStateMock = vi.hoisted(() => vi.fn());
const writeManagedStateMock = vi.hoisted(() => vi.fn());
const stopManagedMnaMock = vi.hoisted(() => vi.fn());
const stopLegacyAxisProcessesMock = vi.hoisted(() => vi.fn());
const removeDockerContainerMock = vi.hoisted(() => vi.fn());
const removeDockerImageMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: rmMock,
  };
});

vi.mock("../src/managed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-state.js")>();
  return {
    ...actual,
    axisHomeDir: vi.fn(() => "C:/Users/test/.axis"),
    axisLogsDir: vi.fn(() => "C:/Users/test/.axis/logs"),
    axisManagedDir: vi.fn(() => "C:/Users/test/.axis/managed"),
    readManagedState: readManagedStateMock,
    writeManagedState: writeManagedStateMock,
  };
});

vi.mock("../src/mna-command.js", () => ({
  stopManagedMna: stopManagedMnaMock,
}));

vi.mock("../src/process-cleanup.js", () => ({
  stopLegacyAxisProcesses: stopLegacyAxisProcessesMock,
}));

vi.mock("../src/docker-lifecycle.js", () => ({
  removeDockerContainer: removeDockerContainerMock,
  removeDockerImage: removeDockerImageMock,
}));

import { runStopCommand } from "../src/stop-command.js";

function mockSpawnExit(exitCode: number) {
  spawnMock.mockImplementation(() => ({
    stderr: {
      on() {
        return this;
      },
    },
    on(event: string, handler: (code?: number) => void) {
      if (event === "exit") {
        setImmediate(() => handler(exitCode));
      }
      return this;
    },
  }));
}

describe("runStopCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    spawnMock.mockReset();
    rmMock.mockReset();
    readManagedStateMock.mockReset();
    writeManagedStateMock.mockReset();
    stopManagedMnaMock.mockReset();
    stopLegacyAxisProcessesMock.mockReset();
    removeDockerContainerMock.mockReset();
    removeDockerImageMock.mockReset();
    removeDockerImageMock.mockResolvedValue(false);
  });

  it("clears managed runtime residue but keeps persisted config files untouched", async () => {
    mockSpawnExit(0);
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      postgres: {
        containerName: "axis-stack",
        port: 54329,
        database: "axis_db",
        username: "axis_user",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
    removeDockerContainerMock.mockResolvedValue(true);

    await runStopCommand();

    expect(rmMock).toHaveBeenCalledWith(
      path.join("C:/Users/test/.axis/managed", "mna", "token.txt"),
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(rmMock).toHaveBeenCalledWith(
      path.join("C:/Users/test/.axis/managed", "mna", "sessions.db"),
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(rmMock).toHaveBeenCalledWith(
      path.join("C:/Users/test/.axis/managed", "mna", "artifacts"),
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(rmMock).toHaveBeenCalledWith(
      path.join("C:/Users/test/.axis", "stack-stage"),
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(rmMock).toHaveBeenCalledWith(
      "C:/Users/test/.axis/logs",
      expect.objectContaining({ recursive: true, force: true }),
    );

    const cleanedTargets = rmMock.mock.calls.map((call) => call[0]);
    expect(cleanedTargets).not.toContain("C:/Users/test/.axis/managed/mna/config.json");
    expect(cleanedTargets).not.toContain("C:/Users/test/.axis/managed/embedding-config.json");
  });

  it("stops visualization dev when it is recorded in managed state", async () => {
    mockSpawnExit(0);
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      postgres: {
        containerName: "axis-stack",
        port: 54329,
        database: "axis_db",
        username: "axis_user",
      },
      services: [
        {
          name: "visualization-dev",
          pid: 5566,
          logPath: "C:/Users/test/.axis/logs/visualization-dev.log",
          url: "http://127.0.0.1:3003",
        },
      ],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
    removeDockerContainerMock.mockResolvedValue(true);

    await runStopCommand();

    const spawnCommands = spawnMock.mock.calls.map((call) => [call[0], ...(Array.isArray(call[1]) ? call[1] : [])].join(" "));
    expect(spawnCommands.some((command) => command.includes("taskkill /PID 5566 /T /F"))).toBe(true);
  });

  it("still clears local runtime residue before surfacing docker removal failures", async () => {
    mockSpawnExit(0);
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      postgres: {
        containerName: "axis-stack",
        port: 54329,
        database: "axis_db",
        username: "axis_user",
      },
      services: [],
    });
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
    removeDockerContainerMock.mockRejectedValue(new Error("docker rm -f axis-stack failed with exit code 2"));

    await expect(runStopCommand()).rejects.toThrow(/docker rm -f axis-stack/);
    expect(rmMock).toHaveBeenCalledTimes(5);
    expect(writeManagedStateMock).toHaveBeenCalledWith({
      version: 1,
      dbPassword: undefined,
      services: [],
    });
  });

  it("treats missing containers as a successful stop and still clears runtime residue", async () => {
    mockSpawnExit(0);
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      postgres: {
        containerName: "axis-stack",
        port: 54329,
        database: "axis_db",
        username: "axis_user",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
    removeDockerContainerMock.mockResolvedValue(false);

    await expect(runStopCommand()).resolves.toBeUndefined();
    expect(rmMock).toHaveBeenCalledTimes(5);
    expect(writeManagedStateMock).toHaveBeenCalledWith({
      version: 1,
      dbPassword: undefined,
      services: [],
    });
  });

  it("preserves the generated managed database password across stop", async () => {
    mockSpawnExit(0);
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      dbPassword: "persisted-password",
      postgres: {
        containerName: "axis-stack",
        port: 54329,
        database: "axis_db",
        username: "axis_user",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
    removeDockerContainerMock.mockResolvedValue(true);

    await runStopCommand();

    expect(writeManagedStateMock).toHaveBeenCalledWith({
      version: 1,
      dbPassword: "persisted-password",
      services: [],
    });
  });

  it("removes the old managed Docker image on stop", async () => {
    mockSpawnExit(0);
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
    removeDockerContainerMock.mockResolvedValue(false);
    removeDockerImageMock.mockResolvedValue(true);

    await runStopCommand();

    expect(removeDockerImageMock).toHaveBeenCalledWith();
  });
});

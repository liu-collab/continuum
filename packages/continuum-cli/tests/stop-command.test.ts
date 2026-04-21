import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const spawnMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
const readManagedStateMock = vi.hoisted(() => vi.fn());
const writeManagedStateMock = vi.hoisted(() => vi.fn());
const stopManagedMnaMock = vi.hoisted(() => vi.fn());
const stopLegacyContinuumProcessesMock = vi.hoisted(() => vi.fn());

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
    continuumLogsDir: vi.fn(() => "C:/Users/test/.continuum/logs"),
    continuumManagedDir: vi.fn(() => "C:/Users/test/.continuum/managed"),
    readManagedState: readManagedStateMock,
    writeManagedState: writeManagedStateMock,
  };
});

vi.mock("../src/mna-command.js", () => ({
  stopManagedMna: stopManagedMnaMock,
}));

vi.mock("../src/process-cleanup.js", () => ({
  stopLegacyContinuumProcesses: stopLegacyContinuumProcessesMock,
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
    stopLegacyContinuumProcessesMock.mockReset();
  });

  it("clears managed runtime residue but keeps persisted config files untouched", async () => {
    mockSpawnExit(0);
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      postgres: {
        containerName: "continuum-stack",
        port: 54329,
        database: "continuum",
        username: "continuum",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyContinuumProcessesMock.mockResolvedValue(undefined);

    await runStopCommand();

    expect(rmMock).toHaveBeenCalledWith(
      path.join("C:/Users/test/.continuum/managed", "mna", "token.txt"),
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(rmMock).toHaveBeenCalledWith(
      path.join("C:/Users/test/.continuum/managed", "mna", ".mna", "sessions.db"),
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(rmMock).toHaveBeenCalledWith(
      path.join("C:/Users/test/.continuum/managed", "mna", ".mna", "artifacts"),
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(rmMock).toHaveBeenCalledWith(
      "C:/Users/test/.continuum/logs",
      expect.objectContaining({ recursive: true, force: true }),
    );

    const cleanedTargets = rmMock.mock.calls.map((call) => call[0]);
    expect(cleanedTargets).not.toContain("C:/Users/test/.continuum/managed/mna/config.json");
    expect(cleanedTargets).not.toContain("C:/Users/test/.continuum/managed/embedding-config.json");
  });

  it("still clears local runtime residue before surfacing docker removal failures", async () => {
    mockSpawnExit(1);
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      postgres: {
        containerName: "continuum-stack",
        port: 54329,
        database: "continuum",
        username: "continuum",
      },
      services: [],
    });
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyContinuumProcessesMock.mockResolvedValue(undefined);

    await expect(runStopCommand()).rejects.toThrow(/docker rm -f continuum-stack/);
    expect(rmMock).toHaveBeenCalledTimes(4);
    expect(writeManagedStateMock).toHaveBeenCalledWith({
      version: 1,
      services: [],
    });
  });

  it("treats missing containers as a successful stop and still clears runtime residue", async () => {
    spawnMock.mockImplementation(() => {
      let stderrHandler: ((chunk: string) => void) | undefined;
      return {
        stderr: {
          on(event: string, handler: (chunk: string) => void) {
            if (event === "data") {
              stderrHandler = handler;
            }
            return this;
          },
        },
        on(event: string, handler: (code?: number) => void) {
          if (event === "exit") {
            setImmediate(() => {
              stderrHandler?.("Error response from daemon: No such container: continuum-stack");
              handler(1);
            });
          }
          return this;
        },
      };
    });
    rmMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      postgres: {
        containerName: "continuum-stack",
        port: 54329,
        database: "continuum",
        username: "continuum",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyContinuumProcessesMock.mockResolvedValue(undefined);

    await expect(runStopCommand()).resolves.toBeUndefined();
    expect(rmMock).toHaveBeenCalledTimes(4);
    expect(writeManagedStateMock).toHaveBeenCalledWith({
      version: 1,
      services: [],
    });
  });
});

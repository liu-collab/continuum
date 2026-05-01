import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.hoisted(() => vi.fn());
const readManagedStateMock = vi.hoisted(() => vi.fn());
const writeManagedStateMock = vi.hoisted(() => vi.fn());
const resolveLiteRuntimePortMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../src/managed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-state.js")>();
  return {
    ...actual,
    axisLogsDir: vi.fn(() => "C:/tmp/.axis/logs"),
    readManagedState: readManagedStateMock,
    writeManagedState: writeManagedStateMock,
  };
});

vi.mock("../src/port-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/port-utils.js")>();
  return {
    ...actual,
    resolveLiteRuntimePort: resolveLiteRuntimePortMock,
  };
});

import { runRuntimeCommand } from "../src/runtime-command.js";

function createChildProcess() {
  return new EventEmitter();
}

describe("axis runtime command", () => {
  beforeEach(() => {
    resolveLiteRuntimePortMock.mockResolvedValue(3002);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    spawnMock.mockReset();
    readManagedStateMock.mockReset();
    writeManagedStateMock.mockReset();
    resolveLiteRuntimePortMock.mockReset();
    delete process.env.PORT;
    delete process.env.RUNTIME_PORT;
  });

  it("starts lite runtime by default", async () => {
    spawnMock.mockReturnValue(createChildProcess());

    await runRuntimeCommand(import.meta.url, {});

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("runtime"), "--lite"],
      expect.objectContaining({
        stdio: "inherit",
        env: expect.objectContaining({
          HOST: "127.0.0.1",
          PORT: "3002",
        }),
      }),
    );
    expect(resolveLiteRuntimePortMock).toHaveBeenCalledWith("127.0.0.1", 3002);
  });

  it("starts lite runtime hidden in background when requested", async () => {
    const child = createChildProcess() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    spawnMock.mockReturnValue(child);

    await runRuntimeCommand(import.meta.url, { background: true });

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("runtime"), "--lite"],
      expect.objectContaining({
        stdio: "ignore",
        detached: true,
        windowsHide: true,
        env: expect.objectContaining({
          HOST: "127.0.0.1",
          PORT: "3002",
        }),
      }),
    );
    expect(child.unref).toHaveBeenCalled();
    expect(writeManagedStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        services: expect.arrayContaining([
          expect.objectContaining({
            name: "lite-runtime",
            pid: expect.any(Number),
            url: "http://127.0.0.1:3002",
          }),
          expect.objectContaining({
            name: "retrieval-runtime",
            pid: expect.any(Number),
            url: "http://127.0.0.1:3002",
          }),
        ]),
      }),
    );
  });

  it("starts full runtime when requested", async () => {
    spawnMock.mockReturnValue(createChildProcess());

    await runRuntimeCommand(import.meta.url, { full: true });

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("runtime")],
      expect.objectContaining({
        stdio: "inherit",
        env: expect.objectContaining({
          HOST: "127.0.0.1",
          PORT: "3002",
        }),
      }),
    );
    expect(resolveLiteRuntimePortMock).not.toHaveBeenCalled();
  });

  it("uses the resolved fallback port for lite runtime", async () => {
    spawnMock.mockReturnValue(createChildProcess());
    resolveLiteRuntimePortMock.mockResolvedValue(3007);

    await runRuntimeCommand(import.meta.url, {});

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("runtime"), "--lite"],
      expect.objectContaining({
        env: expect.objectContaining({
          PORT: "3007",
        }),
      }),
    );
  });
});

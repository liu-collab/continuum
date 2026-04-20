import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());
const openBrowserMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const readManagedEmbeddingConfigMock = vi.hoisted(() => vi.fn());
const writeManagedEmbeddingConfigMock = vi.hoisted(() => vi.fn());
const readManagedStateMock = vi.hoisted(() => vi.fn());
const writeManagedStateMock = vi.hoisted(() => vi.fn());
const startManagedMnaMock = vi.hoisted(() => vi.fn());
const stopLegacyContinuumProcessesMock = vi.hoisted(() => vi.fn());
const cpMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());

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
    cp: cpMock,
    mkdir: mkdirMock,
    rm: rmMock,
  };
});

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    fetchJson: fetchJsonMock,
    openBrowser: openBrowserMock,
    pathExists: pathExistsMock,
  };
});

vi.mock("../src/managed-config.js", () => ({
  continuumManagedEmbeddingConfigPath: vi.fn(),
  readManagedEmbeddingConfig: readManagedEmbeddingConfigMock,
  writeManagedEmbeddingConfig: writeManagedEmbeddingConfigMock,
}));

vi.mock("../src/managed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-state.js")>();
  return {
    ...actual,
    readManagedState: readManagedStateMock,
    writeManagedState: writeManagedStateMock,
  };
});

vi.mock("../src/mna-command.js", () => ({
  DEFAULT_MNA_PORT: 4193,
  startManagedMna: startManagedMnaMock,
}));

vi.mock("../src/process-cleanup.js", () => ({
  stopLegacyContinuumProcesses: stopLegacyContinuumProcessesMock,
}));

import { runStartCommand } from "../src/start-command.js";

function mockSuccessfulSpawn() {
  spawnMock.mockImplementation(() => ({
    on(event: string, handler: (code?: number) => void) {
      if (event === "exit") {
        setImmediate(() => handler(0));
      }
      return this;
    },
    unref() {
      return undefined;
    },
  }));
}

describe("runStartCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    spawnMock.mockReset();
    fetchJsonMock.mockReset();
    openBrowserMock.mockReset();
    pathExistsMock.mockReset();
    readManagedEmbeddingConfigMock.mockReset();
    writeManagedEmbeddingConfigMock.mockReset();
    readManagedStateMock.mockReset();
    writeManagedStateMock.mockReset();
    startManagedMnaMock.mockReset();
    stopLegacyContinuumProcessesMock.mockReset();
    cpMock.mockReset();
    mkdirMock.mockReset();
    rmMock.mockReset();
  });

  it("cleans the managed stack container when startup fails after docker run", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyContinuumProcessesMock.mockResolvedValue(undefined);
    cpMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    fetchJsonMock.mockResolvedValue({ ok: true, body: {} });
    startManagedMnaMock.mockRejectedValue(new Error("mna failed"));

    await expect(runStartCommand({}, import.meta.url)).rejects.toThrow(/mna failed/);

    const spawnCommands = spawnMock.mock.calls.map((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return [command, ...args].join(" ");
    });

    expect(
      spawnCommands.some(
        (command) =>
          command.includes("docker rm -f continuum-stack"),
      ),
    ).toBe(true);
  }, 130_000);
});

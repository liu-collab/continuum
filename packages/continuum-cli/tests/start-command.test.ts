import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());
const openBrowserMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const readManagedEmbeddingConfigMock = vi.hoisted(() => vi.fn());
const readManagedWritebackLlmConfigMock = vi.hoisted(() => vi.fn());
const writeManagedEmbeddingConfigMock = vi.hoisted(() => vi.fn());
const writeManagedWritebackLlmConfigMock = vi.hoisted(() => vi.fn());
const readManagedStateMock = vi.hoisted(() => vi.fn());
const writeManagedStateMock = vi.hoisted(() => vi.fn());
const startManagedMnaMock = vi.hoisted(() => vi.fn());
const stopLegacyContinuumProcessesMock = vi.hoisted(() => vi.fn());
const cpMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
const planStackImageBuildMock = vi.hoisted(() => vi.fn());
const writeBuildStateMock = vi.hoisted(() => vi.fn());

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
  readManagedWritebackLlmConfig: readManagedWritebackLlmConfigMock,
  writeManagedEmbeddingConfig: writeManagedEmbeddingConfigMock,
  writeManagedWritebackLlmConfig: writeManagedWritebackLlmConfigMock,
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

vi.mock("../src/build-state-loader.js", () => ({
  loadBuildStateHelpers: vi.fn(async () => ({
    planStackImageBuild: planStackImageBuildMock,
    writeBuildState: writeBuildStateMock,
  })),
}));

import { resolveManagedPostgresPort, runStartCommand } from "../src/start-command.js";

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
    readManagedWritebackLlmConfigMock.mockReset();
    writeManagedEmbeddingConfigMock.mockReset();
    writeManagedWritebackLlmConfigMock.mockReset();
    readManagedStateMock.mockReset();
    writeManagedStateMock.mockReset();
    startManagedMnaMock.mockReset();
    stopLegacyContinuumProcessesMock.mockReset();
    cpMock.mockReset();
    mkdirMock.mockReset();
    rmMock.mockReset();
    planStackImageBuildMock.mockReset();
    writeBuildStateMock.mockReset();
  });

  it("cleans the managed stack container when startup fails after docker run", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedWritebackLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedWritebackLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyContinuumProcessesMock.mockResolvedValue(undefined);
    cpMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    planStackImageBuildMock.mockResolvedValue({
      needsBuild: true,
      nextState: {
        version: 2,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
    });
    writeBuildStateMock.mockResolvedValue(undefined);
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

  it("skips docker build when the managed stack image inputs are unchanged", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedWritebackLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedWritebackLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyContinuumProcessesMock.mockResolvedValue(undefined);
    cpMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    planStackImageBuildMock.mockResolvedValue({
      needsBuild: false,
      nextState: {
        version: 2,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
    });
    fetchJsonMock.mockResolvedValue({ ok: true, body: {} });
    startManagedMnaMock.mockResolvedValue({
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.continuum/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.continuum/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    const spawnCommands = spawnMock.mock.calls.map((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return [command, ...args].join(" ");
    });

    expect(
      spawnCommands.some((command) => command.includes("docker build -t continuum-local:latest")),
    ).toBe(false);
  });

  it("preserves managed writeback llm config when continuum start runs again", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedWritebackLlmConfigMock.mockResolvedValue({
      version: 1,
      baseUrl: "https://api.anthropic.com",
      model: "claude-haiku-4-5-20251001",
      apiKey: "writeback-key",
      protocol: "anthropic",
      timeoutMs: 8000,
    });
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedWritebackLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyContinuumProcessesMock.mockResolvedValue(undefined);
    cpMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    planStackImageBuildMock.mockResolvedValue({
      needsBuild: false,
      nextState: {
        version: 2,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
    });
    fetchJsonMock.mockResolvedValue({ ok: true, body: {} });
    startManagedMnaMock.mockResolvedValue({
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.continuum/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.continuum/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    expect(writeManagedWritebackLlmConfigMock).toHaveBeenCalledWith({
      version: 1,
      baseUrl: "https://api.anthropic.com",
      model: "claude-haiku-4-5-20251001",
      apiKey: "writeback-key",
      protocol: "anthropic",
      timeoutMs: 8000,
    });
  });

  it("falls back to the next available managed postgres port when default is unavailable", async () => {
    const probePort = vi
      .fn<(_: string, __: number) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const port = await resolveManagedPostgresPort({}, "127.0.0.1", probePort);

    expect(port).toBe(54330);
    expect(probePort).toHaveBeenNthCalledWith(1, "127.0.0.1", 54329);
    expect(probePort).toHaveBeenNthCalledWith(2, "127.0.0.1", 54330);
  });

  it("keeps the explicit postgres port when it is available", async () => {
    const probePort = vi.fn<(_: string, __: number) => Promise<boolean>>().mockResolvedValue(true);

    const port = await resolveManagedPostgresPort(
      { "postgres-port": "55432" },
      "127.0.0.1",
      probePort,
    );

    expect(port).toBe(55432);
    expect(probePort).toHaveBeenCalledWith("127.0.0.1", 55432);
  });

  it("fails fast when an explicit postgres port is unavailable", async () => {
    const probePort = vi.fn<(_: string, __: number) => Promise<boolean>>().mockResolvedValue(false);

    await expect(
      resolveManagedPostgresPort({ "postgres-port": "55432" }, "127.0.0.1", probePort),
    ).rejects.toThrow(/postgres 端口不可用/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());
const openBrowserMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const readManagedEmbeddingConfigMock = vi.hoisted(() => vi.fn());
const readManagedMemoryLlmConfigMock = vi.hoisted(() => vi.fn());
const readManagedWritebackLlmConfigMock = vi.hoisted(() => vi.fn());
const writeManagedEmbeddingConfigMock = vi.hoisted(() => vi.fn());
const writeManagedMemoryLlmConfigMock = vi.hoisted(() => vi.fn());
const writeManagedWritebackLlmConfigMock = vi.hoisted(() => vi.fn());
const readManagedStateMock = vi.hoisted(() => vi.fn());
const writeManagedStateMock = vi.hoisted(() => vi.fn());
const startManagedMnaMock = vi.hoisted(() => vi.fn());
const stopLegacyContinuumProcessesMock = vi.hoisted(() => vi.fn());
const cpMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
const planVendorBuildMock = vi.hoisted(() => vi.fn());
const planStackImageBuildMock = vi.hoisted(() => vi.fn());
const writeBuildStateMock = vi.hoisted(() => vi.fn());
const tcpPortAvailableMock = vi.hoisted(() =>
  vi.fn((_host: string, port: number) => port !== 54329)
);

vi.mock("node:net", () => ({
  createServer: () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();

    return {
      once(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler);
        return this;
      },
      close(callback?: () => void) {
        callback?.();
        return this;
      },
      listen(options: { host: string; port: number }) {
        setImmediate(() => {
          const available = tcpPortAvailableMock(options.host, options.port);
          const handler = handlers.get(available ? "listening" : "error");
          handler?.(available ? undefined : new Error("EADDRINUSE"));
        });
        return this;
      },
    };
  },
}));

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
  continuumManagedEmbeddingConfigPath: vi.fn(() => "C:/tmp/.continuum/managed/embedding-config.json"),
  continuumManagedMemoryLlmConfigPath: vi.fn(() => "C:/tmp/.continuum/managed/memory-llm-config.json"),
  readManagedEmbeddingConfig: readManagedEmbeddingConfigMock,
  readManagedMemoryLlmConfig: readManagedMemoryLlmConfigMock,
  readManagedWritebackLlmConfig: readManagedWritebackLlmConfigMock,
  writeManagedEmbeddingConfig: writeManagedEmbeddingConfigMock,
  writeManagedMemoryLlmConfig: writeManagedMemoryLlmConfigMock,
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
    planVendorBuild: planVendorBuildMock,
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
    once(event: string, handler: (code?: number) => void) {
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
    readManagedMemoryLlmConfigMock.mockReset();
    readManagedWritebackLlmConfigMock.mockReset();
    writeManagedEmbeddingConfigMock.mockReset();
    writeManagedMemoryLlmConfigMock.mockReset();
    writeManagedWritebackLlmConfigMock.mockReset();
    readManagedStateMock.mockReset();
    writeManagedStateMock.mockReset();
    startManagedMnaMock.mockReset();
    stopLegacyContinuumProcessesMock.mockReset();
    cpMock.mockReset();
    mkdirMock.mockReset();
    rmMock.mockReset();
    planVendorBuildMock.mockReset();
    planStackImageBuildMock.mockReset();
    writeBuildStateMock.mockReset();
    tcpPortAvailableMock.mockReset();
    tcpPortAvailableMock.mockImplementation((_host: string, port: number) => port !== 54329);
  });

  it("cleans the managed stack container when startup fails after docker run", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    readManagedWritebackLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
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
    planVendorBuildMock.mockResolvedValue({
      currentState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      nextState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      changedEntries: [],
      buildServices: [],
      needsRefresh: false,
    });
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
    planVendorBuildMock.mockResolvedValue({
      currentState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      nextState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      changedEntries: [],
      buildServices: [],
      needsRefresh: false,
    });
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
    planVendorBuildMock.mockResolvedValue({
      currentState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      nextState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      changedEntries: [],
      buildServices: [],
      needsRefresh: false,
    });
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

  it("passes the managed memory llm config path into the stack container env", async () => {
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
    planVendorBuildMock.mockResolvedValue({
      currentState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      nextState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      changedEntries: [],
      buildServices: [],
      needsRefresh: false,
    });
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

    const spawnCommands = spawnMock.mock.calls.map((call) => ({
      command: call[0],
      args: Array.isArray(call[1]) ? call[1] : [],
    }));

    const dockerRun = spawnCommands.find((call) =>
      call.command === "cmd"
      && call.args.includes("docker")
      && call.args.includes("run"),
    );

    expect(dockerRun).toBeDefined();
    expect(dockerRun?.args).toContain(
      "CONTINUUM_MEMORY_LLM_CONFIG_PATH=/opt/continuum/managed/memory-llm-config.json",
    );
  });

  it("passes the local managed memory llm config path into memory-native-agent", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    readManagedWritebackLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
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
    planVendorBuildMock.mockResolvedValue({
      currentState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      nextState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      changedEntries: [],
      buildServices: [],
      needsRefresh: false,
    });
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

    expect(startManagedMnaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        "memory-llm-config-path": "C:/tmp/.continuum/managed/memory-llm-config.json",
      }),
      import.meta.url,
    );
  });

  it("refreshes memory-native-agent vendor before start when the source changed", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    readManagedWritebackLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
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
    planVendorBuildMock
      .mockResolvedValueOnce({
        currentState: {
          version: 2,
          cli: null,
          image: {
            hash: "image-hash",
          },
          vendor: {
            entries: {},
            builds: {},
          },
        },
        nextState: {
          version: 2,
          cli: null,
          image: {
            hash: "image-hash",
          },
          vendor: {
            entries: {},
            builds: {},
          },
        },
        changedEntries: [],
        buildServices: [],
        needsRefresh: false,
      })
      .mockResolvedValueOnce({
        currentState: {
          version: 2,
          cli: null,
          image: {
            hash: "image-hash",
          },
          vendor: {
            entries: {
              "memory-native-agent": "old-mna-entry",
            },
            builds: {
              "memory-native-agent": "old-mna-build",
            },
          },
        },
        nextState: {
          version: 2,
          cli: null,
          image: {
            hash: "image-hash",
          },
          vendor: {
            entries: {
              "memory-native-agent": "new-mna-entry",
            },
            builds: {
              "memory-native-agent": "new-mna-build",
            },
          },
        },
        changedEntries: ["memory-native-agent"],
        buildServices: ["memory-native-agent"],
        needsRefresh: true,
      });
    planStackImageBuildMock.mockResolvedValue({
      needsBuild: false,
      nextState: {
        version: 2,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {
            "memory-native-agent": "new-mna-entry",
          },
          builds: {
            "memory-native-agent": "new-mna-build",
          },
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

    expect(spawnMock).toHaveBeenCalledWith(
      "cmd",
      expect.arrayContaining(["/c", "npm", "run", "build"]),
      expect.objectContaining({
        cwd: expect.stringContaining("services\\memory-native-agent"),
      }),
    );
    expect(cpMock).toHaveBeenCalledWith(
      expect.stringContaining("services\\memory-native-agent\\bin"),
      expect.stringContaining("vendor\\memory-native-agent\\bin"),
      { recursive: true },
    );
  });

  it("refreshes visualization vendor before start when the visualization source changed", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedWritebackLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedWritebackLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "old-image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyContinuumProcessesMock.mockResolvedValue(undefined);
    cpMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    planVendorBuildMock.mockResolvedValue({
      currentState: {
        version: 2,
        cli: null,
        image: {
          hash: "old-image-hash",
        },
        vendor: {
          entries: {
            visualization: "old-visualization-entry",
          },
          builds: {
            visualization: "old-visualization-build",
          },
        },
      },
      nextState: {
        version: 2,
        cli: null,
        image: {
          hash: "old-image-hash",
        },
        vendor: {
          entries: {
            visualization: "new-visualization-entry",
          },
          builds: {
            visualization: "new-visualization-build",
          },
        },
      },
      changedEntries: ["visualization"],
      buildServices: ["visualization"],
      needsRefresh: true,
    });
    planStackImageBuildMock.mockResolvedValue({
      needsBuild: true,
      nextState: {
        version: 2,
        image: {
          hash: "new-image-hash",
        },
        vendor: {
          entries: {
            visualization: "new-visualization-entry",
          },
          builds: {
            visualization: "new-visualization-build",
          },
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

    const npmVisualizationBuild = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      const options = call[2] as { cwd?: string } | undefined;
      return command === "cmd"
        && args.includes("npm")
        && args.includes("run")
        && args.includes("build")
        && options?.cwd?.includes("services\\visualization");
    });

    expect(npmVisualizationBuild).toBeDefined();
    expect(writeBuildStateMock).toHaveBeenCalledWith({
      version: 2,
      cli: null,
      image: {
        hash: "old-image-hash",
      },
      vendor: {
        entries: {
          visualization: "new-visualization-entry",
        },
        builds: {
          visualization: "new-visualization-build",
        },
      },
    });
  });

  it("starts visualization in local dev mode when ui-dev is enabled", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedWritebackLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedWritebackLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock
      .mockResolvedValueOnce({
        version: 2,
        image: {
          hash: "image-hash",
        },
        services: [],
      })
      .mockResolvedValueOnce({
        version: 2,
        image: {
          hash: "image-hash",
        },
        services: [],
      })
      .mockResolvedValueOnce({
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
    planVendorBuildMock.mockResolvedValue({
      currentState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      nextState: {
        version: 2,
        cli: null,
        image: {
          hash: "image-hash",
        },
        vendor: {
          entries: {},
          builds: {},
        },
      },
      changedEntries: [],
      buildServices: [],
      needsRefresh: false,
    });
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

    await runStartCommand({ "ui-dev": true }, import.meta.url);

    const dockerRun = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return command === "cmd" && args.includes("docker") && args.includes("run");
    });
    const uiDevSpawn = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      const options = call[2] as { cwd?: string; env?: Record<string, string> } | undefined;
      return (command === "cmd.exe" || command === "npm.cmd")
        && options?.cwd?.includes("services\\visualization");
    });

    expect(dockerRun?.[1]).not.toContain("127.0.0.1:3003:3003");
    expect(uiDevSpawn).toBeDefined();
    expect((uiDevSpawn?.[2] as { env?: Record<string, string> } | undefined)?.env).toMatchObject({
      STORAGE_READ_MODEL_DSN: "postgres://continuum:continuum_local_dev@127.0.0.1:54330/continuum",
      STORAGE_READ_MODEL_SCHEMA: "storage_shared_v1",
      STORAGE_READ_MODEL_TABLE: "memory_read_model_v1",
    });
    expect(fetchJsonMock).toHaveBeenCalledWith("http://127.0.0.1:3003/api/health/readiness", 1_500);
    expect(writeManagedStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        services: expect.arrayContaining([
          expect.objectContaining({
            name: "visualization-dev",
            url: "http://127.0.0.1:3003",
          }),
        ]),
      }),
    );
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

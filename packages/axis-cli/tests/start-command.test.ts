import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());
const waitForHealthyMock = vi.hoisted(() => vi.fn());
const openBrowserMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const readManagedEmbeddingConfigMock = vi.hoisted(() => vi.fn());
const readManagedMnaProviderConfigMock = vi.hoisted(() => vi.fn());
const readManagedMemoryLlmConfigMock = vi.hoisted(() => vi.fn());
const writeManagedEmbeddingConfigMock = vi.hoisted(() => vi.fn());
const writeManagedMemoryLlmConfigMock = vi.hoisted(() => vi.fn());
const migrateManagedConfigFilesMock = vi.hoisted(() => vi.fn());
const readManagedStateMock = vi.hoisted(() => vi.fn());
const writeManagedStateMock = vi.hoisted(() => vi.fn());
const startManagedMnaMock = vi.hoisted(() => vi.fn());
const stopLegacyAxisProcessesMock = vi.hoisted(() => vi.fn());
const cpMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
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
    open: openMock,
    rm: rmMock,
    writeFile: writeFileMock,
  };
});

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    fetchJson: fetchJsonMock,
    waitForHealthy: waitForHealthyMock,
    openBrowser: openBrowserMock,
    pathExists: pathExistsMock,
  };
});

vi.mock("../src/managed-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-config.js")>();
  return {
    ...actual,
    axisManagedConfigPath: vi.fn(() => "C:/tmp/.axis/managed/config.json"),
    axisManagedSecretsPath: vi.fn(() => "C:/tmp/.axis/managed/secrets.json"),
    axisManagedEmbeddingConfigPath: vi.fn(() => "C:/tmp/.axis/managed/embedding-config.json"),
    axisManagedMemoryLlmConfigPath: vi.fn(() => "C:/tmp/.axis/managed/memory-llm-config.json"),
    migrateManagedConfigFiles: migrateManagedConfigFilesMock,
    readManagedEmbeddingConfig: readManagedEmbeddingConfigMock,
    readManagedMnaProviderConfig: readManagedMnaProviderConfigMock,
    readManagedMemoryLlmConfig: readManagedMemoryLlmConfigMock,
    writeManagedEmbeddingConfig: writeManagedEmbeddingConfigMock,
    writeManagedMemoryLlmConfig: writeManagedMemoryLlmConfigMock,
  };
});

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
  stopLegacyAxisProcesses: stopLegacyAxisProcessesMock,
}));

vi.mock("../src/build-state-loader.js", () => ({
  loadBuildStateHelpers: vi.fn(async () => ({
    planVendorBuild: planVendorBuildMock,
    planStackImageBuild: planStackImageBuildMock,
    writeBuildState: writeBuildStateMock,
  })),
}));

import { resolveManagedPostgresPort, runStartCommand } from "../src/start-command.js";
import { assertFixedServicePortsAvailable } from "../src/port-utils.js";

function mockSuccessfulSpawn(options: { axisStackRunning?: boolean } = {}) {
  const axisStackRunning = options.axisStackRunning ?? true;
  spawnMock.mockImplementation((command: string, args: string[] = []) => {
    const isDockerInspectAxisStack =
      command === "cmd"
      && args.includes("docker")
      && args.includes("inspect")
      && args.includes("axis-stack");
    return {
      stdout: {
        setEncoding: vi.fn(),
        on(event: string, handler: (chunk: string) => void) {
          if (event === "data" && isDockerInspectAxisStack) {
            setImmediate(() => handler(`${axisStackRunning ? "true" : "false"}\n`));
          }
          return this;
        },
      },
      stderr: {
        setEncoding: vi.fn(),
        on() {
          return this;
        },
      },
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
    };
  });
}

describe("runStartCommand", () => {
  beforeEach(() => {
    process.env.AXIS_DB_PASSWORD = "test-db-password";
    process.env.PLATFORM_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
    waitForHealthyMock.mockResolvedValue(undefined);
    readManagedMnaProviderConfigMock.mockResolvedValue(null);
    migrateManagedConfigFilesMock.mockResolvedValue(undefined);
    openMock.mockResolvedValue({
      fd: 1,
      close: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    spawnMock.mockReset();
    fetchJsonMock.mockReset();
    waitForHealthyMock.mockReset();
    openBrowserMock.mockReset();
    pathExistsMock.mockReset();
    readManagedEmbeddingConfigMock.mockReset();
    readManagedMnaProviderConfigMock.mockReset();
    readManagedMemoryLlmConfigMock.mockReset();
    writeManagedEmbeddingConfigMock.mockReset();
    writeManagedMemoryLlmConfigMock.mockReset();
    migrateManagedConfigFilesMock.mockReset();
    readManagedStateMock.mockReset();
    writeManagedStateMock.mockReset();
    startManagedMnaMock.mockReset();
    stopLegacyAxisProcessesMock.mockReset();
    cpMock.mockReset();
    mkdirMock.mockReset();
    openMock.mockReset();
    rmMock.mockReset();
    writeFileMock.mockReset();
    planVendorBuildMock.mockReset();
    planStackImageBuildMock.mockReset();
    writeBuildStateMock.mockReset();
    tcpPortAvailableMock.mockReset();
    tcpPortAvailableMock.mockImplementation((_host: string, port: number) => port !== 54329);
    readManagedMnaProviderConfigMock.mockResolvedValue(null);
    migrateManagedConfigFilesMock.mockResolvedValue(undefined);
    delete process.env.AXIS_DB_PASSWORD;
    delete process.env.PLATFORM_USER_ID;
    delete process.env.STORAGE_PORT;
    delete process.env.RUNTIME_PORT;
    delete process.env.UI_PORT;
    delete process.env.VISUALIZATION_PORT;
  });

  it("cleans the managed stack container when startup fails after docker run", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
          command.includes("docker rm -f axis-stack"),
      ),
    ).toBe(true);
  }, 130_000);

  it("skips docker build when the managed stack image inputs are unchanged", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    const spawnCommands = spawnMock.mock.calls.map((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return [command, ...args].join(" ");
    });

    expect(
      spawnCommands.some((command) => command.includes("docker build -t axis-stack:latest")),
    ).toBe(false);
  });

  it("prints clear progress steps while starting the managed stack", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "old-image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
          entries: {},
          builds: {},
        },
      },
      nextState: {
        version: 2,
        cli: null,
        image: {
          hash: "old-image-hash",
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
          hash: "new-image-hash",
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("正在检查 Docker");
    expect(output).toContain("✓ Docker 检查完成");
    expect(output).toContain("正在构建服务镜像（首次约 3-8 分钟）");
    expect(output).toContain("✓ 服务镜像构建完成");
    expect(output).toContain("正在启动数据库");
    expect(output).toContain("✓ 数据库启动命令已提交");
    expect(output).toContain("正在等待服务就绪");
    expect(output).toContain("✓ 服务已就绪");
    expect(output).toContain("Axis 已启动，打开 http://127.0.0.1:3003");
  });

  it("migrates legacy managed config files when axis start runs again", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue({
      version: 1,
      baseUrl: "https://api.anthropic.com",
      model: "claude-haiku-4-5-20251001",
      apiKey: "memory-key",
      protocol: "anthropic",
      timeoutMs: 8000,
    });
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    expect(migrateManagedConfigFilesMock).toHaveBeenCalled();
    expect(writeManagedMemoryLlmConfigMock).toHaveBeenCalledWith({
      version: 1,
      baseUrl: "https://api.anthropic.com",
      model: "claude-haiku-4-5-20251001",
      apiKey: "memory-key",
      protocol: "anthropic",
      timeoutMs: 8000,
    });
  });

  it("passes the managed config paths into the stack container env", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
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
    expect(dockerRun?.args).toContain("AXIS_MANAGED_CONFIG_PATH=/opt/axis/managed/config.json");
    expect(dockerRun?.args).toContain("AXIS_MANAGED_SECRETS_PATH=/opt/axis/managed/secrets.json");
  });

  it("merges memory llm CLI options over environment and persisted config", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    process.env.MEMORY_LLM_BASE_URL = "https://env.example.com/v1";
    process.env.MEMORY_LLM_MODEL = "env-model";
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue({
      version: 1,
      model: "persisted-model",
      apiKey: "persisted-key",
      timeoutMs: 8000,
    });
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    try {
      await runStartCommand(
        {
          "memory-llm-model": "cli-model",
          "memory-llm-timeout-ms": "9000",
        },
        import.meta.url,
      );
    } finally {
      delete process.env.MEMORY_LLM_BASE_URL;
      delete process.env.MEMORY_LLM_MODEL;
    }

    expect(writeManagedMemoryLlmConfigMock).toHaveBeenCalledWith({
      version: 1,
      baseUrl: "https://env.example.com/v1",
      model: "cli-model",
      apiKey: "persisted-key",
      timeoutMs: 9000,
    });
  });

  it("uses and persists the managed database password when starting the stack container", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      dbPassword: "persisted-db-password",
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    const dockerRun = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return command === "cmd" && args.includes("docker") && args.includes("run");
    });

    expect(dockerRun?.[1]).toContain("POSTGRES_PASSWORD=persisted-db-password");
    expect(dockerRun?.[1]).toContain("DATABASE_URL=postgres://axis_user:persisted-db-password@127.0.0.1:5432/axis_db");
    expect(dockerRun?.[1]).toContain("PLATFORM_USER_ID=550e8400-e29b-41d4-a716-446655440000");
    expect(writeManagedStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dbPassword: "persisted-db-password",
      }),
    );
  });

  it("passes the local managed memory llm config path into memory-native-agent", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    expect(startManagedMnaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        "managed-config-path": "C:/tmp/.axis/managed/config.json",
        "managed-secrets-path": "C:/tmp/.axis/managed/secrets.json",
      }),
      import.meta.url,
    );
  });

  it("refreshes memory-native-agent vendor before start when the source changed", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    expect(spawnMock).toHaveBeenCalledWith(
      "cmd",
      expect.arrayContaining(["/c", "npm.cmd", "run", "build"]),
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
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 2,
      image: {
        hash: "old-image-hash",
      },
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({}, import.meta.url);

    const npmVisualizationBuild = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      const options = call[2] as { cwd?: string } | undefined;
      return command === "cmd"
        && args.includes("npm.cmd")
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
    readManagedStateMock
      .mockResolvedValueOnce({
        version: 1,
        postgres: {
          containerName: "axis-stack",
          port: 54330,
          database: "axis_db",
          username: "axis_user",
        },
        services: [],
      })
      .mockResolvedValueOnce({
        version: 1,
        postgres: {
          containerName: "axis-stack",
          port: 54330,
          database: "axis_db",
          username: "axis_user",
        },
        services: [],
      })
      .mockResolvedValueOnce({
        version: 1,
        postgres: {
          containerName: "axis-stack",
          port: 54330,
          database: "axis_db",
          username: "axis_user",
        },
        services: [],
      });
    writeManagedStateMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
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
    startManagedMnaMock.mockResolvedValue({
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (
        url === "http://127.0.0.1:3001/health"
        || url === "http://127.0.0.1:3002/healthz"
        || url === "http://127.0.0.1:3003/api/health/readiness"
      ) {
        return { ok: true, body: {} };
      }

      return { ok: false, error: "unexpected url" };
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

    expect(stopLegacyAxisProcessesMock).not.toHaveBeenCalled();
    expect(startManagedMnaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        "runtime-url": "http://127.0.0.1:3002",
        "managed-config-path": "C:/tmp/.axis/managed/config.json",
        "managed-secrets-path": "C:/tmp/.axis/managed/secrets.json",
      }),
      import.meta.url,
    );
    expect(planVendorBuildMock).toHaveBeenCalled();
    expect(planStackImageBuildMock).not.toHaveBeenCalled();
    expect(dockerRun).toBeUndefined();
    expect(uiDevSpawn).toBeDefined();
    expect((uiDevSpawn?.[2] as { env?: Record<string, string> } | undefined)?.env).toMatchObject({
      PLATFORM_USER_ID: "550e8400-e29b-41d4-a716-446655440000",
      STORAGE_READ_MODEL_DSN: "postgres://axis_user:test-db-password@127.0.0.1:54330/axis_db",
      STORAGE_READ_MODEL_SCHEMA: "storage_shared_v1",
      STORAGE_READ_MODEL_TABLE: "memory_read_model_v1",
      NEXT_PUBLIC_MNA_BASE_URL: "http://127.0.0.1:4193",
      MNA_TOKEN_PATH: "C:/tmp/.axis/managed/mna/token.txt",
    });
    expect(waitForHealthyMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3003/api/health/readiness",
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
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

  it("starts backend services and local visualization dev when ui-dev is enabled and backend is down", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock
      .mockResolvedValueOnce({
        version: 1,
        services: [],
      })
      .mockResolvedValue({
        version: 1,
        services: [],
      });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
    fetchJsonMock.mockImplementation(async (url: string) => {
      const matchingCalls = fetchJsonMock.mock.calls.filter((call) => call[0] === url).length;
      if (url === "http://127.0.0.1:3001/health" || url === "http://127.0.0.1:3002/healthz") {
        return matchingCalls === 1 ? { ok: false, error: "not started" } : { ok: true, body: {} };
      }

      if (url === "http://127.0.0.1:3003/api/health/readiness") {
        return { ok: true, body: {} };
      }

      return { ok: false, error: "unexpected url" };
    });
    startManagedMnaMock.mockResolvedValue({
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({ "ui-dev": true }, import.meta.url);

    const spawnCommands = spawnMock.mock.calls.map((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return [command, ...args].join(" ");
    });
    const dockerRun = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return command === "cmd" && args.includes("docker") && args.includes("run");
    });
    const uiDevSpawn = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const options = call[2] as { cwd?: string } | undefined;
      return command === "cmd.exe" && options?.cwd?.includes("services\\visualization");
    });

    expect(stopLegacyAxisProcessesMock).toHaveBeenCalled();
    expect(planVendorBuildMock).toHaveBeenCalled();
    expect(planStackImageBuildMock).toHaveBeenCalled();
    expect(spawnCommands.some((command) => command.includes("docker build -t axis-local-ui-dev:latest"))).toBe(true);
    expect(spawnCommands.some((command) => command.includes("services\\visualization") && command.includes("npm run build"))).toBe(false);
    expect(dockerRun?.[1]).toContain("AXIS_DISABLE_STACK_VISUALIZATION=1");
    expect(dockerRun?.[1]).not.toContain("127.0.0.1:3003:3003");
    expect(startManagedMnaMock).toHaveBeenCalled();
    expect(uiDevSpawn).toBeDefined();
  });

  it("does not reuse healthy-looking ui-dev backend when axis-stack is not running", async () => {
    mockSuccessfulSpawn({ axisStackRunning: false });
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock.mockResolvedValue({
      version: 1,
      services: [],
    });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
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
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({ "ui-dev": true }, import.meta.url);

    const spawnCommands = spawnMock.mock.calls.map((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return [command, ...args].join(" ");
    });

    expect(stopLegacyAxisProcessesMock).toHaveBeenCalled();
    expect(planStackImageBuildMock).toHaveBeenCalled();
    expect(spawnCommands.some((command) => command.includes("docker run"))).toBe(true);
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

  it("reports occupied fixed service ports with the matching env override", async () => {
    const probePort = vi
      .fn<(_: string, __: number) => Promise<boolean>>()
      .mockResolvedValueOnce(false);

    await expect(
      assertFixedServicePortsAvailable("127.0.0.1", [{ port: 3001, envName: "STORAGE_PORT" }], probePort),
    ).rejects.toThrow(/端口 3001 已被占用.*STORAGE_PORT 环境变量（不是 CLI flag）/);
  });

  it("reuses healthy backend services and only restarts local visualization when ui-dev is enabled", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedEmbeddingConfigMock.mockResolvedValue(null);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedEmbeddingConfigMock.mockResolvedValue(undefined);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);
    readManagedStateMock
      .mockResolvedValueOnce({
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
            pid: 111,
            logPath: "C:/tmp/.axis/logs/visualization-dev.log",
            url: "http://127.0.0.1:3003",
          },
        ],
      })
      .mockResolvedValueOnce({
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
            pid: 111,
            logPath: "C:/tmp/.axis/logs/visualization-dev.log",
            url: "http://127.0.0.1:3003",
          },
        ],
      })
      .mockResolvedValueOnce({
        version: 1,
        postgres: {
          containerName: "axis-stack",
          port: 54329,
          database: "axis_db",
          username: "axis_user",
        },
        services: [],
      })
      .mockResolvedValueOnce({
        version: 1,
        postgres: {
          containerName: "axis-stack",
          port: 54329,
          database: "axis_db",
          username: "axis_user",
        },
        services: [
          {
            name: "memory-native-agent",
            pid: 222,
            logPath: "C:/tmp/.axis/logs/mna.log",
            url: "http://127.0.0.1:4193",
          },
        ],
      });
    writeManagedStateMock.mockResolvedValue(undefined);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
    cpMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
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
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (
        url === "http://127.0.0.1:3001/health"
        || url === "http://127.0.0.1:3002/healthz"
        || url === "http://127.0.0.1:3003/api/health/readiness"
      ) {
        return { ok: true, body: {} };
      }
      return { ok: false, error: "unexpected url" };
    });
    startManagedMnaMock.mockResolvedValue({
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      version: "0.1.0",
    });

    await runStartCommand({ "ui-dev": true }, import.meta.url);

    const spawnCommands = spawnMock.mock.calls.map((call) => {
      const command = call[0];
      const args = Array.isArray(call[1]) ? call[1] : [];
      return [command, ...args].join(" ");
    });
    const uiDevSpawn = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const options = call[2] as { cwd?: string; env?: Record<string, string> } | undefined;
      return command === "cmd.exe" && options?.cwd?.includes("services\\visualization");
    });

    expect(stopLegacyAxisProcessesMock).not.toHaveBeenCalled();
    expect(planStackImageBuildMock).not.toHaveBeenCalled();
    expect(spawnCommands.some((command) => command.includes("docker run"))).toBe(false);
    expect(spawnCommands.some((command) => command.includes("docker build"))).toBe(false);
    expect(spawnCommands.some((command) => command.includes("npm run build"))).toBe(false);
    expect(rmMock).not.toHaveBeenCalledWith(
      expect.stringContaining("services\\visualization\\.next"),
      expect.anything(),
    );
    expect((uiDevSpawn?.[2] as { env?: Record<string, string> } | undefined)?.env).toMatchObject({
      STORAGE_READ_MODEL_DSN: "postgres://axis_user:test-db-password@127.0.0.1:54329/axis_db",
      STORAGE_READ_MODEL_SCHEMA: "storage_shared_v1",
      STORAGE_READ_MODEL_TABLE: "memory_read_model_v1",
      NEXT_PUBLIC_MNA_BASE_URL: "http://127.0.0.1:4193",
      MNA_TOKEN_PATH: "C:/tmp/.axis/managed/mna/token.txt",
    });
  });

  it("respects explicit mna connection options when ui-dev reuses healthy backend", async () => {
    mockSuccessfulSpawn();
    pathExistsMock.mockResolvedValue(true);
    readManagedStateMock
      .mockResolvedValueOnce({
        version: 1,
        postgres: {
          containerName: "axis-stack",
          port: 54330,
          database: "axis_db",
          username: "axis_user",
        },
        services: [],
      })
      .mockResolvedValueOnce({
        version: 1,
        postgres: {
          containerName: "axis-stack",
          port: 54330,
          database: "axis_db",
          username: "axis_user",
        },
        services: [],
      })
      .mockResolvedValueOnce({
        version: 1,
        postgres: {
          containerName: "axis-stack",
          port: 54330,
          database: "axis_db",
          username: "axis_user",
        },
        services: [],
      });
    writeManagedStateMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (
        url === "http://127.0.0.1:3001/health"
        || url === "http://127.0.0.1:3002/healthz"
        || url === "http://127.0.0.1:3003/api/health/readiness"
      ) {
        return { ok: true, body: {} };
      }

      return { ok: false, error: "unexpected url" };
    });

    await runStartCommand({
      "ui-dev": true,
      "mna-url": "http://127.0.0.1:5193",
      "mna-token-path": "C:/tmp/external-mna/token.txt",
    }, import.meta.url);

    const uiDevSpawn = spawnMock.mock.calls.find((call) => {
      const command = call[0];
      const options = call[2] as { cwd?: string; env?: Record<string, string> } | undefined;
      return command === "cmd.exe" && options?.cwd?.includes("services\\visualization");
    });

    expect(startManagedMnaMock).not.toHaveBeenCalled();
    expect(planVendorBuildMock).not.toHaveBeenCalled();
    expect((uiDevSpawn?.[2] as { env?: Record<string, string> } | undefined)?.env).toMatchObject({
      NEXT_PUBLIC_MNA_BASE_URL: "http://127.0.0.1:5193",
      MNA_TOKEN_PATH: "C:/tmp/external-mna/token.txt",
    });
  });
});

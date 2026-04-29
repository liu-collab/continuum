import { afterEach, describe, expect, it, vi } from "vitest";

const getManagedMnaStatusMock = vi.hoisted(() => vi.fn());
const readManagedStateMock = vi.hoisted(() => vi.fn());

readManagedStateMock.mockResolvedValue({
  version: 1,
  services: [],
});

vi.mock("../src/mna-command.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/mna-command.js")>();
  return {
    ...actual,
    getManagedMnaStatus: getManagedMnaStatusMock
  };
});

vi.mock("../src/managed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-state.js")>();
  return {
    ...actual,
    readManagedState: readManagedStateMock,
  };
});

const codexUseMock = vi.hoisted(() => vi.fn());

vi.mock("../src/codex-command.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/codex-command.js")>();
  return {
    ...actual,
    runCodexUseCommand: codexUseMock,
  };
});

import { parseArgs } from "../src/args.js";
import { runCli } from "../src/axis-cli.js";
import {
  buildEmbeddingsEndpoint,
  resolveOptionalThirdPartyEmbeddingConfig,
  resolveThirdPartyEmbeddingConfig,
} from "../src/embedding-config.js";
import { renderHelp } from "../src/help.js";
import {
  hasManagedMnaProviderOptionOverrides,
  resolveManagedMnaProviderConfig,
} from "../src/mna-provider-config.js";
import { runStatusCommand } from "../src/status-command.js";

describe("axis cli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getManagedMnaStatusMock.mockReset();
    codexUseMock.mockReset();
    readManagedStateMock.mockReset();
    readManagedStateMock.mockResolvedValue({
      version: 1,
      services: [],
    });
  });

  it("parses command and options", () => {
    const parsed = parseArgs(["status", "--json", "--runtime-url", "http://127.0.0.1:3002"]);

    expect(parsed.command).toEqual(["status"]);
    expect(parsed.options.json).toBe(true);
    expect(parsed.options["runtime-url"]).toBe("http://127.0.0.1:3002");
  });

  it("normalizes boolean option values", () => {
    const parsed = parseArgs([
      "codex",
      "use",
      "--json",
      "false",
      "--strict",
      "true",
      "--ensure-runtime",
      "false",
      "--runtime-url",
      "http://127.0.0.1:3002",
    ]);

    expect(parsed.options.json).toBe(false);
    expect(parsed.options.strict).toBe(true);
    expect(parsed.options["ensure-runtime"]).toBe(false);
    expect(parsed.options["runtime-url"]).toBe("http://127.0.0.1:3002");
  });

  it("parses the start command and exposes it in help", () => {
    const parsed = parseArgs([
      "start",
      "--open",
      "--ui-dev",
      "--postgres-port",
      "54329",
      "--bind-host",
      "0.0.0.0",
      "--embedding-base-url",
      "https://api.openai.com/v1",
      "--embedding-model",
      "text-embedding-3-small",
      "--provider-kind",
      "openai-compatible",
      "--provider-model",
      "deepseek-chat",
    ]);

    expect(parsed.command).toEqual(["start"]);
    expect(parsed.options.open).toBe(true);
    expect(parsed.options["ui-dev"]).toBe(true);
    expect(parsed.options["postgres-port"]).toBe("54329");
    expect(parsed.options["bind-host"]).toBe("0.0.0.0");
    expect(parsed.options["embedding-base-url"]).toBe("https://api.openai.com/v1");
    expect(parsed.options["embedding-model"]).toBe("text-embedding-3-small");
    expect(parsed.options["provider-kind"]).toBe("openai-compatible");
    expect(parsed.options["provider-model"]).toBe("deepseek-chat");
    expect(renderHelp()).toContain("axis start");
    expect(renderHelp()).toContain("--ui-dev");
    expect(renderHelp()).toContain("--bind-host HOST");
    expect(renderHelp()).toContain("--embedding-base-url URL");
    expect(renderHelp()).toContain("--provider-kind KIND");
  });

  it("parses the stop command and exposes it in help", () => {
    const parsed = parseArgs(["stop"]);

    expect(parsed.command).toEqual(["stop"]);
    expect(renderHelp()).toContain("axis stop");
  });

  it("prints the package version for --version", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const exitCode = await runCli(["--version"], import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith("0.1.0\n");
    expect(renderHelp()).toContain("axis --version");
  });

  it("prints the package version for the version command alias", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const exitCode = await runCli(["version"], import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith("0.1.0\n");
  });

  it("prints the package version for the short -v alias", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const exitCode = await runCli(["-v"], import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith("0.1.0\n");
  });

  it("exposes Claude uninstall in help", () => {
    const parsed = parseArgs(["claude", "uninstall", "--plugin-dir", "C:/tmp/plugin"]);

    expect(parsed.command).toEqual(["claude", "uninstall"]);
    expect(parsed.options["plugin-dir"]).toBe("C:/tmp/plugin");
    expect(renderHelp()).toContain("axis claude uninstall");
  });

  it("parses the codex install command and exposes forced injection help", () => {
    const parsed = parseArgs([
      "codex",
      "install",
      "--runtime-url",
      "http://127.0.0.1:3002",
      "--codex-home",
      "C:/tmp/.codex",
    ]);

    expect(parsed.command).toEqual(["codex", "install"]);
    expect(parsed.options["runtime-url"]).toBe("http://127.0.0.1:3002");
    expect(parsed.options["codex-home"]).toBe("C:/tmp/.codex");
    expect(renderHelp()).toContain("axis codex install");
    expect(renderHelp()).toContain("axis codex uninstall");
    expect(renderHelp()).toContain("cleanup legacy MCP registration");
    expect(renderHelp()).toContain("axis codex use");
  });

  it("rejects unknown codex subcommands", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const exitCode = await runCli(["codex", "foo"], import.meta.url);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("未知的 codex 子命令: foo | Unknown codex subcommand: foo\n");
    expect(stderrSpy).toHaveBeenCalledWith("可用: install, uninstall, use | Available: install, uninstall, use\n");
    expect(codexUseMock).not.toHaveBeenCalled();
  });

  it("parses the mna command and exposes it in help", () => {
    const parsed = parseArgs(["mna", "start", "--mna-port", "4193", "--mna-home", "C:/tmp/.axis/managed/mna"]);

    expect(parsed.command).toEqual(["mna", "start"]);
    expect(parsed.options["mna-port"]).toBe("4193");
    expect(parsed.options["mna-home"]).toBe("C:/tmp/.axis/managed/mna");
    expect(renderHelp()).toContain("axis mna <install|start|stop|logs|token>");
  });

  it("returns non-zero when strict status checks fail", async () => {
    getManagedMnaStatusMock.mockResolvedValue({
      record: null,
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      logPath: "C:/tmp/.axis/logs/mna.log",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      health: {
        ok: false,
        status: 503,
        error: "unavailable"
      },
      dependency: {
        body: null
      }
    });

    const exitCode = await runStatusCommand({
      json: true,
      strict: true,
      "runtime-url": "http://127.0.0.1:39992",
      "storage-url": "http://127.0.0.1:39991",
      "ui-url": "http://127.0.0.1:39993",
      timeout: "50",
    });

    expect(exitCode).toBe(1);
  });

  it("prints mna details in status --json output", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    getManagedMnaStatusMock.mockResolvedValue({
      record: null,
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      logPath: "C:/tmp/.axis/logs/mna.log",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      health: {
        ok: false,
        status: 503,
        error: "unavailable"
      },
      dependency: {
        body: {
          runtime: {
            status: "unavailable"
          }
        }
      }
    });

    const exitCode = await runStatusCommand({
      json: true,
      strict: false,
      "runtime-url": "http://127.0.0.1:39992",
      "storage-url": "http://127.0.0.1:39991",
      "ui-url": "http://127.0.0.1:39993",
      timeout: "50",
      "mna-url": "http://127.0.0.1:4193",
      "mna-home": "C:/tmp/.axis/managed/mna"
    });

    expect(exitCode).toBe(1);
    const payload = JSON.parse(String(stdoutSpy.mock.calls[0]?.[0])) as {
      mna: {
        url: string;
        tokenPath: string;
        logPath: string;
        artifactsPath: string;
        dependency: unknown;
      };
    };
    expect(payload.mna.url).toBe("http://127.0.0.1:4193");
    expect(payload.mna.tokenPath).toBe("C:/tmp/.axis/managed/mna/token.txt");
    expect(payload.mna.logPath).toBe("C:/tmp/.axis/logs/mna.log");
    expect(payload.mna.artifactsPath).toBe("C:/tmp/.axis/managed/mna/artifacts");
    expect(payload.mna).toHaveProperty("dependency");
  });

  it("marks mna as degraded when health is ok but token authorization fails", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    getManagedMnaStatusMock.mockResolvedValue({
      record: {
        name: "memory-native-agent",
        pid: 123,
        logPath: "C:/tmp/.axis/logs/mna.log",
        url: "http://127.0.0.1:4193",
        tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
        artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
        version: "0.1.0"
      },
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      logPath: "C:/tmp/.axis/logs/mna.log",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      health: {
        ok: true,
        status: 200,
        body: {
          version: "0.1.0"
        }
      },
      dependency: {
        ok: false,
        status: 401,
        body: {
          error: {
            code: "token_invalid"
          }
        }
      }
    });

    const exitCode = await runStatusCommand({
      json: true,
      strict: false,
      "runtime-url": "http://127.0.0.1:39992",
      "storage-url": "http://127.0.0.1:39991",
      "ui-url": "http://127.0.0.1:39993",
      timeout: "50",
    });

    expect(exitCode).toBe(1);
    const payload = JSON.parse(String(stdoutSpy.mock.calls[0]?.[0])) as {
      checks: Array<{ name: string; status: string; detail: string }>;
    };
    expect(payload.checks.find((item) => item.name === "memory-native-agent")).toEqual({
      name: "memory-native-agent",
      status: "degraded",
      detail: "axis 与正在运行的 memory-native-agent token 不匹配。运行 axis mna token 获取最新 token。 | Token mismatch between axis and the running memory-native-agent. Run axis mna token to get the latest token.",
    });
  });

  it("allows managed start to proceed without third-party embedding config", () => {
    expect(resolveOptionalThirdPartyEmbeddingConfig({}, {})).toEqual({});
  });

  it("accepts third-party embedding config from options and preserves v1 path", () => {
    const config = resolveThirdPartyEmbeddingConfig(
      {
        "embedding-base-url": "https://api.openai.com/v1",
        "embedding-model": "text-embedding-3-small",
      },
      {},
    );

    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(buildEmbeddingsEndpoint(config.baseUrl)).toBe("https://api.openai.com/v1/embeddings");
  });

  it("falls back to demo provider when no model credential is available", () => {
    const config = resolveManagedMnaProviderConfig({});

    expect(config).toEqual({
      kind: "demo",
      model: "axis-demo",
      baseUrl: undefined,
    });
  });

  it("uses explicit DeepSeek provider options without reading local env", () => {
    const config = resolveManagedMnaProviderConfig({
      "provider-kind": "openai-compatible",
      "provider-model": "deepseek-chat",
    });

    expect(config).toEqual({
      kind: "openai-compatible",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });

  it("detects whether provider overrides were explicitly passed", () => {
    expect(hasManagedMnaProviderOptionOverrides({})).toBe(false);
    expect(hasManagedMnaProviderOptionOverrides({
      "provider-model": "deepseek-chat",
    })).toBe(true);
  });

  it("prefers managed database port over inherited DATABASE_URL in status", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/agent_memory";
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
    getManagedMnaStatusMock.mockResolvedValue({
      record: null,
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.axis/managed/mna/token.txt",
      logPath: "C:/tmp/.axis/logs/mna.log",
      artifactsPath: "C:/tmp/.axis/managed/mna/artifacts",
      health: {
        ok: false,
        status: 503,
        error: "unavailable"
      },
      dependency: {
        body: null
      }
    });

    const connectSpy = vi
      .spyOn((await import("pg")).Client.prototype, "connect")
      .mockImplementation(async function connect(this: { connectionParameters: { port?: number } }) {
        expect(this.connectionParameters.port).toBe(54329);
      });
    const querySpy = vi
      .spyOn((await import("pg")).Client.prototype, "query")
      .mockResolvedValue({ rows: [{ ok: 1 }] } as never);
    const endSpy = vi
      .spyOn((await import("pg")).Client.prototype, "end")
      .mockResolvedValue(undefined as never);

    try {
      await runStatusCommand({
        json: true,
        strict: false,
        "runtime-url": "http://127.0.0.1:39992",
        "storage-url": "http://127.0.0.1:39991",
        "ui-url": "http://127.0.0.1:39993",
        timeout: "50",
      });
    } finally {
      process.env.DATABASE_URL = originalDatabaseUrl;
      connectSpy.mockRestore();
      querySpy.mockRestore();
      endSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });
});

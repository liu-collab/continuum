import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import net from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stdoutWriteMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());
const waitForHealthyMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const managedStateStore = vi.hoisted(() => ({
  state: {
    version: 1 as const,
    services: [] as Array<{
      name: string;
      pid: number;
      logPath: string;
      url?: string;
      tokenPath?: string;
      artifactsPath?: string;
      version?: string;
    }>
  }
}));

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    fetchJson: fetchJsonMock,
    waitForHealthy: waitForHealthyMock,
    pathExists: pathExistsMock
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock
  };
});

vi.mock("../src/managed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-state.js")>();
  return {
    ...actual,
    readManagedState: vi.fn(async () => managedStateStore.state),
    writeManagedState: vi.fn(async (nextState) => {
      managedStateStore.state = nextState;
    })
  };
});

import { runMnaCommand, startManagedMna } from "../src/mna-command.js";

describe("axis mna command", () => {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const tempHome = path.join(os.tmpdir(), `axis-cli-test-${Date.now()}`);

  beforeEach(async () => {
    vi.restoreAllMocks();
    stdoutWriteMock.mockReset();
    fetchJsonMock.mockReset();
    waitForHealthyMock.mockReset();
    pathExistsMock.mockReset();
    spawnMock.mockReset();
    process.stdout.write = stdoutWriteMock as unknown as typeof process.stdout.write;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    managedStateStore.state = {
      version: 1,
      services: []
    };
    waitForHealthyMock.mockResolvedValue({
      version: "0.1.0",
    });
    await rm(tempHome, { recursive: true, force: true });
    await mkdir(tempHome, { recursive: true });
  });

  afterEach(async () => {
    process.stdout.write = originalStdoutWrite;
    await rm(tempHome, { recursive: true, force: true });
  });

  it("prints the current token", async () => {
    const mnaHome = path.join(tempHome, ".axis", "managed", "mna");
    await mkdir(mnaHome, { recursive: true });
    await writeFile(path.join(mnaHome, "token.txt"), "token-123\n", "utf8");

    const exitCode = await runMnaCommand("token", { "mna-home": mnaHome }, import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutWriteMock).toHaveBeenCalledWith("token-123\n");
  });

  it("prints an empty line when token file is missing", async () => {
    const mnaHome = path.join(tempHome, ".axis", "managed", "mna");
    await mkdir(mnaHome, { recursive: true });

    const exitCode = await runMnaCommand("token", { "mna-home": mnaHome }, import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutWriteMock).toHaveBeenCalledWith("\n");
  });

  it("fails logs command when mna is not managed", async () => {
    await expect(runMnaCommand("logs", {}, import.meta.url)).rejects.toThrow(
      "memory-native-agent 尚未由 axis 管理启动。",
    );
  });

  it("prints managed logs content", async () => {
    const logsDir = path.join(tempHome, ".axis", "logs");
    const logPath = path.join(logsDir, "mna.log");
    await mkdir(logsDir, { recursive: true });
    await writeFile(logPath, "hello logs", "utf8");
    managedStateStore.state = {
      version: 1,
      services: [
        {
          name: "memory-native-agent",
          pid: 123,
          logPath
        }
      ]
    };

    const exitCode = await runMnaCommand("logs", {}, import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutWriteMock).toHaveBeenCalledWith("hello logs");
  });

  it("prints only the requested tail lines for managed logs", async () => {
    const logsDir = path.join(tempHome, ".axis", "logs");
    const logPath = path.join(logsDir, "mna.log");
    await mkdir(logsDir, { recursive: true });
    await writeFile(logPath, "line-1\nline-2\nline-3\n", "utf8");
    managedStateStore.state = {
      version: 1,
      services: [
        {
          name: "memory-native-agent",
          pid: 123,
          logPath
        }
      ]
    };

    const exitCode = await runMnaCommand("logs", { tail: "2" }, import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutWriteMock).toHaveBeenCalledWith("line-2\nline-3");
  });

  it("stops gracefully when mna is not running", async () => {
    const exitCode = await runMnaCommand("stop", {}, import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutWriteMock).toHaveBeenCalledWith("memory-native-agent 当前未运行。\n");
  });

  it("fails start when vendor entry is missing", async () => {
    pathExistsMock.mockResolvedValue(false);

    await expect(startManagedMna({}, import.meta.url)).rejects.toThrow(/vendor 产物不存在/);
  });

  it("reuses a healthy managed instance on start", async () => {
    const tokenPath = path.join(tempHome, ".axis", "managed", "mna", "token.txt");
    const artifactsPath = path.join(tempHome, ".axis", "managed", "mna", "artifacts");
    await mkdir(path.dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, "token-123", "utf8");
    managedStateStore.state = {
      version: 1,
      services: [
        {
          name: "memory-native-agent",
          pid: 123,
          logPath: path.join(tempHome, ".axis", "logs", "mna.log"),
          url: "http://127.0.0.1:4193",
          tokenPath,
          artifactsPath,
          version: "0.1.0"
        }
      ]
    };

    pathExistsMock.mockResolvedValue(true);
    fetchJsonMock.mockResolvedValueOnce({
      ok: true,
      body: {
        version: "0.1.1"
      }
    });
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        runtime: {
          status: "healthy"
        }
      })
    }) as typeof fetch;

    let result;
    try {
      result = await startManagedMna({}, import.meta.url);
    } finally {
      global.fetch = originalFetch;
    }

    expect(result).toEqual({
      url: "http://127.0.0.1:4193",
      tokenPath,
      artifactsPath,
      version: "0.1.1"
    });
  });

  it("fails start when managed process exits before becoming healthy", async () => {
    const mnaHome = path.join(tempHome, ".axis", "managed", "mna");
    pathExistsMock.mockImplementation(async (targetPath: string) => targetPath.endsWith("mna-server.mjs"));
    fetchJsonMock.mockResolvedValue({
      ok: false,
      error: "connect ECONNREFUSED"
    });
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { pid: number; unref(): void };
      child.pid = 4321;
      child.unref = vi.fn();
      setImmediate(() => {
        child.emit("exit", 3);
      });
      return child;
    });
    waitForHealthyMock.mockRejectedValue(new Error("memory-native-agent 未在预期时间内就绪。查看日志：axis mna logs"));

    await expect(startManagedMna({ "mna-home": mnaHome }, import.meta.url)).rejects.toThrow(/启动失败|未在预期时间内就绪/);
    expect(managedStateStore.state.services).toEqual([]);
  }, 15_000);

  it("fails start when the target port is already occupied by another process", async () => {
    const mnaHome = path.join(tempHome, ".axis", "managed", "mna");
    pathExistsMock.mockImplementation(async (targetPath: string) => targetPath.endsWith("mna-server.mjs"));
    fetchJsonMock.mockResolvedValue({
      ok: false,
      error: "connect ECONNREFUSED",
    });
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { pid: number; unref(): void };
      child.pid = 6789;
      child.unref = vi.fn();
      setImmediate(() => {
        child.emit("exit", 3);
      });
      return child;
    });
    waitForHealthyMock.mockRejectedValue(new Error("memory-native-agent 未在预期时间内就绪。查看日志：axis mna logs"));

    const server = net.createServer();
    const occupiedPort = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("occupied port unavailable"));
          return;
        }
        resolve(address.port);
      });
    });

    try {
      await expect(startManagedMna({ "mna-port": String(occupiedPort), "mna-home": mnaHome }, import.meta.url)).rejects.toThrow(
        /未在预期时间内就绪|启动失败/,
      );
      expect(managedStateStore.state.services).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);

  it("passes the current workspace as MNA_WORKSPACE_CWD when starting managed mna", async () => {
    const mnaHome = path.join(tempHome, ".axis", "managed", "mna");
    pathExistsMock.mockImplementation(async (targetPath: string) => targetPath.endsWith("mna-server.mjs"));
    fetchJsonMock
      .mockResolvedValueOnce({
        ok: false,
        error: "connect ECONNREFUSED",
      })
      .mockResolvedValueOnce({
        ok: true,
        body: {
          version: "0.1.1",
        },
      });

    let capturedEnv: NodeJS.ProcessEnv | undefined;
    spawnMock.mockImplementation((_command, _args, options) => {
      capturedEnv = options?.env as NodeJS.ProcessEnv;
      const child = new EventEmitter() as EventEmitter & { pid: number; unref(): void };
      child.pid = 12345;
      child.unref = vi.fn();
      return child;
    });

    await startManagedMna(
      {
        "mna-home": mnaHome,
        "managed-config-path": path.join(tempHome, ".axis", "managed", "config.json"),
        "managed-secrets-path": path.join(tempHome, ".axis", "managed", "secrets.json"),
      },
      import.meta.url,
    );

    expect(capturedEnv?.MNA_WORKSPACE_CWD).toBe(process.cwd());
    expect(capturedEnv?.AXIS_MANAGED_CONFIG_PATH).toBe(path.join(tempHome, ".axis", "managed", "config.json"));
    expect(capturedEnv?.AXIS_MANAGED_SECRETS_PATH).toBe(path.join(tempHome, ".axis", "managed", "secrets.json"));
    expect(waitForHealthyMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4193/healthz",
      expect.objectContaining({
        timeoutMs: 60_000,
        timeoutMessage: expect.stringContaining("查看日志：axis mna logs"),
      }),
    );
  });

  it("ignores legacy env-based persisted provider config when no page config was saved", async () => {
    const mnaHome = path.join(tempHome, ".axis", "managed", "mna");
    await mkdir(mnaHome, { recursive: true });
    await writeFile(
      path.join(mnaHome, "config.json"),
      JSON.stringify({
        provider: {
          kind: "openai-compatible",
          model: "deepseek-chat",
          base_url: "https://api.deepseek.com",
          api_key_env: "DEEPSEEK_API_KEY",
        },
      }),
      "utf8",
    );
    pathExistsMock.mockImplementation(async (targetPath: string) => targetPath.endsWith("mna-server.mjs"));
    fetchJsonMock
      .mockResolvedValueOnce({
        ok: false,
        error: "connect ECONNREFUSED",
      })
      .mockResolvedValueOnce({
        ok: true,
        body: {
          version: "0.1.1",
        },
      });

    let capturedEnv: NodeJS.ProcessEnv | undefined;
    spawnMock.mockImplementation((_command, _args, options) => {
      capturedEnv = options?.env as NodeJS.ProcessEnv;
      const child = new EventEmitter() as EventEmitter & { pid: number; unref(): void };
      child.pid = 12345;
      child.unref = vi.fn();
      return child;
    });

    await startManagedMna({ "mna-home": mnaHome }, import.meta.url);

    expect(capturedEnv?.MNA_PROVIDER_KIND).toBeUndefined();
    expect(capturedEnv?.MNA_PROVIDER_MODEL).toBeUndefined();
    expect(capturedEnv?.MNA_PROVIDER_API_KEY_ENV).toBeUndefined();
  });

  it("does not persist cli provider overrides into managed page config", async () => {
    const mnaHome = path.join(tempHome, ".axis", "managed", "mna");
    pathExistsMock.mockImplementation(async (targetPath: string) => targetPath.endsWith("mna-server.mjs"));
    fetchJsonMock
      .mockResolvedValueOnce({
        ok: false,
        error: "connect ECONNREFUSED",
      })
      .mockResolvedValueOnce({
        ok: true,
        body: {
          version: "0.1.1",
        },
      });
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { pid: number; unref(): void };
      child.pid = 12345;
      child.unref = vi.fn();
      return child;
    });

    await startManagedMna({
      "mna-home": mnaHome,
      "provider-kind": "openai-compatible",
      "provider-model": "deepseek-chat",
    }, import.meta.url);

    await expect(readFile(path.join(mnaHome, "config.json"), "utf8")).rejects.toThrow();
  });
});

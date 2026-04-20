import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stdoutWriteMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
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
    pathExists: pathExistsMock
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

describe("continuum mna command", () => {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const tempHome = path.join(os.tmpdir(), `continuum-cli-test-${Date.now()}`);

  beforeEach(async () => {
    vi.restoreAllMocks();
    stdoutWriteMock.mockReset();
    fetchJsonMock.mockReset();
    pathExistsMock.mockReset();
    process.stdout.write = stdoutWriteMock as unknown as typeof process.stdout.write;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    managedStateStore.state = {
      version: 1,
      services: []
    };
    await rm(tempHome, { recursive: true, force: true });
    await mkdir(tempHome, { recursive: true });
  });

  afterEach(async () => {
    process.stdout.write = originalStdoutWrite;
    await rm(tempHome, { recursive: true, force: true });
  });

  it("prints the current token", async () => {
    const mnaHome = path.join(tempHome, ".continuum", "managed", "mna");
    await mkdir(mnaHome, { recursive: true });
    await writeFile(path.join(mnaHome, "token.txt"), "token-123\n", "utf8");

    const exitCode = await runMnaCommand("token", { "mna-home": mnaHome }, import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutWriteMock).toHaveBeenCalledWith("token-123\n");
  });

  it("prints an empty line when token file is missing", async () => {
    const mnaHome = path.join(tempHome, ".continuum", "managed", "mna");
    await mkdir(mnaHome, { recursive: true });

    const exitCode = await runMnaCommand("token", { "mna-home": mnaHome }, import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutWriteMock).toHaveBeenCalledWith("\n");
  });

  it("fails logs command when mna is not managed", async () => {
    await expect(runMnaCommand("logs", {}, import.meta.url)).rejects.toThrow(
      "memory-native-agent 尚未由 continuum 管理启动。"
    );
  });

  it("prints managed logs content", async () => {
    const logsDir = path.join(tempHome, ".continuum", "logs");
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
    const tokenPath = path.join(tempHome, ".continuum", "managed", "mna", "token.txt");
    const artifactsPath = path.join(tempHome, ".continuum", "managed", "mna", "artifacts");
    await mkdir(path.dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, "token-123", "utf8");
    managedStateStore.state = {
      version: 1,
      services: [
        {
          name: "memory-native-agent",
          pid: 123,
          logPath: path.join(tempHome, ".continuum", "logs", "mna.log"),
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
    fetchJsonMock.mockResolvedValueOnce({
      ok: true,
      body: {
        runtime: {
          status: "healthy"
        }
      }
    });

    const result = await startManagedMna({}, import.meta.url);

    expect(result).toEqual({
      url: "http://127.0.0.1:4193",
      tokenPath,
      artifactsPath,
      version: "0.1.1"
    });
  });
});

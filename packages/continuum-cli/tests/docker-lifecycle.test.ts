import { afterEach, describe, expect, it, vi } from "vitest";

const runForegroundMock = vi.hoisted(() => vi.fn());
const runForegroundQuietMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("../src/managed-process.js", () => ({
  runForeground: runForegroundMock,
  runForegroundQuiet: runForegroundQuietMock,
}));

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    pathExists: pathExistsMock,
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import {
  ensureDockerDaemonReady,
  ensureDockerInstalled,
  resolveDockerDesktopPath,
} from "../src/docker-lifecycle.js";

describe("docker lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runForegroundMock.mockReset();
    runForegroundQuietMock.mockReset();
    pathExistsMock.mockReset();
    spawnMock.mockReset();
  });

  it("resolves Docker Desktop path from env when configured", () => {
    expect(
      resolveDockerDesktopPath({
        CONTINUUM_DOCKER_DESKTOP_PATH: "D:/Docker/Docker Desktop.exe",
      }),
    ).toBe("D:/Docker/Docker Desktop.exe");
  });

  it("does not install Docker Desktop on Linux when docker CLI is missing", async () => {
    runForegroundQuietMock.mockRejectedValueOnce(new Error("not found"));

    await expect(ensureDockerInstalled({ platform: "linux" })).rejects.toThrow("Docker CLI");
    expect(runForegroundMock).not.toHaveBeenCalled();
  });

  it("accepts Linux when docker CLI is available", async () => {
    runForegroundQuietMock.mockResolvedValueOnce(undefined);

    await expect(ensureDockerInstalled({ platform: "linux" })).resolves.toBeUndefined();
    expect(runForegroundMock).not.toHaveBeenCalled();
  });

  it("uses the configured Docker Desktop path on Windows daemon startup", async () => {
    runForegroundQuietMock.mockRejectedValueOnce(new Error("daemon unavailable"));
    runForegroundQuietMock.mockResolvedValueOnce(undefined);
    pathExistsMock.mockResolvedValueOnce(true);
    spawnMock.mockReturnValueOnce({
      unref: vi.fn(),
    });

    await expect(
      ensureDockerDaemonReady({
        platform: "win32",
        env: {
          CONTINUUM_DOCKER_DESKTOP_PATH: "D:/Docker/Docker Desktop.exe",
        },
      }),
    ).resolves.toBeUndefined();

    expect(spawnMock).toHaveBeenCalledWith("D:/Docker/Docker Desktop.exe", [], {
      detached: true,
      stdio: "ignore",
    });
  });

  it("reports Linux daemon readiness failures without trying Docker Desktop", async () => {
    runForegroundQuietMock.mockRejectedValueOnce(new Error("daemon unavailable"));

    await expect(ensureDockerDaemonReady({ platform: "linux" })).rejects.toThrow("Docker daemon");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

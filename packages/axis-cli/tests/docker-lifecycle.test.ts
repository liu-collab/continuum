import { afterEach, describe, expect, it, vi } from "vitest";

const runForegroundMock = vi.hoisted(() => vi.fn());
const runForegroundQuietMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const runCommandMock = vi.hoisted(() => vi.fn());
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
    runCommand: runCommandMock,
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
  buildDockerHostGatewayArgs,
  cleanupManagedStackContainer,
  ensureDockerDaemonReady,
  ensureDockerInstalled,
  isDockerMissingContainerResult,
  removeDockerImage,
  resolveDockerDesktopPath,
} from "../src/docker-lifecycle.js";

describe("docker lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runForegroundMock.mockReset();
    runForegroundQuietMock.mockReset();
    pathExistsMock.mockReset();
    runCommandMock.mockReset();
    spawnMock.mockReset();
  });

  it("resolves Docker Desktop path from env when configured", () => {
    expect(
      resolveDockerDesktopPath({
        AXIS_DOCKER_DESKTOP_PATH: "D:/Docker/Docker Desktop.exe",
      }),
    ).toBe("D:/Docker/Docker Desktop.exe");
  });

  it("adds host-gateway mapping for Linux Docker Engine only", () => {
    expect(buildDockerHostGatewayArgs("linux")).toEqual([
      "--add-host",
      "host.docker.internal:host-gateway",
    ]);
    expect(buildDockerHostGatewayArgs("win32")).toEqual([]);
    expect(buildDockerHostGatewayArgs("darwin")).toEqual([]);
  });

  it("detects missing docker containers across supported CLI outputs", async () => {
    expect(isDockerMissingContainerResult({ code: 1, stderr: "Error: No such container: axis-stack" })).toBe(true);
    expect(isDockerMissingContainerResult({ code: 1, stderr: "container axis-stack not found" })).toBe(true);
    expect(isDockerMissingContainerResult({ code: 1, stderr: "" })).toBe(true);
    expect(isDockerMissingContainerResult({ code: 2, stderr: "permission denied" })).toBe(false);

    runCommandMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "",
    });

    await expect(cleanupManagedStackContainer()).resolves.toBe(false);
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

  it("asks before installing Docker Desktop with winget on Windows", async () => {
    runForegroundQuietMock
      .mockRejectedValueOnce(new Error("docker missing"))
      .mockResolvedValueOnce(undefined);

    await expect(ensureDockerInstalled({ platform: "win32" })).rejects.toThrow("请手动安装 Docker Desktop");
    expect(runForegroundQuietMock).toHaveBeenCalledWith("winget", ["--version"]);
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
          AXIS_DOCKER_DESKTOP_PATH: "D:/Docker/Docker Desktop.exe",
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

  it("removes the managed stack image when present", async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 0,
      stdout: "",
      stderr: "",
    });

    await expect(removeDockerImage()).resolves.toBe(true);
    expect(runCommandMock).toHaveBeenCalledWith("docker", ["rmi", "axis-stack:latest"], expect.any(Object));
  });
});

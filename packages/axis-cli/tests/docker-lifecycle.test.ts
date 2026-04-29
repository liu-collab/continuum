import { afterEach, describe, expect, it, vi } from "vitest";

const runForegroundMock = vi.hoisted(() => vi.fn());
const runForegroundQuietMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());
const runCommandMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: mkdirMock,
    writeFile: writeFileMock,
  };
});

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
  isDockerContainerRunning,
  pruneDanglingDockerImages,
  removeDockerImage,
  resolveDockerDesktopPath,
  saveDockerContainerLogs,
  stopLegacyContinuumStackContainer,
} from "../src/docker-lifecycle.js";

describe("docker lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runForegroundMock.mockReset();
    runForegroundQuietMock.mockReset();
    pathExistsMock.mockReset();
    runCommandMock.mockReset();
    spawnMock.mockReset();
    mkdirMock.mockReset();
    writeFileMock.mockReset();
  });

  it("resolves Docker Desktop path from env when configured", () => {
    expect(
      resolveDockerDesktopPath({
        AXIS_DOCKER_DESKTOP_PATH: "D:/Docker/Docker Desktop.exe",
      }),
    ).toBe("D:/Docker/Docker Desktop.exe");
  });

  it("resolves platform-specific Docker Desktop paths", () => {
    expect(resolveDockerDesktopPath({}, "darwin")).toBe("/Applications/Docker.app/Contents/MacOS/Docker");
    expect(resolveDockerDesktopPath({}, "win32")).toBe("C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe");
    expect(resolveDockerDesktopPath({}, "linux")).toBeNull();
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

  it("detects whether the managed Docker container is running", async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 0,
      stdout: "true\n",
      stderr: "",
    });

    await expect(isDockerContainerRunning("axis-stack")).resolves.toBe(true);
    expect(runCommandMock).toHaveBeenCalledWith(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", "axis-stack"],
      expect.objectContaining({
        captureOutput: true,
        timeoutMs: 2_000,
      }),
    );
  });

  it("treats missing managed Docker containers as not running", async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "No such container: axis-stack",
    });

    await expect(isDockerContainerRunning("axis-stack")).resolves.toBe(false);
  });

  it("removes the legacy continuum stack container before a managed start", async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 0,
      stdout: "",
      stderr: "",
    });

    await expect(stopLegacyContinuumStackContainer()).resolves.toBeUndefined();
    expect(runCommandMock).toHaveBeenCalledWith("docker", ["rm", "-f", "continuum-stack"], expect.any(Object));
  });

  it("does not install Docker Desktop on Linux when docker CLI is missing", async () => {
    runForegroundQuietMock
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce(undefined);

    await expect(ensureDockerInstalled({ platform: "linux" })).rejects.toThrow("apt-get install");
    expect(runForegroundMock).not.toHaveBeenCalled();
  });

  it("guides macOS users to install Docker with brew when docker CLI is missing", async () => {
    runForegroundQuietMock
      .mockRejectedValueOnce(new Error("docker missing"))
      .mockResolvedValueOnce(undefined);

    await expect(ensureDockerInstalled({ platform: "darwin" })).rejects.toThrow("brew install --cask docker");
    expect(runForegroundQuietMock).toHaveBeenCalledWith("brew", ["--version"]);
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

  it("starts Docker Desktop with open on macOS daemon startup", async () => {
    runForegroundQuietMock
      .mockRejectedValueOnce(new Error("daemon unavailable"))
      .mockResolvedValueOnce(undefined);
    spawnMock.mockReturnValueOnce({
      unref: vi.fn(),
    });

    await expect(
      ensureDockerDaemonReady({
        platform: "darwin",
        daemonWaitTimeoutMs: 50,
        daemonWaitIntervalMs: 1,
      }),
    ).resolves.toBeUndefined();

    expect(runForegroundQuietMock).toHaveBeenNthCalledWith(1, "docker", ["info"]);
    expect(runForegroundQuietMock).toHaveBeenNthCalledWith(2, "docker", ["info"]);
    expect(spawnMock).toHaveBeenCalledWith("open", ["-a", "Docker"], {
      detached: true,
      stdio: "ignore",
    });
  });

  it("reports Linux daemon readiness failures without trying Docker Desktop", async () => {
    runForegroundQuietMock.mockRejectedValueOnce(new Error("daemon unavailable"));

    await expect(ensureDockerDaemonReady({ platform: "linux" })).rejects.toThrow("systemctl start docker");
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

  it("saves docker logs before startup cleanup", async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 0,
      stdout: "storage failed\n",
      stderr: "",
    });

    await expect(saveDockerContainerLogs("axis-stack", "C:/tmp/startup-failure.log")).resolves.toBe(true);
    expect(runCommandMock).toHaveBeenCalledWith(
      "docker",
      ["logs", "axis-stack"],
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      "C:/tmp/startup-failure.log",
      "storage failed\n",
      "utf8",
    );
  });

  it("prunes dangling docker images", async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 0,
      stdout: "",
      stderr: "",
    });

    await expect(pruneDanglingDockerImages()).resolves.toBe(true);
    expect(runCommandMock).toHaveBeenCalledWith(
      "docker",
      ["image", "prune", "-f"],
      expect.any(Object),
    );
  });
});

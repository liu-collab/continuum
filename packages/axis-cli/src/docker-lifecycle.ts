import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import process from "node:process";

import {
  axisHomeDir,
  DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER,
  DEFAULT_MANAGED_STACK_CONTAINER,
  DEFAULT_MANAGED_STACK_IMAGE,
} from "./managed-state.js";
import { runForeground, runForegroundQuiet } from "./managed-process.js";
import { bilingualMessage, formatErrorMessage } from "./messages.js";
import { pathExists, runCommand, vendorPath } from "./utils.js";

const STAGE_DIR_NAME = "stack-stage";
const DEFAULT_DOCKER_DESKTOP_PATH = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";

type DockerLifecycleOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

const DOCKER_INSTALL_GUIDE = bilingualMessage(
  "请手动安装 Docker Desktop 并确保 Docker 服务正在运行。",
  "Install Docker Desktop manually and make sure the Docker service is running.",
);

export function resolveDockerDesktopPath(env: NodeJS.ProcessEnv = process.env) {
  return env.AXIS_DOCKER_DESKTOP_PATH ?? DEFAULT_DOCKER_DESKTOP_PATH;
}

export function buildDockerHostGatewayArgs(platform: NodeJS.Platform = process.platform) {
  return platform === "linux"
    ? ["--add-host", "host.docker.internal:host-gateway"]
    : [];
}

async function confirmWingetDockerInstall() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question(
      "即将通过 winget 安装 Docker Desktop（约 500MB），是否继续？[y/N] | Install Docker Desktop with winget (about 500MB). Continue? [y/N] ",
    );
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

export async function ensureDockerInstalled(options: DockerLifecycleOptions = {}) {
  const platform = options.platform ?? process.platform;

  try {
    await runForegroundQuiet("docker", ["--version"]);
    return;
  } catch {
    if (platform !== "win32") {
      throw new Error(
        bilingualMessage(
          "Docker CLI 未安装或不可用。请先安装 Docker Engine，并确保 docker 命令在 PATH 中。",
          "Docker CLI is not installed or unavailable. Install Docker Engine and make sure docker is in PATH.",
        ),
      );
    }
  }

  try {
    await runForegroundQuiet("winget", ["--version"]);
  } catch {
    throw new Error(DOCKER_INSTALL_GUIDE);
  }

  const confirmed = await confirmWingetDockerInstall();
  if (!confirmed) {
    throw new Error(DOCKER_INSTALL_GUIDE);
  }

  process.stdout.write(bilingualMessage(
    "Docker 未安装，开始通过 winget 安装 Docker Desktop。",
    "Docker is not installed. Installing Docker Desktop with winget.",
  ) + "\n");
  try {
    await runForeground("winget", [
      "install",
      "-e",
      "--id",
      "Docker.DockerDesktop",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
  } catch (error) {
    throw new Error(bilingualMessage(
      `Docker Desktop 安装失败：${formatErrorMessage(error)}。${DOCKER_INSTALL_GUIDE}`,
      `Docker Desktop installation failed: ${formatErrorMessage(error)}. ${DOCKER_INSTALL_GUIDE}`,
    ));
  }
}

export async function ensureDockerDaemonReady(options: DockerLifecycleOptions = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  try {
    await runForegroundQuiet("docker", ["version"]);
    return;
  } catch {
    if (platform !== "win32") {
      throw new Error(
        bilingualMessage(
          "Docker daemon 未就绪。请确认 Docker Engine 已启动，并且当前用户可执行 docker version。",
          "Docker daemon is not ready. Make sure Docker Engine is running and this user can run docker version.",
        ),
      );
    }

    process.stdout.write(bilingualMessage(
      "Docker 已安装，但当前未启动，正在尝试启动 Docker Desktop。",
      "Docker is installed but not running. Attempting to start Docker Desktop.",
    ) + "\n");
  }

  const dockerDesktopExe = resolveDockerDesktopPath(env);
  if (await pathExists(dockerDesktopExe)) {
    spawn(dockerDesktopExe, [], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } else {
    throw new Error(bilingualMessage(
      `未找到 Docker Desktop: ${dockerDesktopExe}。${DOCKER_INSTALL_GUIDE}`,
      `Docker Desktop was not found: ${dockerDesktopExe}. ${DOCKER_INSTALL_GUIDE}`,
    ));
  }

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      await runForegroundQuiet("docker", ["version"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }

  throw new Error(bilingualMessage(
    `Docker daemon 未就绪，无法启动 Axis。${DOCKER_INSTALL_GUIDE}`,
    `Docker daemon is not ready, so Axis cannot start. ${DOCKER_INSTALL_GUIDE}`,
  ));
}

export async function stopLegacyPostgresContainer() {
  await removeDockerContainer(DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER).catch(() => undefined);
}

type DockerCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export function isDockerMissingContainerResult(result: Pick<DockerCommandResult, "code" | "stderr">) {
  const stderr = result.stderr.trim();
  return (
    stderr.includes("No such container")
    || stderr.includes("not found")
    || (result.code === 1 && stderr.length === 0)
  );
}

function buildDockerRemoveError(containerName: string, result: DockerCommandResult) {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return new Error(
    output
      ? bilingualMessage(
          `移除 Docker 容器失败: ${containerName}。${output}`,
          `Failed to remove Docker container: ${containerName}. ${output}`,
        )
      : bilingualMessage(
          `docker rm -f ${containerName} 失败，退出码 ${result.code}`,
          `docker rm -f ${containerName} failed with exit code ${result.code}`,
        ),
  );
}

export async function removeDockerContainer(containerName: string) {
  const result = await runCommand("docker", ["rm", "-f", containerName], {
    captureOutput: true,
    env: process.env,
  });

  if (result.code === 0) {
    return true;
  }

  if (isDockerMissingContainerResult(result)) {
    return false;
  }

  throw buildDockerRemoveError(containerName, result);
}

export async function cleanupManagedStackContainer() {
  return removeDockerContainer(DEFAULT_MANAGED_STACK_CONTAINER);
}

export async function removeDockerImage(imageName = DEFAULT_MANAGED_STACK_IMAGE) {
  const result = await runCommand("docker", ["rmi", imageName], {
    captureOutput: true,
    env: process.env,
  });

  if (result.code === 0) {
    return true;
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (
    output.includes("No such image")
    || output.includes("image not found")
    || output.includes("No such object")
    || (result.code === 1 && output.length === 0)
  ) {
    return false;
  }

  throw new Error(
    output
      ? bilingualMessage(
          `删除 Docker 镜像失败: ${imageName}。${output}`,
          `Failed to remove Docker image: ${imageName}. ${output}`,
        )
      : bilingualMessage(
          `docker rmi ${imageName} 失败，退出码 ${result.code}`,
          `docker rmi ${imageName} failed with exit code ${result.code}`,
        ),
  );
}

export async function prepareStackContext(packageRoot: string, includeVisualization = true) {
  const stageDir = path.join(axisHomeDir(), STAGE_DIR_NAME);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  await cp(vendorPath(packageRoot, "storage"), path.join(stageDir, "storage"), {
    recursive: true,
  });
  await cp(vendorPath(packageRoot, "runtime"), path.join(stageDir, "runtime"), {
    recursive: true,
  });
  const visualizationTarget = path.join(stageDir, "visualization");
  if (includeVisualization) {
    await cp(vendorPath(packageRoot, "visualization", "standalone"), visualizationTarget, {
      recursive: true,
    });
  } else {
    await mkdir(visualizationTarget, { recursive: true });
  }
  await cp(vendorPath(packageRoot, "stack", "Dockerfile"), path.join(stageDir, "Dockerfile"));
  await cp(vendorPath(packageRoot, "stack", "entrypoint.mjs"), path.join(stageDir, "entrypoint.mjs"));

  return stageDir;
}

export async function buildStackImage(stageDir: string, imageName = DEFAULT_MANAGED_STACK_IMAGE) {
  await runForeground("docker", ["build", "-t", imageName, stageDir]);
}

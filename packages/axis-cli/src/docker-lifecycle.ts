import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import process from "node:process";

import {
  axisLogsDir,
  axisHomeDir,
  DEFAULT_MANAGED_STACK_CONTAINER,
  DEFAULT_MANAGED_STACK_IMAGE,
} from "./managed-state.js";
import { runForeground, runForegroundQuiet } from "./managed-process.js";
import { bilingualMessage, formatErrorMessage } from "./messages.js";
import { pathExists, runCommand, vendorPath } from "./utils.js";

const STAGE_DIR_NAME = "stack-stage";
const WINDOWS_DOCKER_DESKTOP_PATH = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
const DARWIN_DOCKER_DESKTOP_PATH = "/Applications/Docker.app/Contents/MacOS/Docker";

type DockerLifecycleOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  daemonWaitTimeoutMs?: number;
  daemonWaitIntervalMs?: number;
};

const DOCKER_INSTALL_GUIDE = bilingualMessage(
  "请手动安装 Docker Desktop（Windows/macOS）或 Docker Engine（Linux）后重试。",
  "Install Docker Desktop (Windows/macOS) or Docker Engine (Linux), then retry.",
);

export function resolveDockerDesktopPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const configuredPath = env.AXIS_DOCKER_DESKTOP_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  if (platform === "win32") {
    return WINDOWS_DOCKER_DESKTOP_PATH;
  }

  if (platform === "darwin") {
    return DARWIN_DOCKER_DESKTOP_PATH;
  }

  return null;
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

async function commandAvailable(command: string) {
  try {
    await runForegroundQuiet(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function resolveLinuxDockerInstallCommand() {
  if (await commandAvailable("apt-get")) {
    return "sudo apt-get update && sudo apt-get install -y docker.io";
  }

  if (await commandAvailable("dnf")) {
    return "sudo dnf install -y docker";
  }

  if (await commandAvailable("yum")) {
    return "sudo yum install -y docker";
  }

  return null;
}

function dockerDaemonCheckArgs(platform: NodeJS.Platform) {
  return platform === "darwin" ? ["info"] : ["version"];
}

async function checkDockerDaemon(platform: NodeJS.Platform) {
  await runForegroundQuiet("docker", dockerDaemonCheckArgs(platform));
}

function writeDockerDaemonWaitProgress(elapsedMs: number) {
  const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  process.stdout.write(`→ ${bilingualMessage(
    `正在等待 Docker daemon 就绪（已等待 ${elapsedSeconds} 秒）...`,
    `Waiting for Docker daemon to become ready (${elapsedSeconds}s elapsed)...`,
  )}\n`);
}

async function waitForDockerDaemonReady(
  platform: NodeJS.Platform,
  timeoutMs: number,
  intervalMs: number,
) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await checkDockerDaemon(platform);
      return;
    } catch {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs)));
      writeDockerDaemonWaitProgress(Date.now() - startedAt);
    }
  }

  throw new Error(bilingualMessage(
    `Docker daemon 未就绪，无法启动 Axis。${DOCKER_INSTALL_GUIDE}`,
    `Docker daemon is not ready, so Axis cannot start. ${DOCKER_INSTALL_GUIDE}`,
  ));
}

export async function ensureDockerInstalled(options: DockerLifecycleOptions = {}) {
  const platform = options.platform ?? process.platform;

  try {
    await runForegroundQuiet("docker", ["--version"]);
    return;
  } catch {
    if (platform === "darwin") {
      const brewAvailable = await commandAvailable("brew");
      throw new Error(bilingualMessage(
        brewAvailable
          ? "Docker CLI 未安装或不可用。请执行 `brew install --cask docker` 后重试。"
          : "Docker CLI 未安装或不可用，且未检测到 Homebrew。请安装 Homebrew 后执行 `brew install --cask docker`，或从 Docker 官网安装 Docker Desktop 后重试。",
        brewAvailable
          ? "Docker CLI is not installed or unavailable. Run `brew install --cask docker`, then retry."
          : "Docker CLI is not installed or unavailable, and Homebrew was not detected. Install Homebrew and run `brew install --cask docker`, or install Docker Desktop from Docker manually, then retry.",
      ));
    }

    if (platform === "linux") {
      const installCommand = await resolveLinuxDockerInstallCommand();
      throw new Error(bilingualMessage(
        installCommand
          ? `Docker CLI 未安装或不可用。请执行 \`${installCommand}\` 后重试。`
          : "Docker CLI 未安装或不可用。请按当前 Linux 发行版安装 Docker Engine，并确保 docker 命令在 PATH 中。",
        installCommand
          ? `Docker CLI is not installed or unavailable. Run \`${installCommand}\`, then retry.`
          : "Docker CLI is not installed or unavailable. Install Docker Engine for your Linux distribution and make sure docker is in PATH.",
      ));
    }

    if (platform !== "win32") {
      throw new Error(bilingualMessage(
        "Docker CLI 未安装或不可用。请先安装 Docker，并确保 docker 命令在 PATH 中。",
        "Docker CLI is not installed or unavailable. Install Docker and make sure docker is in PATH.",
      ));
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

  process.stdout.write(`→ ${bilingualMessage(
    "Docker 未安装，开始通过 winget 安装 Docker Desktop。",
    "Docker is not installed. Installing Docker Desktop with winget.",
  )}\n`);
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
    await checkDockerDaemon(platform);
    return;
  } catch {
    if (platform === "linux") {
      throw new Error(bilingualMessage(
        "Docker daemon 未就绪。请执行 `sudo systemctl start docker` 后重试，并确认当前用户可执行 docker version。",
        "Docker daemon is not ready. Run `sudo systemctl start docker`, then retry, and make sure this user can run docker version.",
      ));
    }

    if (platform === "darwin") {
      process.stdout.write(`→ ${bilingualMessage(
        "Docker 已安装，但当前未启动，正在尝试启动 Docker Desktop。",
        "Docker is installed but not running. Attempting to start Docker Desktop.",
      )}\n`);
      spawn("open", ["-a", "Docker"], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else if (platform === "win32") {
      process.stdout.write(`→ ${bilingualMessage(
        "Docker 已安装，但当前未启动，正在尝试启动 Docker Desktop。",
        "Docker is installed but not running. Attempting to start Docker Desktop.",
      )}\n`);
      const dockerDesktopExe = resolveDockerDesktopPath(env, platform);
      if (dockerDesktopExe && await pathExists(dockerDesktopExe)) {
        spawn(dockerDesktopExe, [], {
          detached: true,
          stdio: "ignore",
        }).unref();
      } else {
        throw new Error(bilingualMessage(
          `未找到 Docker Desktop: ${dockerDesktopExe ?? "unknown"}。${DOCKER_INSTALL_GUIDE}`,
          `Docker Desktop was not found: ${dockerDesktopExe ?? "unknown"}. ${DOCKER_INSTALL_GUIDE}`,
        ));
      }
    } else {
      throw new Error(bilingualMessage(
        "Docker daemon 未就绪。请确认 Docker Engine 已启动，并且当前用户可执行 docker version。",
        "Docker daemon is not ready. Make sure Docker Engine is running and this user can run docker version.",
      ));
    }
  }

  await waitForDockerDaemonReady(
    platform,
    options.daemonWaitTimeoutMs ?? 180_000,
    options.daemonWaitIntervalMs ?? 10_000,
  );
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

export function isDockerDaemonUnavailableMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("cannot connect to the docker daemon")
    || normalized.includes("is the docker daemon running")
    || normalized.includes("dockerdesktoplinuxengine")
    || normalized.includes("docker_engine")
    || normalized.includes("error during connect")
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

export async function isDockerContainerRunning(containerName = DEFAULT_MANAGED_STACK_CONTAINER) {
  const result = await runCommand("docker", ["inspect", "-f", "{{.State.Running}}", containerName], {
    captureOutput: true,
    env: process.env,
    timeoutMs: 2_000,
  }).catch(() => null);

  return result?.code === 0 && result.stdout.trim() === "true";
}

export async function saveDockerContainerLogs(
  containerName = DEFAULT_MANAGED_STACK_CONTAINER,
  logPath = path.join(axisLogsDir(), "startup-failure.log"),
) {
  const result = await runCommand("docker", ["logs", containerName], {
    captureOutput: true,
    env: process.env,
    timeoutMs: 10_000,
  });
  const content = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (!content) {
    return false;
  }

  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, `${content}\n`, "utf8");
  return true;
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

export async function pruneDanglingDockerImages() {
  const result = await runCommand("docker", ["image", "prune", "-f"], {
    captureOutput: true,
    env: process.env,
  });
  if (result.code === 0) {
    return true;
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(
    output
      ? bilingualMessage(
          `清理 dangling Docker 镜像失败。${output}`,
          `Failed to prune dangling Docker images. ${output}`,
        )
      : bilingualMessage(
          `docker image prune -f 失败，退出码 ${result.code}`,
          `docker image prune -f failed with exit code ${result.code}`,
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
  try {
    await runForeground("docker", ["build", "-t", imageName, stageDir]);
  } catch (error) {
    const message = formatErrorMessage(error);
    throw new Error(bilingualMessage(
      `Docker 镜像构建失败。首次启动需要访问 Docker Hub 和 NodeSource；如果当前网络不可用，请联网后重试。${message}`,
      `Docker image build failed. First startup needs access to Docker Hub and NodeSource. If the network is unavailable, reconnect and retry. ${message}`,
    ));
  }
}

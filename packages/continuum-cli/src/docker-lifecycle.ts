import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  continuumHomeDir,
  DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER,
  DEFAULT_MANAGED_STACK_CONTAINER,
  DEFAULT_MANAGED_STACK_IMAGE,
} from "./managed-state.js";
import { runForeground, runForegroundQuiet } from "./managed-process.js";
import { pathExists, vendorPath } from "./utils.js";

const STAGE_DIR_NAME = "stack-stage";

export async function ensureDockerInstalled() {
  if (process.platform !== "win32") {
    throw new Error(
      "continuum start 当前仅支持 Windows 平台。其他平台请手动运行各服务或使用 Docker Compose。",
    );
  }

  try {
    await runForegroundQuiet("docker", ["--version"]);
  } catch {
    process.stdout.write("Docker 未安装，开始尝试自动安装 Docker Desktop。\n");
    await runForeground("winget", [
      "install",
      "-e",
      "--id",
      "Docker.DockerDesktop",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
  }
}

export async function ensureDockerDaemonReady() {
  try {
    await runForegroundQuiet("docker", ["version"]);
    return;
  } catch {
    process.stdout.write("Docker 已安装，但当前未启动，正在尝试启动 Docker Desktop。\n");
  }

  const dockerDesktopExe = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
  if (await pathExists(dockerDesktopExe)) {
    spawn(dockerDesktopExe, [], {
      detached: true,
      stdio: "ignore",
    }).unref();
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

  throw new Error("Docker daemon 未就绪，无法启动 Continuum。");
}

export async function stopLegacyPostgresContainer() {
  await runForegroundQuiet("docker", ["rm", "-f", DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER]).catch(
    () => undefined,
  );
}

export async function cleanupManagedStackContainer() {
  try {
    await runForegroundQuiet("docker", ["rm", "-f", DEFAULT_MANAGED_STACK_CONTAINER]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No such container")) {
      return false;
    }
    throw error;
  }
}

export async function prepareStackContext(packageRoot: string, includeVisualization = true) {
  const stageDir = path.join(continuumHomeDir(), STAGE_DIR_NAME);
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

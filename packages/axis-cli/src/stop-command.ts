import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  axisHomeDir,
  axisLogsDir,
  axisManagedDir,
  DEFAULT_MANAGED_STACK_CONTAINER,
  readManagedState,
  writeManagedState,
} from "./managed-state.js";
import { bilingualMessage } from "./messages.js";
import { stopManagedMna } from "./mna-command.js";
import { stopLegacyAxisProcesses } from "./process-cleanup.js";
import { removeDockerContainer, removeDockerImage } from "./docker-lifecycle.js";
import { terminateProcess } from "./utils.js";

async function removePathIfExists(targetPath: string) {
  await rm(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

async function clearManagedRuntimeState() {
  const managedDir = axisManagedDir();
  const targets = [
    path.join(managedDir, "mna", "token.txt"),
    path.join(managedDir, "mna", "sessions.db"),
    path.join(managedDir, "mna", "artifacts"),
    path.join(axisHomeDir(), "stack-stage"),
    axisLogsDir(),
  ];

  const failures: Array<{ target: string; message: string }> = [];
  for (const target of targets) {
    try {
      await removePathIfExists(target);
    } catch (error) {
      failures.push({
        target,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`${bilingualMessage(
        `清理运行态残留失败: ${failure.target}`,
        `Failed to clean runtime residue: ${failure.target}`,
      )}\n`);
      process.stderr.write(`${failure.message}\n`);
    }
    throw new Error(bilingualMessage(
      "Axis 运行态残留清理未完成。",
      "Axis runtime residue cleanup did not complete.",
    ));
  }
}

export async function runStopCommand() {
  await stopManagedMna().catch(() => undefined);
  await stopLegacyAxisProcesses();
  const state = await readManagedState();
  const containerName = state.postgres?.containerName ?? DEFAULT_MANAGED_STACK_CONTAINER;
  const visualizationDev = state.services.find((service) => service.name === "visualization-dev") ?? null;
  let containerCleanupError: Error | null = null;

  if (visualizationDev) {
    try {
      await terminateProcess(visualizationDev.pid);
    } catch {
      // ignore and still clear managed state below
    }
  }

  try {
    const removed = await removeDockerContainer(containerName);
    process.stdout.write(
      removed
        ? `${bilingualMessage(`已停止并移除容器: ${containerName}`, `Stopped and removed container: ${containerName}`)}\n`
        : `${bilingualMessage(`容器不存在，跳过清理: ${containerName}`, `Container does not exist, skipping cleanup: ${containerName}`)}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${bilingualMessage(`停止容器失败: ${message}`, `Failed to stop container: ${message}`)}\n`);
    containerCleanupError = error instanceof Error ? error : new Error(message);
  }

  try {
    const removed = await removeDockerImage();
    process.stdout.write(
      removed
        ? `${bilingualMessage("已删除旧 Docker 镜像: axis-stack:latest", "Removed old Docker image: axis-stack:latest")}\n`
        : `${bilingualMessage("Docker 镜像不存在，跳过清理: axis-stack:latest", "Docker image does not exist, skipping cleanup: axis-stack:latest")}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${bilingualMessage(
      `删除旧 Docker 镜像失败: ${message}`,
      `Failed to remove old Docker image: ${message}`,
    )}\n`);
    process.stderr.write(`${bilingualMessage(
      "如需强制删除，请手动运行 docker rmi -f axis-stack:latest。",
      "To force removal, run docker rmi -f axis-stack:latest manually.",
    )}\n`);
  }

  await clearManagedRuntimeState();

  await writeManagedState({
    version: 1,
    dbPassword: state.dbPassword,
    services: [],
  });

  if (containerCleanupError) {
    throw containerCleanupError;
  }

  process.stdout.write(`${bilingualMessage("Axis 已停止。", "Axis stopped.")}\n`);
}

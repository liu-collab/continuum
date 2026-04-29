import { rm } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import process from "node:process";

import {
  axisHomeDir,
  DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER,
  DEFAULT_MANAGED_STACK_CONTAINER,
  DEFAULT_MANAGED_STACK_IMAGE,
} from "./managed-state.js";
import { bilingualMessage, formatErrorMessage } from "./messages.js";
import { removeDockerContainer, removeDockerImage, pruneDanglingDockerImages } from "./docker-lifecycle.js";
import { stopManagedMna } from "./mna-command.js";
import { stopLegacyAxisProcesses } from "./process-cleanup.js";

const UI_DEV_STACK_IMAGE = "axis-local-ui-dev:latest";

async function confirmUninstall(force: boolean) {
  if (force) {
    return true;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question(
      "这将删除 ~/.axis/、axis-stack Docker 镜像和所有相关数据，不可恢复。确认？[y/N] | This will delete ~/.axis/, the axis-stack Docker image, and all related data. This cannot be undone. Continue? [y/N] ",
    );
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

async function collectFailure(
  failures: string[],
  label: string,
  action: () => Promise<unknown>,
) {
  try {
    await action();
  } catch (error) {
    failures.push(`${label}: ${formatErrorMessage(error)}`);
  }
}

export async function runUninstallCommand(options: Record<string, string | boolean>) {
  const confirmed = await confirmUninstall(options.force === true);
  if (!confirmed) {
    process.stdout.write(`${bilingualMessage(
      "已取消卸载清理。",
      "Uninstall cleanup cancelled.",
    )}\n`);
    return 1;
  }

  const failures: string[] = [];
  await collectFailure(failures, "memory-native-agent", async () => { await stopManagedMna(); });
  await collectFailure(failures, "legacy processes", async () => { await stopLegacyAxisProcesses(); });
  await collectFailure(failures, DEFAULT_MANAGED_STACK_CONTAINER, () =>
    removeDockerContainer(DEFAULT_MANAGED_STACK_CONTAINER));
  await collectFailure(failures, DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER, () =>
    removeDockerContainer(DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER));
  await collectFailure(failures, DEFAULT_MANAGED_STACK_IMAGE, () =>
    removeDockerImage(DEFAULT_MANAGED_STACK_IMAGE));
  await collectFailure(failures, UI_DEV_STACK_IMAGE, () =>
    removeDockerImage(UI_DEV_STACK_IMAGE));
  await collectFailure(failures, "dangling Docker images", () => pruneDanglingDockerImages());
  await collectFailure(failures, axisHomeDir(), () =>
    rm(axisHomeDir(), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  if (failures.length > 0) {
    process.stderr.write(`${bilingualMessage(
      "Axis 卸载清理未完全完成：",
      "Axis uninstall cleanup did not fully complete:",
    )}\n`);
    for (const failure of failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    return 1;
  }

  process.stdout.write(`${bilingualMessage(
    "Axis 本机数据和 Docker 资源已清理。",
    "Axis local data and Docker resources have been removed.",
  )}\n`);
  return 0;
}

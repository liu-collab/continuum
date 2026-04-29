import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  axisManagedDir,
  DEFAULT_MANAGED_STACK_CONTAINER,
} from "./managed-state.js";
import { bilingualMessage } from "./messages.js";
import { runCommand } from "./utils.js";

const RESTARTABLE_SERVICES = new Set(["runtime", "storage"]);

function controlDir() {
  return path.join(axisManagedDir(), "control");
}

function restartRequestPath() {
  return path.join(controlDir(), "restart-request.txt");
}

function restartOkPath() {
  return path.join(controlDir(), "restart-last-ok.txt");
}

function restartErrorPath() {
  return path.join(controlDir(), "restart-last-error.txt");
}

async function assertStackContainerRunning() {
  const result = await runCommand(
    "docker",
    ["inspect", "-f", "{{.State.Running}}", DEFAULT_MANAGED_STACK_CONTAINER],
    {
      captureOutput: true,
      env: process.env,
      timeoutMs: 2_000,
    },
  );

  if (result.code !== 0 || result.stdout.trim() !== "true") {
    throw new Error(bilingualMessage(
      "axis-stack 容器未运行，请先执行 axis start。",
      "The axis-stack container is not running. Run axis start first.",
    ));
  }
}

function isExpectedRestartOk(service: string, content: string) {
  const normalized = content.trim();
  return service === "storage"
    ? normalized.startsWith("storage-worker ")
    : normalized.startsWith(`${service} `);
}

async function waitForRestart(service: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const error = await readFile(restartErrorPath(), "utf8").catch(() => "");
    if (error.trim()) {
      throw new Error(bilingualMessage(
        `重启 ${service} 失败：${error.trim()}`,
        `Failed to restart ${service}: ${error.trim()}`,
      ));
    }

    const ok = await readFile(restartOkPath(), "utf8").catch(() => "");
    if (isExpectedRestartOk(service, ok)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(bilingualMessage(
    `等待 ${service} 重启确认超时。请查看容器日志：docker logs ${DEFAULT_MANAGED_STACK_CONTAINER}`,
    `Timed out waiting for ${service} restart confirmation. Check container logs: docker logs ${DEFAULT_MANAGED_STACK_CONTAINER}`,
  ));
}

export async function runRestartCommand(service: string | undefined) {
  if (!service || !RESTARTABLE_SERVICES.has(service)) {
    process.stderr.write(`${bilingualMessage(
      "用法: axis restart <runtime|storage>",
      "Usage: axis restart <runtime|storage>",
    )}\n`);
    return 1;
  }

  await assertStackContainerRunning();
  await mkdir(controlDir(), { recursive: true });
  await Promise.all([
    rm(restartOkPath(), { force: true }).catch(() => undefined),
    rm(restartErrorPath(), { force: true }).catch(() => undefined),
  ]);
  await writeFile(restartRequestPath(), `${service}\n`, "utf8");
  await waitForRestart(service);

  process.stdout.write(`${bilingualMessage(
    `已重启 ${service}。`,
    `Restarted ${service}.`,
  )}\n`);
  return 0;
}

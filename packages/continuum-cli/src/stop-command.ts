import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  continuumLogsDir,
  continuumManagedDir,
  DEFAULT_MANAGED_STACK_CONTAINER,
  readManagedState,
  writeManagedState,
} from "./managed-state.js";
import { stopManagedMna } from "./mna-command.js";
import { stopLegacyContinuumProcesses } from "./process-cleanup.js";
import { spawnCrossPlatform } from "./utils.js";

async function runForegroundQuiet(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    const child = spawnCrossPlatform(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(new Error(`command failed: ${command} ${args.join(" ")}${detail ? `\n${detail}` : ""}`));
    });
    child.on("error", reject);
  });
}

async function removePathIfExists(targetPath: string) {
  await rm(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

async function terminateManagedProcess(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        env: process.env,
      });

      child.on("exit", () => resolve());
      child.on("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGINT");
  } catch {
    return;
  }
}

async function clearManagedRuntimeState() {
  const managedDir = continuumManagedDir();
  const targets = [
    path.join(managedDir, "mna", "token.txt"),
    path.join(managedDir, "mna", "sessions.db"),
    path.join(managedDir, "mna", "artifacts"),
    continuumLogsDir(),
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
      process.stderr.write(`清理运行态残留失败: ${failure.target}\n`);
      process.stderr.write(`${failure.message}\n`);
    }
    throw new Error("Continuum 运行态残留清理未完成。");
  }
}

export async function runStopCommand() {
  await stopManagedMna().catch(() => undefined);
  await stopLegacyContinuumProcesses();
  const state = await readManagedState();
  const containerName = state.postgres?.containerName ?? DEFAULT_MANAGED_STACK_CONTAINER;
  const visualizationDev = state.services.find((service) => service.name === "visualization-dev") ?? null;
  let containerCleanupError: Error | null = null;

  if (visualizationDev) {
    try {
      await terminateManagedProcess(visualizationDev.pid);
    } catch {
      // ignore and still clear managed state below
    }
  }

  try {
    await runForegroundQuiet("docker", ["rm", "-f", containerName]);
    process.stdout.write(`已停止并移除容器: ${containerName}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("No such container")) {
      process.stdout.write(`容器不存在，跳过清理: ${containerName}\n`);
    } else {
      process.stderr.write(`停止容器失败: ${message}\n`);
      containerCleanupError = error instanceof Error ? error : new Error(message);
    }
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

  process.stdout.write("Continuum 已停止。\n");
}

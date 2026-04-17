import { spawn } from "node:child_process";
import process from "node:process";

import {
  DEFAULT_MANAGED_STACK_CONTAINER,
  readManagedState,
  writeManagedState,
} from "./managed-state.js";

async function runForegroundQuiet(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", command, ...args], {
            stdio: "ignore",
            env: process.env,
          })
        : spawn(command, args, {
            stdio: "ignore",
            env: process.env,
          });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`command failed: ${command} ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

export async function runStopCommand() {
  const state = await readManagedState();
  const containerName = state.postgres?.containerName ?? DEFAULT_MANAGED_STACK_CONTAINER;

  try {
    await runForegroundQuiet("docker", ["rm", "-f", containerName]);
    process.stdout.write(`已停止并移除容器: ${containerName}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("No such container")) {
      process.stdout.write(`容器不存在，跳过清理: ${containerName}\n`);
    } else {
      process.stderr.write(`停止容器失败: ${message}\n`);
      throw error;
    }
  }

  await writeManagedState({
    version: 1,
    services: [],
  });

  process.stdout.write("Continuum 已停止。\n");
}

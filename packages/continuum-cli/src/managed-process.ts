import process from "node:process";

import { spawnCrossPlatform } from "./utils.js";

export function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export async function runForeground(command: string, args: string[], cwd?: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawnCrossPlatform(command, args, {
      cwd,
      stdio: "inherit",
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

export async function runForegroundQuiet(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawnCrossPlatform(command, args, {
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

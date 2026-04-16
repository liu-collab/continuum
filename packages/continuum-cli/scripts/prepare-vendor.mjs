#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const runtimeDir = path.join(repoRoot, "services", "retrieval-runtime");
const visualizationDir = path.join(repoRoot, "services", "visualization");
const vendorDir = path.join(packageDir, "vendor");
const visualizationBuildDir = path.join(visualizationDir, ".next");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", command, ...args], {
            cwd,
            stdio: "inherit",
            env: process.env,
          })
        : spawn(command, args, {
            cwd,
            stdio: "inherit",
            env: process.env,
          });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`command failed: ${command} ${args.join(" ")}`));
    });

    child.on("error", reject);
  });
}

async function copyRuntimeBundle() {
  const targetDir = path.join(vendorDir, "runtime");
  await cp(path.join(runtimeDir, "dist", "src"), path.join(targetDir, "dist", "src"), {
    recursive: true,
  });
  await cp(path.join(runtimeDir, "host-adapters"), path.join(targetDir, "host-adapters"), {
    recursive: true,
  });
}

async function copyVisualizationBundle() {
  const standaloneSource = path.join(visualizationDir, ".next", "standalone");
  const staticSource = path.join(visualizationDir, ".next", "static");
  const publicSource = path.join(visualizationDir, "public");
  const targetDir = path.join(vendorDir, "visualization", "standalone");

  await cp(standaloneSource, targetDir, { recursive: true });
  await cp(staticSource, path.join(targetDir, ".next", "static"), { recursive: true });
  await cp(publicSource, path.join(targetDir, "public"), { recursive: true });
}

async function main() {
  await rm(vendorDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
  await rm(visualizationBuildDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
  await mkdir(vendorDir, { recursive: true });

  await run(npmCommand(), ["run", "build"], runtimeDir);
  await run(npmCommand(), ["run", "build"], visualizationDir);

  await copyRuntimeBundle();
  await copyVisualizationBundle();
}

void main();

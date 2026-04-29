#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planVendorBuild, writeBuildState } from "./build-state.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const stackTemplateDir = path.join(packageDir, "templates", "stack");
const storageDir = path.join(repoRoot, "services", "storage");
const runtimeDir = path.join(repoRoot, "services", "retrieval-runtime");
const visualizationDir = path.join(repoRoot, "services", "visualization");
const memoryNativeAgentDir = path.join(repoRoot, "services", "memory-native-agent");
const vendorDir = path.join(packageDir, "vendor");
const vendorStageDir = path.join(packageDir, "vendor-stage");
const visualizationBuildDir = path.join(visualizationDir, ".next");
const skipVisualization = process.argv.includes("--skip-visualization");

async function copyEntries(sourceDir, targetDir, entries) {
  await mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    await cp(path.join(sourceDir, entry), path.join(targetDir, entry), {
      recursive: true,
    });
  }
}

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

async function removeWithRetry(targetPath) {
  let lastError;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function copyWithRetry(sourcePath, targetPath) {
  let lastError;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await removeWithRetry(targetPath).catch(() => undefined);
      await cp(sourcePath, targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function copyRuntimeBundle() {
  const targetDir = path.join(vendorStageDir, "runtime");
  await copyEntries(runtimeDir, targetDir, [
    "dist",
    "migrations",
    "host-adapters",
    "node_modules",
    "package.json",
  ]);
}

async function copyStorageBundle() {
  const targetDir = path.join(vendorStageDir, "storage");
  await copyEntries(storageDir, targetDir, ["dist", "migrations", "node_modules", "package.json"]);
}

async function copyVisualizationBundle() {
  const standaloneSource = path.join(visualizationDir, ".next", "standalone");
  const staticSource = path.join(visualizationDir, ".next", "static");
  const publicSource = path.join(visualizationDir, "public");
  const targetDir = path.join(vendorStageDir, "visualization", "standalone");

  await cp(standaloneSource, targetDir, { recursive: true });
  await cp(staticSource, path.join(targetDir, ".next", "static"), { recursive: true });
  await cp(publicSource, path.join(targetDir, "public"), { recursive: true });
}

async function copyMemoryNativeAgentBundle() {
  const targetDir = path.join(vendorStageDir, "memory-native-agent");
  await copyEntries(memoryNativeAgentDir, targetDir, [
    "bin",
    "dist",
    "node_modules",
    "package.json",
    "README.md",
  ]);
}

async function copyStackTemplate() {
  const targetDir = path.join(vendorStageDir, "stack");
  await cp(stackTemplateDir, targetDir, { recursive: true });
}

async function replaceVendorDir() {
  await mkdir(vendorDir, { recursive: true });
  const entries = await cpList(vendorStageDir);

  for (const entry of entries) {
    const source = path.join(vendorStageDir, entry);
    const target = path.join(vendorDir, entry);
    await copyWithRetry(source, target);
  }

  await removeWithRetry(vendorStageDir).catch(() => undefined);
}

async function cpList(dir) {
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(dir));
  return entries;
}

async function stopRunningVendorProcesses() {
  if (process.platform !== "win32") {
    return;
  }

  await new Promise((resolve) => {
    const child = spawn("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $line = [string]$_.CommandLine; $normalized = $line -replace '\\\\','/'; $normalized -like '*packages/axis-cli/vendor/*' -or $normalized -like '*axis/managed/mna/*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    ], {
      stdio: "ignore",
      env: process.env,
    });

    child.on("exit", () => resolve(undefined));
    child.on("error", () => resolve(undefined));
  });
}

function filterSkippedEntries(plan) {
  if (!skipVisualization) {
    return plan;
  }

  const skippedEntries = ["visualization"];
  const changedEntries = plan.changedEntries.filter((entry) => !skippedEntries.includes(entry));
  const buildServices = plan.buildServices.filter((entry) => !skippedEntries.includes(entry));
  const nextEntries = { ...plan.nextState.vendor.entries };
  const nextBuilds = { ...plan.nextState.vendor.builds };

  for (const entry of skippedEntries) {
    if (plan.currentState.vendor.entries[entry]) {
      nextEntries[entry] = plan.currentState.vendor.entries[entry];
    } else {
      delete nextEntries[entry];
    }

    if (plan.currentState.vendor.builds[entry]) {
      nextBuilds[entry] = plan.currentState.vendor.builds[entry];
    } else {
      delete nextBuilds[entry];
    }
  }

  return {
    ...plan,
    changedEntries,
    buildServices,
    needsRefresh: changedEntries.length > 0,
    nextState: {
      ...plan.nextState,
      vendor: {
        entries: nextEntries,
        builds: nextBuilds,
      },
    },
  };
}

async function main() {
  const plan = filterSkippedEntries(await planVendorBuild(packageDir));

  if (!plan.needsRefresh) {
    console.log(
      skipVisualization
        ? "vendor 已是最新，跳过 prepare:vendor；--ui-dev 下 visualization 由 next dev 直接读取源码。"
        : "vendor 已是最新，跳过 prepare:vendor。",
    );
    return;
  }

  await stopRunningVendorProcesses();
  await removeWithRetry(vendorStageDir);
  await mkdir(vendorStageDir, { recursive: true });

  if (plan.buildServices.includes("storage")) {
    await run(npmCommand(), ["run", "build"], storageDir);
  }
  if (plan.buildServices.includes("runtime")) {
    await run(npmCommand(), ["run", "build"], runtimeDir);
  }
  if (plan.buildServices.includes("visualization")) {
    await removeWithRetry(visualizationBuildDir).catch(() => undefined);
    await run(npmCommand(), ["run", "build"], visualizationDir);
  }
  if (plan.buildServices.includes("memory-native-agent")) {
    await run(npmCommand(), ["run", "build"], memoryNativeAgentDir);
  }

  if (plan.changedEntries.includes("storage")) {
    await copyStorageBundle();
  }
  if (plan.changedEntries.includes("runtime")) {
    await copyRuntimeBundle();
  }
  if (plan.changedEntries.includes("visualization")) {
    await copyVisualizationBundle();
  }
  if (plan.changedEntries.includes("memory-native-agent")) {
    await copyMemoryNativeAgentBundle();
  }
  if (plan.changedEntries.includes("stack")) {
    await copyStackTemplate();
  }
  await replaceVendorDir();
  await writeBuildState(plan.nextState);
}

void main();

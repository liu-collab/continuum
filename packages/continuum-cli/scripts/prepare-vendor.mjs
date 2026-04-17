#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const stackTemplateDir = path.join(packageDir, "templates", "stack");
const storageDir = path.join(repoRoot, "services", "storage");
const runtimeDir = path.join(repoRoot, "services", "retrieval-runtime");
const visualizationDir = path.join(repoRoot, "services", "visualization");
const vendorDir = path.join(packageDir, "vendor");
const vendorStageDir = path.join(packageDir, "vendor-stage");
const visualizationBuildDir = path.join(visualizationDir, ".next");

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

async function copyRuntimeBundle() {
  const targetDir = path.join(vendorStageDir, "runtime");
  await copyEntries(runtimeDir, targetDir, ["dist", "migrations", "host-adapters", "node_modules"]);
}

async function copyStorageBundle() {
  const targetDir = path.join(vendorStageDir, "storage");
  await copyEntries(storageDir, targetDir, ["dist", "migrations", "node_modules"]);
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

async function copyStackTemplate() {
  const targetDir = path.join(vendorStageDir, "stack");
  await cp(stackTemplateDir, targetDir, { recursive: true });
}

async function copyStackSources() {
  await copyEntries(storageDir, path.join(vendorStageDir, "stack", "storage-src"), [
    "src",
    "migrations",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "drizzle.config.ts",
  ]);

  await copyEntries(runtimeDir, path.join(vendorStageDir, "stack", "runtime-src"), [
    "src",
    "migrations",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
  ]);

  await copyEntries(visualizationDir, path.join(vendorStageDir, "stack", "visualization-src"), [
    "src",
    "public",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.typecheck.json",
    "next.config.ts",
    "next-env.d.ts",
    "postcss.config.js",
    "tailwind.config.ts",
    "components.json",
  ]);
}

async function replaceVendorDir() {
  const previousVendorDir = path.join(packageDir, "vendor-previous");
  await removeWithRetry(previousVendorDir).catch(() => undefined);

  try {
    await rename(vendorDir, previousVendorDir);
  } catch {
    await removeWithRetry(vendorDir).catch(() => undefined);
  }

  try {
    await rename(vendorStageDir, vendorDir);
  } catch (error) {
    await removeWithRetry(vendorDir).catch(() => undefined);
    await cp(vendorStageDir, vendorDir, { recursive: true, force: true });
    await removeWithRetry(vendorStageDir).catch(() => undefined);

    if (error instanceof Error) {
      process.stderr.write(`vendor rename fallback: ${error.message}\n`);
    }
  }

  await removeWithRetry(previousVendorDir).catch(() => undefined);
}

async function main() {
  await removeWithRetry(vendorStageDir);
  await removeWithRetry(visualizationBuildDir);
  await mkdir(vendorStageDir, { recursive: true });

  await run(npmCommand(), ["run", "build"], storageDir);
  await run(npmCommand(), ["run", "build"], runtimeDir);
  await run(npmCommand(), ["run", "build"], visualizationDir);

  await copyStorageBundle();
  await copyRuntimeBundle();
  await copyVisualizationBundle();
  await copyStackTemplate();
  await copyStackSources();
  await replaceVendorDir();
}

void main();

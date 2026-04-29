#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import yazl from "yazl";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const vendorPluginDir = path.join(
  packageDir,
  "vendor",
  "runtime",
  "host-adapters",
  "memory-claude-plugin",
);
const releaseDir = path.join(packageDir, "dist", "release");
const pluginStageDir = path.join(releaseDir, "axis-claude-plugin");
const utilsModulePath = path.join(packageDir, "dist", "src", "utils.js");

async function loadRewriteClaudePluginCommands() {
  try {
    const { rewriteClaudePluginCommands } = await import(pathToFileURL(utilsModulePath).href);
    return rewriteClaudePluginCommands;
  } catch (error) {
    throw new Error(
      `compiled utils not found: ${utilsModulePath}. Run "npm run build" before packaging the Claude plugin.`,
      { cause: error },
    );
  }
}

async function ensureVendorPlugin() {
  try {
    await access(vendorPluginDir);
  } catch {
    throw new Error(
      `vendor plugin not found: ${vendorPluginDir}. Run "npm run prepare:vendor" first.`,
    );
  }
}

async function zipDirectory(sourceDir, targetFile) {
  await mkdir(path.dirname(targetFile), { recursive: true });

  const zipFile = new yazl.ZipFile();
  const output = createWriteStream(targetFile);

  const closePromise = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zipFile.outputStream.on("error", reject);
  });

  async function appendDirectory(currentSourceDir, currentZipDir) {
    const entries = await readdir(currentSourceDir, { withFileTypes: true });
    if (entries.length === 0) {
      zipFile.addEmptyDirectory(currentZipDir);
      return;
    }

    for (const entry of entries) {
      const sourcePath = path.join(currentSourceDir, entry.name);
      const zipPath = path.posix.join(currentZipDir, entry.name);
      if (entry.isDirectory()) {
        await appendDirectory(sourcePath, zipPath);
        continue;
      }

      if (entry.isFile()) {
        zipFile.addFile(sourcePath, zipPath);
      }
    }
  }

  await appendDirectory(sourceDir, path.basename(sourceDir));
  zipFile.end();
  zipFile.outputStream.pipe(output);

  await closePromise;
}

async function rewritePluginArtifacts(stageDir, packageSpecifier, version) {
  const rewriteClaudePluginCommands = await loadRewriteClaudePluginCommands();
  await rewriteClaudePluginCommands(stageDir, packageSpecifier);
  const pluginManifestPath = path.join(stageDir, ".claude-plugin", "plugin.json");
  const pluginManifest = JSON.parse(await readFile(pluginManifestPath, "utf8"));
  pluginManifest.version = version;
  await writeFile(pluginManifestPath, JSON.stringify(pluginManifest, null, 2), "utf8");
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  const zipPath = path.join(releaseDir, `axis-claude-plugin-v${packageJson.version}.zip`);

  await ensureVendorPlugin();
  await rm(pluginStageDir, { recursive: true, force: true });
  await cp(vendorPluginDir, pluginStageDir, { recursive: true });
  await rewritePluginArtifacts(pluginStageDir, `${packageJson.name}@${packageJson.version}`, packageJson.version);
  await zipDirectory(pluginStageDir, zipPath);

  console.log(zipPath);
}

void main();

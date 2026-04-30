import path from "node:path";

import { runForeground } from "./managed-process.js";
import { writeMemoryModelConfigurationHint } from "./memory-model-command.js";
import {
  defaultClaudePluginInstallDir,
  installClaudePlugin,
  packageRootFromImportMeta,
  pathExists,
  rewriteClaudePluginCommands,
  uninstallClaudePlugin,
  vendorPath,
} from "./utils.js";

function resolveClaudePluginTargetDir(options: Record<string, string | boolean>) {
  return typeof options["plugin-dir"] === "string"
    ? options["plugin-dir"]
    : defaultClaudePluginInstallDir();
}

function resolveClaudePackageSpecifier(options: Record<string, string | boolean>) {
  return typeof options.package === "string" ? options.package : "axis-agent@latest";
}

async function installManagedClaudePlugin(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
  targetDir: string,
  force: boolean,
) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const sourceDir = vendorPath(packageRoot, "runtime", "host-adapters", "memory-claude-plugin");
  const packageSpecifier = resolveClaudePackageSpecifier(options);

  await installClaudePlugin({
    sourceDir,
    targetDir,
    force,
  });
  await rewriteClaudePluginCommands(targetDir, packageSpecifier);
}

export async function runClaudeInstallCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  const targetDir = resolveClaudePluginTargetDir(options);
  const force = options.force === true;

  await installManagedClaudePlugin(options, importMetaUrl, targetDir, force);

  process.stdout.write(`Claude plugin installed to ${targetDir}\n`);
  process.stdout.write("Claude hooks will use lite runtime HTTP; MCP tools are not registered by default.\n");
  await writeMemoryModelConfigurationHint();
  process.stdout.write(`Start with: claude --plugin-dir "${targetDir}"\n`);
}

export async function runClaudeCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  const targetDir = resolveClaudePluginTargetDir(options);
  const installed = await pathExists(targetDir);

  if (!installed) {
    await installManagedClaudePlugin(options, importMetaUrl, targetDir, false);
    process.stdout.write(`Claude plugin installed to ${targetDir}\n`);
    process.stdout.write("Claude hooks will use lite runtime HTTP; MCP tools are not registered by default.\n");
    await writeMemoryModelConfigurationHint();
  }

  await runForeground("claude", ["--plugin-dir", targetDir]);
}

export async function runClaudeUninstallCommand(options: Record<string, string | boolean>) {
  const targetDir = resolveClaudePluginTargetDir(options);

  const removed = await uninstallClaudePlugin(targetDir);

  if (removed) {
    process.stdout.write(`Claude plugin removed from ${targetDir}\n`);
    return;
  }

  process.stdout.write(`Claude plugin is not installed at ${targetDir}\n`);
}

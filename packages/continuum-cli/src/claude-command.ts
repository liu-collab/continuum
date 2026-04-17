import path from "node:path";

import {
  defaultClaudePluginInstallDir,
  installClaudePlugin,
  packageRootFromImportMeta,
  rewriteClaudePluginCommands,
  vendorPath,
} from "./utils.js";

export async function runClaudeInstallCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const sourceDir = vendorPath(packageRoot, "runtime", "host-adapters", "memory-claude-plugin");
  const targetDir =
    typeof options["plugin-dir"] === "string"
      ? options["plugin-dir"]
      : defaultClaudePluginInstallDir();
  const force = options.force === true || options.force === "true";
  const packageSpecifier =
    typeof options.package === "string" ? options.package : "@jiankarlin/continuum@latest";

  await installClaudePlugin({
    sourceDir,
    targetDir,
    force,
  });
  await rewriteClaudePluginCommands(targetDir, packageSpecifier);

  process.stdout.write(`Claude plugin installed to ${targetDir}\n`);
  process.stdout.write(`Start with: claude --plugin-dir "${targetDir}"\n`);
}

import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { bilingualMessage, formatErrorMessage } from "./messages.js";
import { packageRootFromImportMeta, vendorPath } from "./utils.js";

export async function runRuntimeCommand(importMetaUrl: string) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const entryPath = vendorPath(packageRoot, "runtime", "dist", "src", "index.js");

  const child = spawn(process.execPath, [entryPath], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(bilingualMessage(
      `retrieval-runtime 启动失败：${formatErrorMessage(error)}`,
      `Failed to start retrieval-runtime: ${formatErrorMessage(error)}`,
    ));
    process.exit(1);
  });
}

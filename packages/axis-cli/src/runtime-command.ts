import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { axisLogsDir, readManagedState, writeManagedState } from "./managed-state.js";
import { bilingualMessage, formatErrorMessage } from "./messages.js";
import {
  DEFAULT_RUNTIME_PORT,
  LOOPBACK_BIND_HOST,
  parsePortEnv,
  resolveLiteRuntimePort,
} from "./port-utils.js";
import { packageRootFromImportMeta, vendorPath } from "./utils.js";

function resolveRuntimePort() {
  return parsePortEnv(process.env.PORT ?? process.env.RUNTIME_PORT, "PORT", DEFAULT_RUNTIME_PORT);
}

export async function runRuntimeCommand(
  importMetaUrl: string,
  options: Record<string, string | boolean> = {},
) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const entryPath = vendorPath(packageRoot, "runtime", "dist", "src", "index.js");
  const args = [entryPath, ...(options.full === true ? [] : ["--lite"])];
  const background = options.background === true || options.hidden === true;
  const runtimePort = options.full === true
    ? resolveRuntimePort()
    : await resolveLiteRuntimePort(LOOPBACK_BIND_HOST, resolveRuntimePort());
  const runtimeUrl = `http://${LOOPBACK_BIND_HOST}:${runtimePort}`;

  const child = spawn(process.execPath, args, {
    stdio: background ? "ignore" : "inherit",
    detached: background,
    windowsHide: background,
    env: {
      ...process.env,
      HOST: LOOPBACK_BIND_HOST,
      PORT: String(runtimePort),
    },
  });

  if (background) {
    child.unref();
    const state = await readManagedState();
    await writeManagedState({
      ...state,
      version: 1,
      services: [
        ...state.services.filter((service) =>
          service.name !== "lite-runtime" && service.name !== "retrieval-runtime"
        ),
        {
          name: "lite-runtime",
          pid: child.pid ?? 0,
          logPath: path.join(axisLogsDir(), "lite-runtime.log"),
          url: runtimeUrl,
        },
        {
          name: "retrieval-runtime",
          pid: child.pid ?? 0,
          logPath: path.join(axisLogsDir(), "lite-runtime.log"),
          url: runtimeUrl,
        },
      ],
    });
    return;
  }

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

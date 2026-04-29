import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import {
  DEFAULT_RUNTIME_URL,
  DEFAULT_STORAGE_URL,
  DEFAULT_UI_URL,
  DEFAULT_TIMEOUT_MS,
  fetchJson,
  openBrowser,
  packageRootFromImportMeta,
  pathExists,
  vendorPath,
} from "./utils.js";
import { DEFAULT_MNA_HOME_DIR, DEFAULT_MNA_URL } from "./mna-command.js";
import { resolvePlatformUserId } from "./platform-user.js";

export async function runUiCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  const explicitUrl = typeof options.url === "string" ? options.url : undefined;
  if (explicitUrl) {
    process.stdout.write(`visualization url ${explicitUrl}\n`);
    if (options.open === true) {
      await openBrowser(explicitUrl);
    }
    return;
  }

  // Check if managed UI is already running (with retry)
  let defaultUiHealthy = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const defaultUiHealth = await fetchJson(
      `${DEFAULT_UI_URL}/api/health/readiness`,
      DEFAULT_TIMEOUT_MS,
    );
    if (defaultUiHealth.ok) {
      defaultUiHealthy = true;
      break;
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (defaultUiHealthy) {
    process.stdout.write(`visualization url ${DEFAULT_UI_URL}\n`);
    if (options.open === true) {
      await openBrowser(DEFAULT_UI_URL);
    }
    return;
  }

  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const standaloneDir = vendorPath(packageRoot, "visualization", "standalone");
  const serverEntry = path.join(standaloneDir, "server.js");

  if (!(await pathExists(serverEntry))) {
    throw new Error(
      `visualization bundle not found: ${serverEntry}. Run package build with vendor preparation first.`,
    );
  }

  const port = typeof options.port === "string" ? options.port : "3003";
  const host = typeof options.host === "string" ? options.host : "127.0.0.1";
  const open = options.open === true;
  const runtimeUrl =
    typeof options["runtime-url"] === "string" ? options["runtime-url"] : DEFAULT_RUNTIME_URL;
  const storageUrl =
    typeof options["storage-url"] === "string" ? options["storage-url"] : DEFAULT_STORAGE_URL;
  const readModelDsn =
    typeof options["database-url"] === "string"
      ? options["database-url"]
      : process.env.STORAGE_READ_MODEL_DSN ?? process.env.DATABASE_URL ?? "";
  const mnaBaseUrl =
    typeof options["mna-url"] === "string" ? options["mna-url"] : process.env.NEXT_PUBLIC_MNA_BASE_URL ?? DEFAULT_MNA_URL;
  const mnaInternalBaseUrl =
    process.env.MNA_INTERNAL_BASE_URL ?? mnaBaseUrl;
  const mnaTokenPath =
    typeof options["mna-token-path"] === "string"
      ? options["mna-token-path"]
      : process.env.MNA_TOKEN_PATH ?? path.join(DEFAULT_MNA_HOME_DIR, "token.txt");
  const platformUserId = await resolvePlatformUserId();

  const child = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: port,
      HOSTNAME: host,
      NODE_ENV: "production",
      STORAGE_API_BASE_URL: storageUrl,
      RUNTIME_API_BASE_URL: runtimeUrl,
      PLATFORM_USER_ID: platformUserId,
      STORAGE_READ_MODEL_DSN: readModelDsn,
      NEXT_PUBLIC_MNA_BASE_URL: mnaBaseUrl,
      MNA_INTERNAL_BASE_URL: mnaInternalBaseUrl,
      MNA_TOKEN_PATH: mnaTokenPath,
    },
  });

  const uiUrl =
    typeof options["ui-url"] === "string"
      ? options["ui-url"]
      : `${DEFAULT_UI_URL.replace("3003", port)}`;
  process.stdout.write(`visualization starting at ${uiUrl}\n`);

  if (open) {
    await openBrowser(uiUrl);
  }

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

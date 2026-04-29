import process from "node:process";

import { npmCommand, runForeground } from "./managed-process.js";
import { bilingualMessage } from "./messages.js";
import { runCommand } from "./utils.js";
import { readCliVersion } from "./version.js";

const PACKAGE_NAME = "axis-agent";

function normalizeVersion(raw: string) {
  return raw.trim().replace(/^"|"$/g, "");
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

export async function readLatestCliVersion() {
  const result = await runCommand(npmCommand(), ["view", PACKAGE_NAME, "version"], {
    captureOutput: true,
    env: process.env,
    timeoutMs: 2_000,
  });

  if (result.code !== 0) {
    return null;
  }

  const latest = normalizeVersion(result.stdout);
  return latest.length > 0 ? latest : null;
}

export async function maybeWriteUpdateNotice() {
  if (process.env.NODE_ENV === "test" || process.env.AXIS_SKIP_UPDATE_CHECK === "1") {
    return;
  }

  const [currentVersion, latestVersion] = await Promise.all([
    readCliVersion(),
    readLatestCliVersion().catch(() => null),
  ]);

  if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
    return;
  }

  process.stdout.write(`${bilingualMessage(
    `发现 Axis CLI 新版本 ${latestVersion}（当前 ${currentVersion}），可运行 axis update 更新。`,
    `A new Axis CLI version ${latestVersion} is available (current ${currentVersion}). Run axis update to upgrade.`,
  )}\n`);
}

export async function runUpdateCommand() {
  await runForeground(npmCommand(), ["install", "-g", `${PACKAGE_NAME}@latest`]);
}

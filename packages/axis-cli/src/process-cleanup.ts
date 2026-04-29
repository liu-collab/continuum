import { spawn } from "node:child_process";
import process from "node:process";

import { bilingualMessage } from "./messages.js";
import { runCommand } from "./utils.js";

function normalizeWindowsPathForMatch(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function escapePowerShellSingleQuoted(value: string) {
  return value.replace(/'/g, "''");
}

export function buildWindowsLegacyAxisCleanupScript() {
  const pattern =
    "vendor/(storage/dist/src/server\\.js|storage/dist/src/worker\\.js|runtime/dist/src/index\\.js|visualization/standalone/server\\.js|memory-native-agent/bin/mna-server\\.mjs)|axis.*embeddings|local-embedding-service\\.js";
  const repoServicesRoot = process.env.AXIS_REPO_ROOT
    ? `${normalizeWindowsPathForMatch(process.env.AXIS_REPO_ROOT)}/services/`
    : "";

  return `$pattern = '${pattern}'; $repoServicesRoot = '${escapePowerShellSingleQuoted(repoServicesRoot)}'; Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $line = [string]$_.CommandLine; if ([string]::IsNullOrWhiteSpace($line)) { $false } else { $normalized = ($line -replace '\\\\','/').ToLowerInvariant(); $matchesLegacy = $normalized -match $pattern; $matchesRepoServices = -not [string]::IsNullOrWhiteSpace($repoServicesRoot) -and $normalized.Contains($repoServicesRoot); $matchesLegacy -or $matchesRepoServices } } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
}

async function runPowerShellQuiet(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell", args, {
      stdio: "ignore",
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(bilingualMessage(
        `命令执行失败: powershell ${args.join(" ")}`,
        `Command failed: powershell ${args.join(" ")}`,
      )));
    });
    child.on("error", reject);
  });
}

async function stopDarwinLegacyAxisProcesses() {
  const result = await runCommand(
    "pgrep",
    ["-f", "axis\\|memory-native-agent\\|memory-bridge"],
    {
      captureOutput: true,
      env: process.env,
      timeoutMs: 2_000,
    },
  ).catch(() => null);

  if (!result || result.code !== 0) {
    return;
  }

  const pids = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line) && Number(line) !== process.pid);

  if (pids.length === 0) {
    return;
  }

  await runCommand("kill", ["-9", ...pids], {
    captureOutput: true,
    env: process.env,
    timeoutMs: 2_000,
  }).catch(() => undefined);
}

export async function stopLegacyAxisProcesses() {
  if (process.platform === "win32") {
    await runPowerShellQuiet([
      "-NoLogo",
      "-NoProfile",
      "-Command",
      buildWindowsLegacyAxisCleanupScript(),
    ]).catch(() => undefined);
    return;
  }

  if (process.platform === "darwin") {
    await stopDarwinLegacyAxisProcesses();
  }
}

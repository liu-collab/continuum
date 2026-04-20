import { spawn } from "node:child_process";
import process from "node:process";

export function buildWindowsLegacyContinuumCleanupScript() {
  const pattern =
    "vendor/(storage/dist/src/server\\.js|storage/dist/src/worker\\.js|runtime/dist/src/index\\.js|visualization/standalone/server\\.js)|continuum.*embeddings|local-embedding-service\\.js";

  return `$pattern = '${pattern}'; Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $line = [string]$_.CommandLine; if ([string]::IsNullOrWhiteSpace($line)) { $false } else { $normalized = $line -replace '\\\\','/'; $normalized -match $pattern } } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
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
      reject(new Error(`command failed: powershell ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

export async function stopLegacyContinuumProcesses() {
  if (process.platform !== "win32") {
    return;
  }

  await runPowerShellQuiet([
    "-NoLogo",
    "-NoProfile",
    "-Command",
    buildWindowsLegacyContinuumCleanupScript(),
  ]).catch(() => undefined);
}

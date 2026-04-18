import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

async function waitForFile(filePath, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

export default async function globalSetup() {
  const stateFile = path.resolve(currentDir, ".tmp-stack-state.json");
  if (fs.existsSync(stateFile)) {
    fs.rmSync(stateFile, { force: true });
  }

  const tsxCli = path.resolve(currentDir, "../../node_modules/tsx/dist/cli.mjs");
  const child = spawn(process.execPath, [tsxCli, "./tests/agent-e2e/dev-stack.ts"], {
    cwd: path.resolve(currentDir, "../.."),
    env: {
      ...process.env,
      PLAYWRIGHT_STACK_STATE_FILE: stateFile,
    },
    stdio: "pipe",
  });

  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});

  await waitForFile(stateFile);
  const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  process.env.PLAYWRIGHT_BASE_URL = `http://127.0.0.1:${raw.visualizationPort}`;

  return async () => {
    if (!child.killed) {
      child.send?.("shutdown");
      child.kill("SIGTERM");
    }
    if (fs.existsSync(stateFile)) {
      fs.rmSync(stateFile, { force: true });
    }
  };
}

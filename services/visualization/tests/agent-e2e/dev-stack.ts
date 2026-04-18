import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { createE2eStack } from "../../../memory-native-agent/tests/e2e/setup.js";

type RunningState = {
  stack: Awaited<ReturnType<typeof createE2eStack>>;
  visualization: ChildProcess;
  workRoot: string;
  homeDir: string;
  stateFile: string;
};

async function waitForUrl(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function start() {
  const stack = await createE2eStack();
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "viz-agent-stack-"));
  const homeDir = path.join(workRoot, "home");
  const stateFile = process.env.PLAYWRIGHT_STACK_STATE_FILE
    ? path.resolve(process.env.PLAYWRIGHT_STACK_STATE_FILE)
    : path.join(workRoot, "stack-state.json");
  fs.mkdirSync(path.join(homeDir, ".mna"), { recursive: true });
  fs.copyFileSync(stack.mna.mnaTokenPath, path.join(homeDir, ".mna", "token.txt"));

  const mnaAddress = stack.mna.server.address();
  const storageAddress = stack.storageApp?.server.address();
  const runtimeAddress = stack.runtimeApp?.server.address();
  if (!mnaAddress || typeof mnaAddress === "string") {
    throw new Error("mna address unavailable");
  }

  const visualizationPort = 3000;
  const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
  const visualization = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(visualizationPort)], {
    cwd: path.resolve(process.cwd()),
    env: {
      ...process.env,
      NEXT_PUBLIC_MNA_BASE_URL: `http://127.0.0.1:${mnaAddress.port}`,
      MNA_TOKEN_PATH: path.join(homeDir, ".mna", "token.txt"),
      STORAGE_API_BASE_URL:
        storageAddress && typeof storageAddress !== "string"
          ? `http://127.0.0.1:${storageAddress.port}`
          : undefined,
      RUNTIME_API_BASE_URL:
        runtimeAddress && typeof runtimeAddress !== "string"
          ? `http://127.0.0.1:${runtimeAddress.port}`
          : undefined,
    },
    stdio: "pipe",
  });

  visualization.stdout?.on("data", () => {});
  visualization.stderr?.on("data", () => {});

  await waitForUrl(`http://127.0.0.1:${visualizationPort}/api/health/liveness`);

  const runningState: RunningState = {
    stack,
    visualization,
    workRoot,
    homeDir,
    stateFile,
  };

  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      workRoot,
      homeDir,
      visualizationPort,
    }),
    "utf8",
  );

  const stop = async () => {
    if (!visualization.killed) {
      visualization.kill("SIGTERM");
    }
    await stack.close();
    fs.rmSync(workRoot, { recursive: true, force: true });
  };

  process.on("SIGINT", () => {
    void stop().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void stop().finally(() => process.exit(0));
  });
  process.on("message", async (message) => {
    if (message === "shutdown") {
      await stop();
      process.exit(0);
    }
  });
};

void start();

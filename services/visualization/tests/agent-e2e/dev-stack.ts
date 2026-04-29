import fs from "node:fs";
import http from "node:http";
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

async function getAvailablePort() {
  const server = http.createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("available port unavailable");
  }
  return address.port;
}

async function start() {
  const stack = await createE2eStack({
    withMcp: true,
    providerMode: process.env.PLAYWRIGHT_AGENT_PROVIDER_MODE === "record-replay" ? "record-replay" : "stub",
  });
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "viz-agent-stack-"));
  const homeDir = path.join(workRoot, "home");
  const stateFile = process.env.PLAYWRIGHT_STACK_STATE_FILE
    ? path.resolve(process.env.PLAYWRIGHT_STACK_STATE_FILE)
    : path.join(workRoot, "stack-state.json");
  const managedMnaDir = path.join(homeDir, ".axis", "managed", "mna");
  fs.mkdirSync(managedMnaDir, { recursive: true });
  fs.copyFileSync(stack.mna.mnaTokenPath, path.join(managedMnaDir, "token.txt"));

  const mnaAddress = stack.mna.server.address();
  const storageAddress = stack.storageApp?.server.address();
  const runtimeAddress = stack.runtimeApp?.server.address();
  if (!mnaAddress || typeof mnaAddress === "string") {
    throw new Error("mna address unavailable");
  }

  const visualizationPort = await getAvailablePort();
  const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
  const visualization = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(visualizationPort)], {
    cwd: path.resolve(process.cwd()),
    env: {
      ...process.env,
      NEXT_PUBLIC_MNA_BASE_URL: `http://127.0.0.1:${mnaAddress.port}`,
      MNA_TOKEN_PATH: path.join(managedMnaDir, "token.txt"),
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

  const control = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const sendJson = (statusCode: number, payload: Record<string, unknown>) => {
      response.statusCode = statusCode;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    };

    try {
      if (request.method === "POST" && url.pathname === "/runtime/stop") {
        await stack.stopRuntime();
        sendJson(200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/runtime/restart") {
        await stack.restartRuntime();
        sendJson(200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/mna/stop") {
        await stack.stopMna();
        sendJson(200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/mna/restart") {
        await stack.restartMna();
        sendJson(200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/state") {
        const mnaAddress = stack.mna.server.address();
        const runtimeAddress = stack.runtimeApp?.server.address();
        sendJson(200, {
          mnaPort: mnaAddress && typeof mnaAddress !== "string" ? mnaAddress.port : null,
          runtimePort: runtimeAddress && typeof runtimeAddress !== "string" ? runtimeAddress.port : null,
          tokenPath: stack.mna.mnaTokenPath,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/agent/replay-gap") {
        const sessionId = url.searchParams.get("session_id");
        if (!sessionId) {
          sendJson(400, { error: "session_id_required" });
          return;
        }
        const session = stack.mna.runtimeState.sessions.get(sessionId);
        const socket = session?.sockets.values().next().value as { send(data: string): void } | undefined;
        if (!socket) {
          sendJson(404, { error: "session_socket_not_found" });
          return;
        }
        stack.forceReplayGap(sessionId, socket);
        sendJson(200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/agent/session-error") {
        const sessionId = url.searchParams.get("session_id");
        if (!sessionId) {
          sendJson(400, { error: "session_id_required" });
          return;
        }
        stack.emitSessionError(sessionId, {
          code: "session_store_unavailable",
          message: "session store unavailable"
        });
        sendJson(200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/runs/latest") {
        const runs = await stack.runtimeRepository?.getRuns({ page: 1, page_size: 20 });
        const turns = (runs?.turns as Array<Record<string, unknown>> | undefined) ?? [];
        const latestTurn =
          turns.find((turn) => typeof turn.trace_id === "string" && turn.trace_id.length > 0) ?? null;
        sendJson(200, {
          traceId: latestTurn?.trace_id ?? null,
          turnId: latestTurn?.turn_id ?? null,
          turns,
        });
        return;
      }

      sendJson(404, { error: "not_found" });
    } catch (error) {
      sendJson(500, {
        error: "control_handler_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
  await new Promise<void>((resolve) => {
    control.listen(0, "127.0.0.1", () => resolve());
  });
  const controlAddress = control.address();
  if (!controlAddress || typeof controlAddress === "string") {
    throw new Error("control address unavailable");
  }

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
      controlPort: controlAddress.port,
    }),
    "utf8",
  );

  const stop = async () => {
    if (!visualization.killed) {
      visualization.kill("SIGTERM");
    }
    await new Promise<void>((resolve) => control.close(() => resolve()));
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

import type { FastifyInstance } from "fastify";

import { loadConfig, type LoadConfigOptions } from "./config/index.js";
import { createServer, type CreateServerOptions, type MnaServerInstance } from "./server.js";
import { DEFAULT_MNA_HOST, DEFAULT_MNA_PORT } from "./shared/constants.js";
import { MNA_VERSION } from "./shared/types.js";

export * from "./memory-client/index.js";
export * from "./mcp-client/index.js";
export * from "./providers/index.js";
export * from "./shared/token.js";
export * from "./session-store/index.js";
export * from "./skills/index.js";
export * from "./tools/index.js";

export interface StartOptions {
  host?: string;
  port?: number;
  config?: LoadConfigOptions;
  server?: CreateServerOptions;
}

export async function start(options: StartOptions = {}): Promise<MnaServerInstance> {
  const config = loadConfig(options.config);
  const app = createServer(config, options.server);
  await verifyRuntimeVersion(app);
  await app.listen({
    host: options.host ?? DEFAULT_MNA_HOST,
    port: options.port ?? DEFAULT_MNA_PORT,
  });
  return app;
}

export async function stop(app: FastifyInstance): Promise<void> {
  await app.close();
}

export { createServer };

async function verifyRuntimeVersion(app: MnaServerInstance) {
  const runtimeHealth = await app.runtimeState.memoryClient.healthz().catch(() => null);
  const runtimeVersion = extractRuntimeVersion(runtimeHealth);
  if (!runtimeVersion) {
    return;
  }

  if (compareVersions(runtimeVersion, MNA_VERSION) < 0) {
    const error = new Error(`retrieval-runtime 版本过低，当前 ${runtimeVersion}，最低要求 ${MNA_VERSION}`);
    Object.assign(error, { code: "api_version_mismatch" });
    throw error;
  }
}

function extractRuntimeVersion(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = (payload as Record<string, unknown>).version;
  return typeof candidate === "string" ? candidate : null;
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map((item) => Number.parseInt(item, 10) || 0);
  const rightParts = right.split(".").map((item) => Number.parseInt(item, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return 0;
}

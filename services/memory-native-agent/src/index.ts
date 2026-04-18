import type { FastifyInstance } from "fastify";

import { createServer, type MnaServerInstance } from "./server.js";
import { DEFAULT_MNA_HOST, DEFAULT_MNA_PORT } from "./shared/constants.js";

export * from "./memory-client/index.js";
export * from "./mcp-client/index.js";
export * from "./providers/index.js";
export * from "./shared/token.js";

export interface StartOptions {
  host?: string;
  port?: number;
}

export async function start(options: StartOptions = {}): Promise<MnaServerInstance> {
  const app = createServer();
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

import type { FastifyInstance } from "fastify";

import { loadConfig, type LoadConfigOptions } from "./config/index.js";
import { createServer, type CreateServerOptions, type MnaServerInstance } from "./server.js";
import { DEFAULT_MNA_HOST, DEFAULT_MNA_PORT } from "./shared/constants.js";

export * from "./memory-client/index.js";
export * from "./mcp-client/index.js";
export * from "./providers/index.js";
export * from "./shared/token.js";
export * from "./session-store/index.js";
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

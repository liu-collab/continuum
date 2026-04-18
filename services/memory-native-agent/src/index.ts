import type { FastifyInstance } from "fastify";

import { createServer } from "./server.js";
import { DEFAULT_MNA_HOST, DEFAULT_MNA_PORT } from "./shared/types.js";

export interface StartOptions {
  host?: string;
  port?: number;
}

export async function start(options: StartOptions = {}): Promise<FastifyInstance> {
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

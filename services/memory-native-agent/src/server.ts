import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import { loadOrCreateToken } from "./shared/token.js";
import { MNA_VERSION, type HealthzPayload } from "./shared/types.js";

export interface MnaServerInstance extends FastifyInstance {
  mnaToken: string;
  mnaTokenPath: string;
}

export function createServer(): MnaServerInstance {
  const app = Fastify({
    logger: false,
  }) as unknown as MnaServerInstance;

  const tokenBootstrap = loadOrCreateToken();
  app.decorate("mnaToken", tokenBootstrap.token);
  app.decorate("mnaTokenPath", tokenBootstrap.tokenPath);

  void app.register(websocket);

  app.get("/healthz", async (): Promise<HealthzPayload> => ({
    status: "ok",
    version: MNA_VERSION,
    dependencies: {
      retrieval_runtime: "unknown",
    },
  }));

  return app;
}

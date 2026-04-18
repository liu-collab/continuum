import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import { MNA_VERSION, type HealthzPayload } from "./shared/types.js";

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

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

import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import { type AgentConfig } from "./config/index.js";
import { registerHttpRoutes } from "./http/index.js";
import { createRuntimeState } from "./http/state.js";
import type { RuntimeFastifyInstance } from "./http/types.js";
import { cleanupExpiredArtifacts } from "./shared/artifacts.js";
import { loadOrCreateToken } from "./shared/token.js";

export interface MnaServerInstance extends RuntimeFastifyInstance, FastifyInstance {
  mnaToken: string;
  mnaTokenPath: string;
}

export interface CreateServerOptions {
  homeDirectory?: string;
}

export function createServer(config: AgentConfig, options: CreateServerOptions = {}): MnaServerInstance {
  const app = Fastify({
    logger: false,
  }) as unknown as MnaServerInstance;

  const tokenBootstrap = loadOrCreateToken(options.homeDirectory);
  cleanupExpiredArtifacts({
    homeDirectory: options.homeDirectory,
  });
  const runtimeState = createRuntimeState(config, options);
  app.decorate("mnaToken", tokenBootstrap.token);
  app.decorate("mnaTokenPath", tokenBootstrap.tokenPath);
  app.decorate("runtimeState", runtimeState);
  app.addHook("onClose", async () => {
    await runtimeState.mcpRegistry.shutdown().catch(() => undefined);
    runtimeState.store.close();
  });

  void app.register(websocket);
  app.after(() => {
    registerHttpRoutes(app);
  });

  return app;
}

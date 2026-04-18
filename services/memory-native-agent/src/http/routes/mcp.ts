import { z } from "zod";

import type { RuntimeFastifyInstance } from "../types.js";

export function registerMcpRoutes(app: RuntimeFastifyInstance) {
  app.get("/v1/agent/mcp/servers", async () => ({
    servers: app.runtimeState.mcpRegistry.listServerStatuses(),
    tools: app.runtimeState.mcpRegistry.listTools(),
  }));

  app.post("/v1/agent/mcp/servers/:name/restart", async (request, reply) => {
    const params = z.object({ name: z.string().min(1) }).parse(request.params);
    await app.runtimeState.mcpRegistry.restartServer(params.name).catch(() => undefined);
    return reply.code(202).send({ ok: true });
  });

  app.post("/v1/agent/mcp/servers/:name/disable", async (request, reply) => {
    const params = z.object({ name: z.string().min(1) }).parse(request.params);
    app.runtimeState.mcpRegistry.disableServer(params.name);
    return reply.code(202).send({ ok: true });
  });
}

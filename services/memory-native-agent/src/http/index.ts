import type { RuntimeFastifyInstance } from "./types.js";

import { registerOpenApiRoutes } from "./routes/openapi.js";
import { verifyToken } from "./middleware/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerSessionWebsocket } from "./ws/session-ws.js";

export function registerHttpRoutes(app: RuntimeFastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "internal_error";
    const message = error instanceof Error ? error.message : "Internal server error.";
    const statusCode =
      code === "token_invalid" ? 401
      : code === "session_not_found" || code === "turn_not_found" ? 404
      : code === "provider_not_registered" || code === "tool_denied_path" ? 400
      : 500;

    void reply.code(statusCode).send({
      error: {
        code,
        message,
      },
    });
  });

  app.addHook("preHandler", verifyToken);
  registerHealthRoutes(app);
  registerOpenApiRoutes(app);
  registerSessionRoutes(app);
  registerMcpRoutes(app);
  registerSessionWebsocket(app);
}

import type { FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeFastifyInstance } from "../types.js";

export async function verifyToken(request: FastifyRequest, reply: FastifyReply) {
  const url = request.url.split("?")[0];
  if (url === "/healthz" || url === "/readyz") {
    return;
  }

  const authHeader = request.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
  const queryToken = typeof (request.query as Record<string, unknown>)?.token === "string"
    ? ((request.query as Record<string, unknown>).token as string)
    : undefined;
  const token = bearerToken ?? queryToken;
  const app = request.server as RuntimeFastifyInstance;

  if (!token || token !== app.mnaToken) {
    return reply.code(401).send({
      error: {
        code: "token_invalid",
        message: "Invalid or missing token.",
      },
    });
  }
}

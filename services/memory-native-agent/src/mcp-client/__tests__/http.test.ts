import http from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { McpRegistry } from "../index.js";
import { McpToolCallError, McpServerUnavailableError } from "../types.js";

type RunningHttpServer = {
  close(): Promise<void>;
  url: string;
};

type TestRequest = http.IncomingMessage & {
  body?: unknown;
  headers: http.IncomingHttpHeaders;
};

type TestResponse = http.ServerResponse<http.IncomingMessage> & {
  json(payload: unknown): void;
  status(code: number): TestResponse;
  send(payload: unknown): void;
};

async function startHttpFixture(): Promise<RunningHttpServer> {
  const app = createMcpExpressApp();
  const transports = new Map<string, StreamableHTTPServerTransport>();
  let closed = false;

  app.post("/mcp", async (req: TestRequest, res: TestResponse) => {
    const rawSessionId = req.headers["mcp-session-id"];
    const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;

    try {
      if (!sessionId) {
        const server = buildFixtureServer();
        const transport = new StreamableHTTPServerTransport({
          onsessioninitialized(initializedSessionId) {
            transports.set(initializedSessionId, transport);
          },
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "session not found" });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/mcp", async (req: TestRequest, res: TestResponse) => {
    const sessionId = req.headers["mcp-session-id"];
    const transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).send("session not found");
      return;
    }

    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req: TestRequest, res: TestResponse) => {
    const rawSessionId = req.headers["mcp-session-id"];
    const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).send("session not found");
      return;
    }

    await transport.handleRequest(req, res);
    if (sessionId) {
      transports.delete(sessionId);
    }
  });

  const server = await new Promise<http.Server>((resolve) => {
    const startedServer = app.listen(0, "127.0.0.1", () => {
      resolve(startedServer);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("unable to resolve http fixture address");
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await Promise.all([...transports.values()].map((transport) => transport.close().catch(() => undefined)));
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            if (String(error.message).includes("Server is not running")) {
              resolve();
              return;
            }
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

function buildFixtureServer() {
  const server = new McpServer({
    name: "echo-http-server",
    version: "1.0.0",
  });

  server.registerTool(
    "echo_text",
    {
      description: "Echo input text from http server.",
      inputSchema: {
        text: z.string(),
      },
    },
    async ({ text }) => ({
      content: [
        {
          type: "text",
          text: `http:${text}`,
        },
      ],
    }),
  );

  return server;
}

describe("McpRegistry http transport", () => {
  const registries: McpRegistry[] = [];
  const servers: RunningHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(registries.splice(0).map((registry) => registry.shutdown()));
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("lists tools and calls an HTTP MCP tool", async () => {
    const server = await startHttpFixture();
    servers.push(server);

    const registry = new McpRegistry();
    registries.push(registry);

    await registry.addServer({
      name: "http-fixture",
      transport: "http",
      url: server.url,
    });

    expect(registry.listTools()).toEqual([
      expect.objectContaining({
        server: "http-fixture",
        name: "echo_text",
      }),
    ]);

    const result = await registry.callTool("http-fixture", "echo_text", { text: "world" });
    expect(result.is_error).toBe(false);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "http:world",
      },
    ]);
  });

  it("supports disable and restart for a connected HTTP server", async () => {
    const server = await startHttpFixture();
    servers.push(server);

    const registry = new McpRegistry();
    registries.push(registry);

    await registry.addServer({
      name: "http-fixture",
      transport: "http",
      url: server.url,
    });

    registry.disableServer("http-fixture");
    expect(registry.getServerStatus("http-fixture").state).toBe("disabled");
    expect(registry.listTools()).toEqual([]);

    await registry.restartServer("http-fixture");
    expect(registry.getServerStatus("http-fixture").state).toBe("ok");
    expect(registry.listTools()).toHaveLength(1);
  });

  it("fails a crashed server call without affecting other HTTP servers", async () => {
    const unstableServer = await startHttpFixture();
    const healthyServer = await startHttpFixture();
    servers.push(unstableServer, healthyServer);

    const registry = new McpRegistry();
    registries.push(registry);

    await registry.addServer({
      name: "unstable-http",
      transport: "http",
      url: unstableServer.url,
    });
    await registry.addServer({
      name: "healthy-http",
      transport: "http",
      url: healthyServer.url,
    });

    await unstableServer.close();

    await expect(registry.callTool("unstable-http", "echo_text", { text: "boom" })).rejects.toBeInstanceOf(McpToolCallError);
    expect(registry.getServerStatus("healthy-http").state).toBe("ok");

    const result = await registry.callTool("healthy-http", "echo_text", { text: "still-ok" });
    expect(result.content).toEqual([
      {
        type: "text",
        text: "http:still-ok",
      },
    ]);
  });

  it("rejects tool calls while server is disabled and recovers after restart", async () => {
    const server = await startHttpFixture();
    servers.push(server);

    const registry = new McpRegistry();
    registries.push(registry);

    await registry.addServer({
      name: "http-fixture",
      transport: "http",
      url: server.url,
    });

    registry.disableServer("http-fixture");
    await expect(registry.callTool("http-fixture", "echo_text", { text: "blocked" })).rejects.toBeInstanceOf(McpServerUnavailableError);

    await registry.restartServer("http-fixture");
    const result = await registry.callTool("http-fixture", "echo_text", { text: "back" });
    expect(result.content).toEqual([
      {
        type: "text",
        text: "http:back",
      },
    ]);
  });
});

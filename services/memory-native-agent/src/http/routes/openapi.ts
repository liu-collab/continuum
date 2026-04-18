import type { RuntimeFastifyInstance } from "../types.js";

export function registerOpenApiRoutes(app: RuntimeFastifyInstance) {
  app.get("/v1/agent/openapi.json", async () => ({
    openapi: "3.1.0",
    info: {
      title: "memory-native-agent API",
      version: "0.1.0",
    },
    paths: {
      "/healthz": {
        get: {
          summary: "Liveness and version",
        },
      },
      "/readyz": {
        get: {
          summary: "Readiness",
        },
      },
      "/v1/agent/dependency-status": {
        get: {
          summary: "Dependency status",
        },
      },
      "/v1/agent/metrics": {
        get: {
          summary: "Runtime metrics",
        },
      },
      "/v1/agent/sessions": {
        get: {
          summary: "List sessions",
        },
        post: {
          summary: "Create session",
        },
      },
      "/v1/agent/sessions/{id}": {
        get: {
          summary: "Get session",
        },
        patch: {
          summary: "Update session",
        },
        delete: {
          summary: "Close or purge session",
        },
      },
      "/v1/agent/sessions/{id}/mode": {
        post: {
          summary: "Update memory mode",
        },
      },
      "/v1/agent/sessions/{id}/provider": {
        post: {
          summary: "Update next-turn provider",
        },
      },
      "/v1/agent/turns/{turnId}/dispatched-messages": {
        get: {
          summary: "Prompt inspector payload",
        },
      },
      "/v1/agent/fs/tree": {
        get: {
          summary: "Workspace file tree",
        },
      },
      "/v1/agent/fs/file": {
        get: {
          summary: "Read workspace file",
        },
      },
      "/v1/agent/artifacts/{sessionId}/{file}": {
        get: {
          summary: "Read artifact",
        },
      },
      "/v1/agent/mcp/servers": {
        get: {
          summary: "List MCP servers",
        },
      },
      "/v1/agent/mcp/servers/{name}/restart": {
        post: {
          summary: "Restart MCP server",
        },
      },
      "/v1/agent/mcp/servers/{name}/disable": {
        post: {
          summary: "Disable MCP server",
        },
      },
    },
  }));
}

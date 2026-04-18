import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { McpRegistry, McpServerNotFoundError, McpServerUnavailableError } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("McpRegistry stdio transport", () => {
  const registries: McpRegistry[] = [];

  afterEach(async () => {
    await Promise.all(registries.splice(0).map((registry) => registry.shutdown()));
  });

  it("lists tools and calls a stdio MCP tool", async () => {
    const registry = new McpRegistry();
    registries.push(registry);

    await registry.addServer({
      name: "stdio-fixture",
      transport: "stdio",
      command: process.execPath,
      args: [path.join(__dirname, "fixtures", "echo-stdio-server.mjs")],
    });

    expect(registry.listTools()).toEqual([
      expect.objectContaining({
        server: "stdio-fixture",
        name: "echo_text",
      }),
    ]);

    const result = await registry.callTool("stdio-fixture", "echo_text", { text: "hello" });
    expect(result.is_error).toBe(false);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "stdio:hello",
      },
    ]);
  });

  it("marks an invalid stdio server as unavailable and does not block the registry", async () => {
    const registry = new McpRegistry();
    registries.push(registry);

    await registry.addServer({
      name: "broken-stdio",
      transport: "stdio",
      command: "node-this-does-not-exist",
    });

    expect(registry.listTools()).toEqual([]);
    expect(registry.getServerStatus("broken-stdio").state).toBe("unavailable");
    await expect(registry.callTool("broken-stdio", "echo_text", { text: "x" })).rejects.toBeInstanceOf(
      McpServerUnavailableError,
    );
  });

  it("throws when the requested server does not exist", async () => {
    const registry = new McpRegistry();
    registries.push(registry);

    await expect(registry.callTool("missing", "echo", {})).rejects.toBeInstanceOf(McpServerNotFoundError);
  });
});

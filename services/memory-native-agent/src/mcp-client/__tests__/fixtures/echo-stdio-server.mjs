import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

const server = new McpServer({
  name: "echo-stdio-server",
  version: "1.0.0",
});

server.registerTool(
  "echo_text",
  {
    description: "Echo input text from stdio server.",
    inputSchema: {
      text: z.string(),
    },
  },
  async ({ text }) => ({
    content: [
      {
        type: "text",
        text: `stdio:${text}`,
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

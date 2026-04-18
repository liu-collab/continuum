import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  type McpCallResult,
  type McpClientConnection,
  type McpServerConfig,
  type McpToolDescriptor,
} from "./types.js";

const CLIENT_INFO = {
  name: "memory-native-agent",
  version: "0.1.0",
};

export class HttpMcpClientConnection implements McpClientConnection {
  private readonly config: McpServerConfig;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const transport = new StreamableHTTPClientTransport(new URL(this.config.url!), {
      requestInit: {
        headers: this.config.headers,
      },
    });

    const client = new Client(CLIENT_INFO, {
      capabilities: {},
    });

    await client.connect(transport, {
      timeout: this.config.startup_timeout_ms,
      maxTotalTimeout: this.config.startup_timeout_ms,
    });

    this.transport = transport;
    this.client = client;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const client = this.requireClient();
    const result = await client.listTools(undefined, this.requestOptions());

    return result.tools.map((tool) => ({
      server: this.config.name,
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema,
    }));
  }

  async callTool(tool: string, args: unknown): Promise<McpCallResult> {
    const client = this.requireClient();
    const result = (await client.callTool(
      {
        name: tool,
        arguments: isRecord(args) ? args : {},
      },
      CallToolResultSchema,
      this.requestOptions(),
    )) as CallToolResult;

    return {
      server: this.config.name,
      tool,
      is_error: Boolean(result.isError),
      content: result.content.map((item: CallToolResult["content"][number]) => {
        if (item.type === "text") {
          return {
            type: "text" as const,
            text: item.text,
          };
        }

        if (item.type === "image") {
          return {
            type: "image" as const,
            data: item.data,
            mimeType: item.mimeType,
          };
        }

        if (item.type === "audio") {
          return {
            type: "audio" as const,
            data: item.data,
            mimeType: item.mimeType,
          };
        }

        if (item.type === "resource") {
          return {
            type: "resource" as const,
            resource: item.resource,
          };
        }

        return {
          type: "resource_link" as const,
          uri: item.uri,
          name: item.name,
          mimeType: item.mimeType,
          description: item.description,
        };
      }),
      structured_content: isRecord(result.structuredContent) ? result.structuredContent : undefined,
    };
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.transport = null;

    const client = this.client;
    this.client = null;

    if (transport) {
      await transport.close().catch(() => undefined);
    }

    if (client) {
      await client.close().catch(() => undefined);
    }
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error(`MCP HTTP client "${this.config.name}" is not connected.`);
    }

    return this.client;
  }

  private requestOptions() {
    return {
      timeout: this.config.request_timeout_ms,
      maxTotalTimeout: this.config.request_timeout_ms,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

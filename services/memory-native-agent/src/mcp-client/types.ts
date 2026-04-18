import { z } from "zod";

export const mcpTransportSchema = z.enum(["stdio", "http"]);
export const mcpServerStateSchema = z.enum(["ok", "unavailable", "dead", "disabled"]);

export const mcpServerConfigSchema = z
  .object({
    name: z.string().trim().min(1),
    transport: mcpTransportSchema,
    command: z.string().trim().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().trim().url().optional(),
    headers: z.record(z.string()).optional(),
    cwd: z.string().trim().min(1).optional(),
    startup_timeout_ms: z.coerce.number().int().min(100).max(120_000).optional(),
    request_timeout_ms: z.coerce.number().int().min(100).max(120_000).optional(),
    reconnect_on_failure: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.transport === "stdio" && !value.command) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "stdio transport requires command",
      });
    }

    if (value.transport === "http" && !value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "http transport requires url",
      });
    }
  });

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type McpServerState = z.infer<typeof mcpServerStateSchema>;

export interface McpToolDescriptor {
  server: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface McpCallResult {
  server: string;
  tool: string;
  is_error: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "audio"; data: string; mimeType: string }
    | { type: "resource"; resource: Record<string, unknown> }
    | { type: "resource_link"; uri: string; name: string; mimeType?: string; description?: string }
  >;
  structured_content?: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  transport: McpTransport;
  state: McpServerState;
  last_error?: string;
  connected_at?: string;
  tool_count: number;
}

export interface McpClientConnection {
  connect(): Promise<void>;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(tool: string, args: unknown): Promise<McpCallResult>;
  close(): Promise<void>;
}

export class McpServerNotFoundError extends Error {
  constructor(serverName: string) {
    super(`MCP server "${serverName}" is not registered.`);
    this.name = "McpServerNotFoundError";
  }
}

export class McpServerUnavailableError extends Error {
  readonly serverName: string;

  constructor(serverName: string, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "McpServerUnavailableError";
    this.serverName = serverName;
  }
}

export class McpToolCallError extends Error {
  readonly serverName: string;
  readonly toolName: string;

  constructor(serverName: string, toolName: string, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "McpToolCallError";
    this.serverName = serverName;
    this.toolName = toolName;
  }
}

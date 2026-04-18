import { HttpMcpClientConnection } from "./http-transport.js";
import { StdioMcpClientConnection } from "./stdio-transport.js";
import {
  McpServerNotFoundError,
  McpServerUnavailableError,
  McpToolCallError,
  mcpServerConfigSchema,
  type McpCallResult,
  type McpClientConnection,
  type McpServerConfig,
  type McpServerState,
  type McpServerStatus,
  type McpToolDescriptor,
} from "./types.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

type RegistryLogger = {
  info?(payload: Record<string, unknown>, message?: string): void;
  warn?(payload: Record<string, unknown>, message?: string): void;
};

type ServerEntry = {
  config: McpServerConfig;
  connection: McpClientConnection | null;
  tools: McpToolDescriptor[];
  state: McpServerState;
  lastError?: string;
  connectedAt?: string;
};

export interface McpRegistryOptions {
  logger?: RegistryLogger;
}

export class McpRegistry {
  private readonly logger: RegistryLogger;
  private readonly servers = new Map<string, ServerEntry>();

  constructor(options: McpRegistryOptions = {}) {
    this.logger = options.logger ?? {};
  }

  async addServer(config: McpServerConfig): Promise<void> {
    const parsed = mcpServerConfigSchema.parse({
      ...config,
      startup_timeout_ms: config.startup_timeout_ms ?? DEFAULT_STARTUP_TIMEOUT_MS,
      request_timeout_ms: config.request_timeout_ms ?? DEFAULT_REQUEST_TIMEOUT_MS,
      reconnect_on_failure: config.reconnect_on_failure ?? true,
    });

    const existing = this.servers.get(parsed.name);
    if (existing) {
      await this.closeEntry(existing);
    }

    const entry: ServerEntry = {
      config: parsed,
      connection: null,
      tools: [],
      state: "unavailable",
    };

    this.servers.set(parsed.name, entry);
    await this.connectEntry(entry, "unavailable");
  }

  listTools(): McpToolDescriptor[] {
    return [...this.servers.values()]
      .filter((entry) => entry.state === "ok")
      .flatMap((entry) => entry.tools);
  }

  async callTool(server: string, tool: string, args: unknown): Promise<McpCallResult> {
    const entry = this.requireEntry(server);
    if (entry.state === "disabled") {
      throw new McpServerUnavailableError(server, `MCP server "${server}" is disabled.`);
    }

    if (entry.state !== "ok" || !entry.connection) {
      throw new McpServerUnavailableError(server, `MCP server "${server}" is not available.`);
    }

    try {
      return await entry.connection.callTool(tool, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (entry.config.reconnect_on_failure) {
        await this.connectEntry(entry, "dead").catch(() => undefined);
      } else {
        this.markEntry(entry, "dead", message);
      }

      throw new McpToolCallError(server, tool, message, {
        cause: error,
      });
    }
  }

  async restartServer(name: string): Promise<void> {
    const entry = this.requireEntry(name);
    entry.state = "unavailable";
    await this.connectEntry(entry, "dead");
  }

  disableServer(name: string): void {
    const entry = this.requireEntry(name);
    void this.closeEntry(entry);
    entry.state = "disabled";
    entry.tools = [];
    entry.connectedAt = undefined;
  }

  getServerStatus(name: string): McpServerStatus {
    return this.toStatus(this.requireEntry(name));
  }

  listServerStatuses(): McpServerStatus[] {
    return [...this.servers.values()].map((entry) => this.toStatus(entry));
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.servers.values()].map((entry) => this.closeEntry(entry)));
  }

  private async connectEntry(entry: ServerEntry, failureState: Extract<McpServerState, "unavailable" | "dead">) {
    await this.closeEntry(entry);

    const connection = entry.config.transport === "stdio"
      ? new StdioMcpClientConnection(entry.config)
      : new HttpMcpClientConnection(entry.config);

    try {
      await connection.connect();
      const tools = await connection.listTools();

      entry.connection = connection;
      entry.tools = tools;
      entry.state = "ok";
      entry.lastError = undefined;
      entry.connectedAt = new Date().toISOString();

      this.logger.info?.(
        {
          server: entry.config.name,
          transport: entry.config.transport,
          tool_count: tools.length,
        },
        "mcp server connected",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entry.connection = null;
      entry.tools = [];
      this.markEntry(entry, failureState, message);

      this.logger.warn?.(
        {
          server: entry.config.name,
          transport: entry.config.transport,
          error_message: message,
        },
        "mcp server unavailable",
      );
    }
  }

  private markEntry(entry: ServerEntry, state: McpServerState, message: string) {
    entry.state = state;
    entry.lastError = message;
    entry.connectedAt = undefined;
  }

  private async closeEntry(entry: ServerEntry) {
    const connection = entry.connection;
    entry.connection = null;

    if (connection) {
      await connection.close().catch(() => undefined);
    }
  }

  private requireEntry(name: string): ServerEntry {
    const entry = this.servers.get(name);
    if (!entry) {
      throw new McpServerNotFoundError(name);
    }

    return entry;
  }

  private toStatus(entry: ServerEntry): McpServerStatus {
    return {
      name: entry.config.name,
      transport: entry.config.transport,
      state: entry.state,
      last_error: entry.lastError,
      connected_at: entry.connectedAt,
      tool_count: entry.tools.length,
    };
  }
}

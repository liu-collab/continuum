import type { AgentConfig } from "../config/index.js";
import type { McpRegistry } from "../mcp-client/index.js";
import type { SessionStore } from "../session-store/index.js";
import { createFsEditTool } from "./builtin/fs-edit.js";
import { createFsReadTool } from "./builtin/fs-read.js";
import { createFsWriteTool } from "./builtin/fs-write.js";
import { createMcpCallTool } from "./builtin/mcp-call.js";
import { createShellExecTool } from "./builtin/shell-exec.js";
import { ToolDispatcher } from "./dispatcher.js";
import { ToolRegistry } from "./registry.js";

export * from "./dispatcher.js";
export * from "./errors.js";
export * from "./helpers.js";
export * from "./permission-gate.js";
export * from "./registry.js";
export * from "./types.js";

export function createDefaultToolRegistry(options: {
  config: AgentConfig;
  mcpRegistry: McpRegistry;
}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createFsReadTool());
  registry.register(createFsWriteTool());
  registry.register(createFsEditTool());
  registry.register(
    createShellExecTool({
      denyPatterns: options.config.tools.shellExec.denyPatterns,
      defaultTimeoutMs: options.config.tools.shellExec.timeoutMs,
    }),
  );
  registry.register(createMcpCallTool(options.mcpRegistry));
  return registry;
}

export function createDefaultToolDispatcher(options: {
  config: AgentConfig;
  mcpRegistry: McpRegistry;
  sessionStore?: SessionStore;
  artifactsRoot?: string;
}) {
  return new ToolDispatcher({
    registry: createDefaultToolRegistry({
      config: options.config,
      mcpRegistry: options.mcpRegistry,
    }),
    sessionStore: options.sessionStore,
    artifactsRoot: options.artifactsRoot,
    defaultMaxOutputChars: options.config.tools.maxOutputChars,
  });
}

declare module "*.mjs";

declare module "../host-adapters/memory-claude-plugin/bin/memory-bridge.mjs" {
  export function resolveField(
    event: Record<string, unknown>,
    keys: string[],
    envKey: string,
    label: string,
  ): string;
}

declare module "../host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs" {
  export function createTools(baseUrl?: string): Record<string, unknown>;
  export function handleLine(line: string): Promise<void>;
}

declare module "./host-adapters/memory-claude-plugin/bin/memory-bridge.mjs" {
  export function resolveField(
    event: Record<string, unknown>,
    keys: string[],
    envKey: string,
    label: string,
  ): string;
}

declare module "./host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs" {
  export function createTools(baseUrl?: string): Record<string, unknown>;
  export function handleLine(line: string): Promise<void>;
}

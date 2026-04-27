declare module "*.mjs";

declare module "./e2e/real-user-experience/tasks.mjs" {
  export interface RealUserExperienceTask {
    id: string;
    scenario: string;
    title: string;
    user_input: string;
    seed_memories: Array<{
      summary: string;
    }>;
    expected: {
      should_writeback: boolean;
    };
  }

  export const TASKS: RealUserExperienceTask[];
  export function getTaskById(id: string): RealUserExperienceTask | undefined;
}

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

import fs from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_MAP_FILENAME } from "../config/defaults.js";
import type { MnaRuntimeState } from "./state.js";

export async function readWorkspaceMappings(state: MnaRuntimeState): Promise<Record<string, string>> {
  const mappingPath = path.join(state.mnaHomeDirectory, WORKSPACE_MAP_FILENAME);

  try {
    return JSON.parse(await fs.readFile(mappingPath, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function resolveWorkspaceRoot(state: MnaRuntimeState, workspaceId?: string | null): Promise<string | null> {
  if (!workspaceId || workspaceId === state.config.memory.workspaceId) {
    return state.config.memory.cwd;
  }

  const mappings = await readWorkspaceMappings(state);
  for (const [cwd, mappedWorkspaceId] of Object.entries(mappings)) {
    if (mappedWorkspaceId === workspaceId) {
      return cwd;
    }
  }

  return null;
}

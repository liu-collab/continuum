import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function firstExistingPath(paths: string[]) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return paths[0]!;
}

export async function loadBuildStateHelpers(packageRoot: string) {
  const buildStatePath = await firstExistingPath([
    path.join(packageRoot, "dist", "scripts", "build-state.mjs"),
    path.join(packageRoot, "scripts", "build-state.mjs"),
  ]);

  return import(pathToFileURL(buildStatePath).href) as Promise<{
    planVendorBuild(packageDir: string): Promise<{
      currentState: {
        version: number;
        cli: unknown;
        image: unknown;
        vendor: {
          entries: Record<string, string>;
          builds: Record<string, string>;
        };
      };
      nextState: {
        version: number;
        cli: unknown;
        image: unknown;
        vendor: {
          entries: Record<string, string>;
          builds: Record<string, string>;
        };
      };
      changedEntries: string[];
      buildServices: string[];
      needsRefresh: boolean;
    }>;
    planStackImageBuild(packageDir: string): Promise<{
      nextState: unknown;
      needsBuild: boolean;
    }>;
    writeBuildState(nextState: unknown): Promise<void>;
  }>;
}

import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadBuildStateHelpers(packageRoot: string) {
  return import(pathToFileURL(path.join(packageRoot, "scripts", "build-state.mjs")).href) as Promise<{
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

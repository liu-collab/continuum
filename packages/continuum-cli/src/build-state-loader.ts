import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadBuildStateHelpers(packageRoot: string) {
  return import(pathToFileURL(path.join(packageRoot, "scripts", "build-state.mjs")).href) as Promise<{
    planStackImageBuild(packageDir: string): Promise<{
      nextState: unknown;
      needsBuild: boolean;
    }>;
    writeBuildState(nextState: unknown): Promise<void>;
  }>;
}

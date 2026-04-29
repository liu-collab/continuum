import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { pathExists, safeJsonParse } from "./utils.js";

export async function readCliVersion() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonCandidates = [
    path.join(currentDir, "..", "package.json"),
    path.join(currentDir, "..", "..", "package.json"),
  ];
  const fallbackPackageJsonPath = packageJsonCandidates[0];
  if (!fallbackPackageJsonPath) {
    throw new Error("continuum package.json path cannot be resolved");
  }
  const packageJsonPath =
    (await resolveExistingPath(packageJsonCandidates))
    ?? fallbackPackageJsonPath;
  const content = await readFile(packageJsonPath, "utf8");
  const parsed = safeJsonParse<{ version?: unknown }>(packageJsonPath, content);

  if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error(`continuum package version is missing: ${packageJsonPath}`);
  }

  return parsed.version;
}

async function resolveExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

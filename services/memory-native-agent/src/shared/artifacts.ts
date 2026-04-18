import fs from "node:fs";
import path from "node:path";

import { DEFAULT_ARTIFACT_RETENTION_DAYS } from "./constants.js";
import { resolveArtifactsRoot } from "./token.js";

export function cleanupExpiredArtifacts(options?: {
  homeDirectory?: string;
  now?: number;
  retentionDays?: number;
}): { removed: string[]; artifactsRoot: string } {
  const artifactsRoot = resolveArtifactsRoot(options?.homeDirectory);
  if (!fs.existsSync(artifactsRoot)) {
    return {
      removed: [],
      artifactsRoot,
    };
  }

  const now = options?.now ?? Date.now();
  const retentionMs = (options?.retentionDays ?? DEFAULT_ARTIFACT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  const cutoff = now - retentionMs;
  const removed: string[] = [];

  for (const entry of fs.readdirSync(artifactsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const targetPath = path.join(artifactsRoot, entry.name);
    const stats = fs.statSync(targetPath);
    const lastTouchedAt = stats.mtimeMs;
    if (lastTouchedAt >= cutoff) {
      continue;
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
    removed.push(entry.name);
  }

  return {
    removed,
    artifactsRoot,
  };
}

import fs from "node:fs/promises";
import path from "node:path";

import type { RuntimeFastifyInstance } from "../types.js";

type CachedDependencyProbe = {
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  detail: string;
  last_checked_at: string;
};

type CachedDependencyStatus = {
  embeddings?: CachedDependencyProbe;
  memory_llm?: CachedDependencyProbe;
};

export function resolveManagedDependencyStatusPath(app: RuntimeFastifyInstance) {
  return process.env.CONTINUUM_DEPENDENCY_STATUS_PATH?.trim()
    || path.join(path.dirname(path.dirname(app.mnaTokenPath)), "dependency-status-cache.json");
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, payload: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export async function readManagedDependencyStatus(app: RuntimeFastifyInstance) {
  return (await readJson<CachedDependencyStatus>(resolveManagedDependencyStatusPath(app))) ?? {};
}

export async function writeManagedDependencyProbe(
  app: RuntimeFastifyInstance,
  name: "embeddings" | "memory_llm",
  payload: CachedDependencyProbe,
) {
  const current = await readManagedDependencyStatus(app);
  await writeJson(resolveManagedDependencyStatusPath(app), {
    ...current,
    [name]: payload,
  });
}

export async function clearManagedDependencyProbe(
  app: RuntimeFastifyInstance,
  names: Array<"embeddings" | "memory_llm">,
) {
  const current = await readManagedDependencyStatus(app);
  const next = { ...current };
  for (const name of names) {
    delete next[name];
  }
  await writeJson(resolveManagedDependencyStatusPath(app), next);
}

export function mergeManagedDependencyStatus<T extends {
  embeddings?: Record<string, unknown>;
  memory_llm?: Record<string, unknown>;
}>(runtime: T, cached: CachedDependencyStatus): T {
  return {
    ...runtime,
    ...(cached.embeddings
      ? {
          embeddings: {
            ...(runtime.embeddings ?? {}),
            ...cached.embeddings,
          },
        }
      : {}),
    ...(cached.memory_llm
      ? {
          memory_llm: {
            ...(runtime.memory_llm ?? {}),
            ...cached.memory_llm,
          },
        }
      : {}),
  };
}

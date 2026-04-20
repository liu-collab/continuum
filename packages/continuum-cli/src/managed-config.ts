import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { continuumManagedDir } from "./managed-state.js";
import type { ManagedMnaProviderConfig } from "./mna-provider-config.js";
import { pathExists } from "./utils.js";

export type ManagedEmbeddingConfig = {
  version: 1;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export type ManagedProviderOverride = {
  provider: ManagedMnaProviderConfig;
};

export function continuumManagedEmbeddingConfigPath() {
  return path.join(continuumManagedDir(), "embedding-config.json");
}

export function managedMnaProviderConfigPath(mnaHomeDir: string) {
  return path.join(mnaHomeDir, "config.json");
}

export async function readManagedEmbeddingConfig(): Promise<ManagedEmbeddingConfig | null> {
  const filePath = continuumManagedEmbeddingConfigPath();
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as ManagedEmbeddingConfig;
}

export async function writeManagedEmbeddingConfig(config: ManagedEmbeddingConfig) {
  const filePath = continuumManagedEmbeddingConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
}

export async function writeManagedMnaProviderConfig(
  mnaHomeDir: string,
  provider: ManagedMnaProviderConfig,
) {
  const filePath = managedMnaProviderConfigPath(mnaHomeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        provider,
      } satisfies ManagedProviderOverride,
      null,
      2,
    ),
    "utf8",
  );
}

export async function readManagedMnaProviderConfig(
  mnaHomeDir: string,
): Promise<ManagedMnaProviderConfig | null> {
  const filePath = managedMnaProviderConfigPath(mnaHomeDir);
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  const payload = JSON.parse(content) as ManagedProviderOverride;
  return payload.provider ?? null;
}

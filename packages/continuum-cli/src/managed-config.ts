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

export type ManagedWritebackLlmConfig = {
  version: 1;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  protocol?: "anthropic" | "openai-compatible";
};

export type ManagedProviderOverride = {
  provider: {
    kind: ManagedMnaProviderConfig["kind"];
    model: string;
    base_url?: string;
    api_key?: string;
    api_key_env?: string;
    baseUrl?: string;
    apiKey?: string;
    apiKeyEnv?: string;
  };
};

export function continuumManagedEmbeddingConfigPath() {
  return path.join(continuumManagedDir(), "embedding-config.json");
}

export function continuumManagedWritebackLlmConfigPath() {
  return path.join(continuumManagedDir(), "writeback-llm-config.json");
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

export async function readManagedWritebackLlmConfig(): Promise<ManagedWritebackLlmConfig | null> {
  const filePath = continuumManagedWritebackLlmConfigPath();
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as ManagedWritebackLlmConfig;
}

export async function writeManagedWritebackLlmConfig(config: ManagedWritebackLlmConfig) {
  const filePath = continuumManagedWritebackLlmConfigPath();
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
        provider: {
          kind: provider.kind,
          model: provider.model,
          ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}),
          ...(provider.apiKey ? { api_key: provider.apiKey } : {}),
          ...(provider.apiKeyEnv ? { api_key_env: provider.apiKeyEnv } : {}),
        },
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
  const provider = payload.provider;
  if (!provider) {
    return null;
  }

  return {
    kind: provider.kind,
    model: provider.model,
    ...(provider.base_url
      ? { baseUrl: provider.base_url }
      : provider.baseUrl
        ? { baseUrl: provider.baseUrl }
        : {}),
    ...(provider.api_key
      ? { apiKey: provider.api_key }
      : provider.apiKey
        ? { apiKey: provider.apiKey }
        : {}),
    ...(provider.api_key_env
      ? { apiKeyEnv: provider.api_key_env }
      : provider.apiKeyEnv
        ? { apiKeyEnv: provider.apiKeyEnv }
        : {}),
  } as ManagedMnaProviderConfig;
}

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  maxTokens?: number | null;
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

export const CONTINUUM_MNA_PROVIDER_API_KEY_ENV = "CONTINUUM_MNA_PROVIDER_API_KEY";

type ManagedMnaProviderSecret = {
  version: 1;
  apiKey?: string;
};

export function continuumManagedEmbeddingConfigPath() {
  return path.join(continuumManagedDir(), "embedding-config.json");
}

export function continuumManagedWritebackLlmConfigPath() {
  return path.join(continuumManagedDir(), "writeback-llm-config.json");
}

export function continuumManagedMemoryLlmConfigPath() {
  return path.join(continuumManagedDir(), "memory-llm-config.json");
}

export function managedMnaProviderConfigPath(mnaHomeDir: string) {
  return path.join(mnaHomeDir, "config.json");
}

export function managedMnaProviderSecretPath(mnaHomeDir: string) {
  return path.join(mnaHomeDir, "provider-secret.json");
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

export async function readManagedMemoryLlmConfig(): Promise<ManagedWritebackLlmConfig | null> {
  const filePath = continuumManagedMemoryLlmConfigPath();
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as ManagedWritebackLlmConfig;
}

export async function writeManagedMemoryLlmConfig(config: ManagedWritebackLlmConfig) {
  const filePath = continuumManagedMemoryLlmConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
}

export async function writeManagedMnaProviderConfig(
  mnaHomeDir: string,
  provider: ManagedMnaProviderConfig,
) {
  const filePath = managedMnaProviderConfigPath(mnaHomeDir);
  const secretPath = managedMnaProviderSecretPath(mnaHomeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        provider: {
          kind: provider.kind,
          model: provider.model,
          ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}),
          ...(provider.apiKey
            ? { api_key_env: CONTINUUM_MNA_PROVIDER_API_KEY_ENV }
            : provider.apiKeyEnv
              ? { api_key_env: provider.apiKeyEnv }
              : {}),
        },
      } satisfies ManagedProviderOverride,
      null,
      2,
    ),
    "utf8",
  );

  if (provider.apiKey) {
    await writeFile(
      secretPath,
      JSON.stringify(
        {
          version: 1,
          apiKey: provider.apiKey,
        } satisfies ManagedMnaProviderSecret,
        null,
        2,
      ),
      "utf8",
    );
    return;
  }

  await rm(secretPath, { force: true }).catch(() => undefined);
}

export async function readManagedMnaProviderConfig(
  mnaHomeDir: string,
): Promise<ManagedMnaProviderConfig | null> {
  const filePath = managedMnaProviderConfigPath(mnaHomeDir);
  const secretPath = managedMnaProviderSecretPath(mnaHomeDir);
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  const payload = JSON.parse(content) as ManagedProviderOverride;
  const secretPayload = (await pathExists(secretPath))
    ? (JSON.parse(await readFile(secretPath, "utf8")) as ManagedMnaProviderSecret)
    : null;
  const provider = payload.provider;
  if (!provider) {
    return null;
  }

  const resolvedApiKey =
    provider.api_key
    || provider.apiKey
    || (
      (
        provider.api_key_env === CONTINUUM_MNA_PROVIDER_API_KEY_ENV
        || provider.apiKeyEnv === CONTINUUM_MNA_PROVIDER_API_KEY_ENV
      )
        ? secretPayload?.apiKey
        : undefined
    );

  const resolvedApiKeyEnv =
    provider.api_key_env && provider.api_key_env !== CONTINUUM_MNA_PROVIDER_API_KEY_ENV
      ? provider.api_key_env
      : provider.apiKeyEnv && provider.apiKeyEnv !== CONTINUUM_MNA_PROVIDER_API_KEY_ENV
        ? provider.apiKeyEnv
        : undefined;

  return {
    kind: provider.kind,
    model: provider.model,
    ...(provider.base_url
      ? { baseUrl: provider.base_url }
      : provider.baseUrl
        ? { baseUrl: provider.baseUrl }
        : {}),
    ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
    ...(resolvedApiKeyEnv ? { apiKeyEnv: resolvedApiKeyEnv } : {}),
  } as ManagedMnaProviderConfig;
}

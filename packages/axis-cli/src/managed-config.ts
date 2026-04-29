import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { axisManagedDir } from "./managed-state.js";
import type { ManagedMnaProviderConfig } from "./mna-provider-config.js";
import { pathExists, safeJsonParse } from "./utils.js";

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

export const AXIS_MNA_PROVIDER_API_KEY_ENV = "AXIS_MNA_PROVIDER_API_KEY";

type ManagedMnaProviderSecret = {
  version: 1;
  apiKey?: string;
};

export function axisManagedEmbeddingConfigPath() {
  return path.join(axisManagedDir(), "embedding-config.json");
}

export function axisManagedWritebackLlmConfigPath() {
  return path.join(axisManagedDir(), "writeback-llm-config.json");
}

export function axisManagedMemoryLlmConfigPath() {
  return path.join(axisManagedDir(), "memory-llm-config.json");
}

export function axisManagedRuntimeConfigPath() {
  return path.join(axisManagedDir(), "runtime-config.json");
}

export function managedMnaProviderConfigPath(mnaHomeDir: string) {
  return path.join(mnaHomeDir, "config.json");
}

export function managedMnaProviderSecretPath(mnaHomeDir: string) {
  return path.join(mnaHomeDir, "provider-secret.json");
}

export async function readManagedEmbeddingConfig(): Promise<ManagedEmbeddingConfig | null> {
  const filePath = axisManagedEmbeddingConfigPath();
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  return safeJsonParse<ManagedEmbeddingConfig>(filePath, content);
}

export async function writeManagedEmbeddingConfig(config: ManagedEmbeddingConfig) {
  const filePath = axisManagedEmbeddingConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
}

export async function readManagedWritebackLlmConfig(): Promise<ManagedWritebackLlmConfig | null> {
  const filePath = axisManagedWritebackLlmConfigPath();
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  return safeJsonParse<ManagedWritebackLlmConfig>(filePath, content);
}

export async function readManagedMemoryLlmConfig(): Promise<ManagedWritebackLlmConfig | null> {
  const filePath = axisManagedMemoryLlmConfigPath();
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  return safeJsonParse<ManagedWritebackLlmConfig>(filePath, content);
}

export async function writeManagedMemoryLlmConfig(config: ManagedWritebackLlmConfig) {
  const filePath = axisManagedMemoryLlmConfigPath();
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
            ? { api_key_env: AXIS_MNA_PROVIDER_API_KEY_ENV }
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
  const payload = safeJsonParse<ManagedProviderOverride>(filePath, content);
  const secretPayload = (await pathExists(secretPath))
    ? safeJsonParse<ManagedMnaProviderSecret>(secretPath, await readFile(secretPath, "utf8"))
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
        provider.api_key_env === AXIS_MNA_PROVIDER_API_KEY_ENV
        || provider.apiKeyEnv === AXIS_MNA_PROVIDER_API_KEY_ENV
      )
        ? secretPayload?.apiKey
        : undefined
    );

  const resolvedApiKeyEnv =
    provider.api_key_env && provider.api_key_env !== AXIS_MNA_PROVIDER_API_KEY_ENV
      ? provider.api_key_env
      : provider.apiKeyEnv && provider.apiKeyEnv !== AXIS_MNA_PROVIDER_API_KEY_ENV
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

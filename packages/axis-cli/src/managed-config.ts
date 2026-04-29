import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { axisManagedDir } from "./managed-state.js";
import { bilingualMessage } from "./messages.js";
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

function readNonEmpty(value: string | boolean | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readEnvNonEmpty(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function ensureHttpUrl(value: string, fieldName: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    // fall through to the shared validation error below
  }

  throw new Error(bilingualMessage(
    `${fieldName} 必须是有效的 http(s) URL。`,
    `${fieldName} must be a valid http(s) URL.`,
  ));
}

function readPositiveInteger(value: string | undefined, fieldName: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(bilingualMessage(
      `${fieldName} 必须是正整数。`,
      `${fieldName} must be a positive integer.`,
    ));
  }
  return parsed;
}

function readProtocol(value: string | undefined, fieldName: string) {
  if (!value) {
    return undefined;
  }
  if (value === "anthropic" || value === "openai-compatible") {
    return value;
  }
  throw new Error(bilingualMessage(
    `${fieldName} 必须是 anthropic 或 openai-compatible。`,
    `${fieldName} must be anthropic or openai-compatible.`,
  ));
}

function readEffort(value: string | undefined, fieldName: string) {
  if (!value) {
    return undefined;
  }
  if (
    value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    || value === "max"
  ) {
    return value;
  }
  throw new Error(bilingualMessage(
    `${fieldName} 必须是 low、medium、high、xhigh 或 max。`,
    `${fieldName} must be low, medium, high, xhigh, or max.`,
  ));
}

export function mergeManagedConfig<T extends Record<string, unknown>>(
  persisted: T | null,
  envDefaults: Partial<T>,
  cliOverrides: Partial<T>,
): T {
  return {
    ...envDefaults,
    ...(persisted ?? {}),
    ...cliOverrides,
  } as T;
}

export function resolveOptionalManagedMemoryLlmEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): Partial<ManagedWritebackLlmConfig> {
  const baseUrl = readEnvNonEmpty(env, "MEMORY_LLM_BASE_URL");
  const model = readEnvNonEmpty(env, "MEMORY_LLM_MODEL");
  const apiKey = readEnvNonEmpty(env, "MEMORY_LLM_API_KEY");
  const protocol = readProtocol(readEnvNonEmpty(env, "MEMORY_LLM_PROTOCOL"), "MEMORY_LLM_PROTOCOL");
  const timeoutMs = readPositiveInteger(readEnvNonEmpty(env, "MEMORY_LLM_TIMEOUT_MS"), "MEMORY_LLM_TIMEOUT_MS");
  const effort = readEffort(readEnvNonEmpty(env, "MEMORY_LLM_EFFORT"), "MEMORY_LLM_EFFORT");
  const maxTokens = readPositiveInteger(readEnvNonEmpty(env, "MEMORY_LLM_MAX_TOKENS"), "MEMORY_LLM_MAX_TOKENS");

  return {
    ...(baseUrl ? { baseUrl: ensureHttpUrl(baseUrl, "MEMORY_LLM_BASE_URL") } : {}),
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(protocol ? { protocol } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(effort ? { effort } : {}),
    ...(maxTokens ? { maxTokens } : {}),
  };
}

export function resolveOptionalManagedMemoryLlmCliConfig(
  options: Record<string, string | boolean>,
): Partial<ManagedWritebackLlmConfig> {
  const baseUrl = readNonEmpty(options["memory-llm-base-url"]);
  const model = readNonEmpty(options["memory-llm-model"]);
  const apiKey = readNonEmpty(options["memory-llm-api-key"]);
  const protocol = readProtocol(readNonEmpty(options["memory-llm-protocol"]), "--memory-llm-protocol");
  const timeoutMs = readPositiveInteger(readNonEmpty(options["memory-llm-timeout-ms"]), "--memory-llm-timeout-ms");
  const effort = readEffort(readNonEmpty(options["memory-llm-effort"]), "--memory-llm-effort");
  const maxTokens = readPositiveInteger(readNonEmpty(options["memory-llm-max-tokens"]), "--memory-llm-max-tokens");

  return {
    ...(baseUrl ? { baseUrl: ensureHttpUrl(baseUrl, "--memory-llm-base-url") } : {}),
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(protocol ? { protocol } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(effort ? { effort } : {}),
    ...(maxTokens ? { maxTokens } : {}),
  };
}

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

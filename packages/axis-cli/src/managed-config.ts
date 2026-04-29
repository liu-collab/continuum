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

type LegacyManagedProviderFile = ManagedProviderOverride & {
  tools?: Record<string, unknown>;
  planning?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
};

type ManagedUnifiedConfig = {
  version: 2;
  provider?: ManagedProviderOverride["provider"];
  embedding?: Omit<ManagedEmbeddingConfig, "version" | "apiKey">;
  memory_llm?: Omit<ManagedWritebackLlmConfig, "version" | "apiKey">;
  governance?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  planning?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
};

type ManagedUnifiedSecrets = {
  version: 2;
  provider_api_key?: string;
  embedding_api_key?: string;
  memory_llm_api_key?: string;
};

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

export function axisManagedConfigPath() {
  return path.join(axisManagedDir(), "config.json");
}

export function axisManagedSecretsPath() {
  return path.join(axisManagedDir(), "secrets.json");
}

export function managedMnaProviderConfigPath(mnaHomeDir: string) {
  return path.join(mnaHomeDir, "config.json");
}

export function managedMnaProviderSecretPath(mnaHomeDir: string) {
  return path.join(mnaHomeDir, "provider-secret.json");
}

function defaultManagedMnaHomeDir() {
  return path.join(axisManagedDir(), "mna");
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return safeJsonParse<T>(filePath, await readFile(filePath, "utf8"));
}

function splitEmbeddingConfig(config: ManagedEmbeddingConfig | null): {
  config?: ManagedUnifiedConfig["embedding"];
  apiKey?: string;
} {
  if (!config) {
    return {};
  }

  return {
    config: {
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      ...(config.model ? { model: config.model } : {}),
    },
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  };
}

function splitMemoryLlmConfig(config: ManagedWritebackLlmConfig | null): {
  config?: ManagedUnifiedConfig["memory_llm"];
  apiKey?: string;
} {
  if (!config) {
    return {};
  }

  return {
    config: {
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      ...(config.model ? { model: config.model } : {}),
      ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
      ...(config.protocol ? { protocol: config.protocol } : {}),
      ...(config.effort !== undefined ? { effort: config.effort } : {}),
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    },
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  };
}

function normalizeProviderForConfig(provider: ManagedProviderOverride["provider"]) {
  const apiKeyEnv = provider.api_key_env ?? provider.apiKeyEnv;
  return {
    kind: provider.kind,
    model: provider.model,
    ...(provider.base_url
      ? { base_url: provider.base_url }
      : provider.baseUrl
        ? { base_url: provider.baseUrl }
        : {}),
    ...(apiKeyEnv ? { api_key_env: apiKeyEnv } : {}),
  };
}

async function readUnifiedConfig(): Promise<ManagedUnifiedConfig> {
  return (await readJsonIfExists<ManagedUnifiedConfig>(axisManagedConfigPath())) ?? { version: 2 };
}

async function readUnifiedSecrets(): Promise<ManagedUnifiedSecrets> {
  return (await readJsonIfExists<ManagedUnifiedSecrets>(axisManagedSecretsPath())) ?? { version: 2 };
}

async function writeUnifiedConfig(config: ManagedUnifiedConfig) {
  const filePath = axisManagedConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ ...config, version: 2 }, null, 2), "utf8");
}

async function writeUnifiedSecrets(secrets: ManagedUnifiedSecrets) {
  const filePath = axisManagedSecretsPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ ...secrets, version: 2 }, null, 2), "utf8");
}

export async function migrateManagedConfigFiles(mnaHomeDir = defaultManagedMnaHomeDir()) {
  const legacyProviderPath = managedMnaProviderConfigPath(mnaHomeDir);
  const legacyProviderSecretPath = managedMnaProviderSecretPath(mnaHomeDir);
  const legacyEmbeddingPath = axisManagedEmbeddingConfigPath();
  const legacyMemoryLlmPath = axisManagedMemoryLlmConfigPath();
  const legacyWritebackLlmPath = axisManagedWritebackLlmConfigPath();
  const legacyRuntimePath = axisManagedRuntimeConfigPath();
  const legacyFiles = [
    legacyProviderPath,
    legacyProviderSecretPath,
    legacyEmbeddingPath,
    legacyMemoryLlmPath,
    legacyWritebackLlmPath,
    legacyRuntimePath,
  ];

  const legacyExists = await Promise.all(legacyFiles.map((filePath) => pathExists(filePath)));
  if (!legacyExists.some(Boolean)) {
    return;
  }

  const unified = await readUnifiedConfig();
  const secrets = await readUnifiedSecrets();
  const legacyProvider = await readJsonIfExists<LegacyManagedProviderFile>(legacyProviderPath);
  const legacyProviderSecret = await readJsonIfExists<ManagedMnaProviderSecret>(legacyProviderSecretPath);
  const legacyEmbedding = await readJsonIfExists<ManagedEmbeddingConfig>(legacyEmbeddingPath);
  const legacyMemoryLlm = await readJsonIfExists<ManagedWritebackLlmConfig>(legacyMemoryLlmPath);
  const legacyWritebackLlm = await readJsonIfExists<ManagedWritebackLlmConfig>(legacyWritebackLlmPath);
  const legacyRuntime = await readJsonIfExists<Record<string, unknown>>(legacyRuntimePath);

  if (legacyProvider?.provider) {
    const provider = legacyProvider.provider;
    const providerApiKey =
      provider.api_key
      ?? provider.apiKey
      ?? (
        provider.api_key_env === AXIS_MNA_PROVIDER_API_KEY_ENV
        || provider.apiKeyEnv === AXIS_MNA_PROVIDER_API_KEY_ENV
          ? legacyProviderSecret?.apiKey
          : undefined
      );
    unified.provider = normalizeProviderForConfig(provider);
    if (providerApiKey) {
      secrets.provider_api_key = providerApiKey;
      delete unified.provider.api_key_env;
    }
    if (legacyProvider.tools) {
      unified.tools = legacyProvider.tools;
    }
    if (legacyProvider.planning) {
      unified.planning = legacyProvider.planning;
    }
    if (legacyProvider.mcp) {
      unified.mcp = legacyProvider.mcp;
    }
  }

  const embedding = splitEmbeddingConfig(legacyEmbedding);
  if (embedding.config) {
    unified.embedding = embedding.config;
  }
  if (embedding.apiKey) {
    secrets.embedding_api_key = embedding.apiKey;
  }

  const memoryLlm = splitMemoryLlmConfig(legacyMemoryLlm ?? legacyWritebackLlm);
  if (memoryLlm.config) {
    unified.memory_llm = memoryLlm.config;
  }
  if (memoryLlm.apiKey) {
    secrets.memory_llm_api_key = memoryLlm.apiKey;
  }

  if (legacyRuntime) {
    const { version: _version, ...governance } = legacyRuntime;
    if (Object.keys(governance).length > 0) {
      unified.governance = governance;
    }
  }

  await writeUnifiedConfig(unified);
  await writeUnifiedSecrets(secrets);
  await Promise.all(legacyFiles.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)));
}

export async function readManagedEmbeddingConfig(): Promise<ManagedEmbeddingConfig | null> {
  await migrateManagedConfigFiles();
  const unified = await readUnifiedConfig();
  const secrets = await readUnifiedSecrets();
  if (!unified.embedding) {
    return null;
  }

  return {
    version: 1,
    ...unified.embedding,
    ...(secrets.embedding_api_key ? { apiKey: secrets.embedding_api_key } : {}),
  };
}

export async function writeManagedEmbeddingConfig(config: ManagedEmbeddingConfig) {
  await migrateManagedConfigFiles();
  const unified = await readUnifiedConfig();
  const secrets = await readUnifiedSecrets();
  const split = splitEmbeddingConfig(config);
  unified.embedding = split.config ?? {};
  if (split.apiKey) {
    secrets.embedding_api_key = split.apiKey;
  } else {
    delete secrets.embedding_api_key;
  }
  await writeUnifiedConfig(unified);
  await writeUnifiedSecrets(secrets);
}

export async function readManagedMemoryLlmConfig(): Promise<ManagedWritebackLlmConfig | null> {
  await migrateManagedConfigFiles();
  const unified = await readUnifiedConfig();
  const secrets = await readUnifiedSecrets();
  if (!unified.memory_llm) {
    return null;
  }

  return {
    version: 1,
    ...unified.memory_llm,
    ...(secrets.memory_llm_api_key ? { apiKey: secrets.memory_llm_api_key } : {}),
  };
}

export async function writeManagedMemoryLlmConfig(config: ManagedWritebackLlmConfig) {
  await migrateManagedConfigFiles();
  const unified = await readUnifiedConfig();
  const secrets = await readUnifiedSecrets();
  const split = splitMemoryLlmConfig(config);
  unified.memory_llm = split.config ?? {};
  if (split.apiKey) {
    secrets.memory_llm_api_key = split.apiKey;
  } else {
    delete secrets.memory_llm_api_key;
  }
  await writeUnifiedConfig(unified);
  await writeUnifiedSecrets(secrets);
}

export async function writeManagedMnaProviderConfig(
  mnaHomeDir: string,
  provider: ManagedMnaProviderConfig,
) {
  await migrateManagedConfigFiles(mnaHomeDir);
  const unified = await readUnifiedConfig();
  const secrets = await readUnifiedSecrets();
  unified.provider = {
    kind: provider.kind,
    model: provider.model,
    ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}),
    ...(provider.apiKeyEnv ? { api_key_env: provider.apiKeyEnv } : {}),
  };

  if (provider.apiKey) {
    secrets.provider_api_key = provider.apiKey;
    delete unified.provider.api_key_env;
  } else {
    delete secrets.provider_api_key;
  }

  await writeUnifiedConfig(unified);
  await writeUnifiedSecrets(secrets);
  await rm(managedMnaProviderConfigPath(mnaHomeDir), { force: true }).catch(() => undefined);
  await rm(managedMnaProviderSecretPath(mnaHomeDir), { force: true }).catch(() => undefined);
}

export async function readManagedMnaProviderConfig(
  mnaHomeDir: string,
): Promise<ManagedMnaProviderConfig | null> {
  await migrateManagedConfigFiles(mnaHomeDir);
  const unified = await readUnifiedConfig();
  const secrets = await readUnifiedSecrets();
  const provider = unified.provider;
  if (!provider) {
    return null;
  }
  const kind = String(provider.kind);
  if (!["openai-compatible", "anthropic", "ollama"].includes(kind)) {
    return null;
  }

  const resolvedApiKey =
    provider.api_key
    || provider.apiKey
    || secrets.provider_api_key;

  const resolvedApiKeyEnv =
    provider.api_key_env && provider.api_key_env !== AXIS_MNA_PROVIDER_API_KEY_ENV
      ? provider.api_key_env
      : provider.apiKeyEnv && provider.apiKeyEnv !== AXIS_MNA_PROVIDER_API_KEY_ENV
        ? provider.apiKeyEnv
        : undefined;

  return {
    kind,
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

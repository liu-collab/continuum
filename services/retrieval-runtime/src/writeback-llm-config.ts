import os from "node:os";
import path from "node:path";

import {
  type ConfigFieldReaders,
  type ConfigSourceFieldMap,
  mapConfigSourceFields,
  normalizeHttpConfigUrl,
  readJsonConfigFile,
  readLayeredConfigFields,
  readOptionalConfigString,
  readOptionalConfigPositiveInteger,
} from "./config-file.js";

type WritebackLlmConfigSource = {
  MEMORY_LLM_BASE_URL?: string;
  MEMORY_LLM_MODEL?: string;
  MEMORY_LLM_API_KEY?: string;
  MEMORY_LLM_TIMEOUT_MS?: number | string;
  MEMORY_LLM_PROTOCOL?: string;
  MEMORY_LLM_EFFORT?: string;
  MEMORY_LLM_MAX_TOKENS?: number | string;
  AXIS_MEMORY_LLM_CONFIG_PATH?: string;
  AXIS_MANAGED_CONFIG_PATH?: string;
  AXIS_MANAGED_SECRETS_PATH?: string;
};

export type RuntimeWritebackLlmProtocol = "anthropic" | "openai-compatible" | "openai-responses" | "ollama";

export type RuntimeWritebackLlmConfig = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  protocol?: RuntimeWritebackLlmProtocol;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  maxTokens?: number | null;
};

function normalizeProtocol(value: unknown): RuntimeWritebackLlmProtocol | undefined {
  const configValue = readOptionalConfigString(value);
  if (!configValue) {
    return undefined;
  }

  const normalized = configValue.toLowerCase();
  if (
    normalized === "anthropic"
    || normalized === "openai-compatible"
    || normalized === "openai-responses"
    || normalized === "ollama"
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeEffort(value: unknown): RuntimeWritebackLlmConfig["effort"] | undefined {
  const configValue = readOptionalConfigString(value);
  if (!configValue) {
    return undefined;
  }

  const normalized = configValue.toLowerCase();
  if (
    normalized === "low"
    || normalized === "medium"
    || normalized === "high"
    || normalized === "xhigh"
    || normalized === "max"
  ) {
    return normalized;
  }

  return undefined;
}

const writebackLlmConfigReaders: ConfigFieldReaders<RuntimeWritebackLlmConfig> = {
  baseUrl: normalizeHttpConfigUrl,
  model: readOptionalConfigString,
  apiKey: readOptionalConfigString,
  timeoutMs: readOptionalConfigPositiveInteger,
  protocol: normalizeProtocol,
  effort: (value) => value === null ? null : normalizeEffort(value),
  maxTokens: (value) => value === null ? null : readOptionalConfigPositiveInteger(value),
};

const writebackLlmConfigFieldMap: ConfigSourceFieldMap<
  RuntimeWritebackLlmConfig,
  WritebackLlmConfigSource
> = {
  baseUrl: "MEMORY_LLM_BASE_URL",
  model: "MEMORY_LLM_MODEL",
  apiKey: "MEMORY_LLM_API_KEY",
  timeoutMs: "MEMORY_LLM_TIMEOUT_MS",
  protocol: "MEMORY_LLM_PROTOCOL",
  effort: "MEMORY_LLM_EFFORT",
  maxTokens: "MEMORY_LLM_MAX_TOKENS",
};

function resolveManagedConfigPath(source: WritebackLlmConfigSource) {
  return readOptionalConfigString(source.AXIS_MANAGED_CONFIG_PATH)
    ?? path.join(os.homedir(), ".axis", "managed", "config.json");
}

function resolveManagedSecretsPath(source: WritebackLlmConfigSource) {
  return readOptionalConfigString(source.AXIS_MANAGED_SECRETS_PATH)
    ?? path.join(os.homedir(), ".axis", "managed", "secrets.json");
}

function readUnifiedMemoryLlmConfig(source: WritebackLlmConfigSource) {
  const managedConfig = readJsonConfigFile<{
    memory_llm?: {
      baseUrl?: string;
      model?: string;
      timeoutMs?: number;
      protocol?: RuntimeWritebackLlmProtocol;
      effort?: RuntimeWritebackLlmConfig["effort"];
      maxTokens?: number | null;
    };
  }>(resolveManagedConfigPath(source));
  const managedSecrets = readJsonConfigFile<{
    memory_llm_api_key?: string;
  }>(resolveManagedSecretsPath(source));

  return {
    ...(managedConfig?.memory_llm ?? {}),
    ...(managedSecrets?.memory_llm_api_key ? { apiKey: managedSecrets.memory_llm_api_key } : {}),
  };
}

export function resolveRuntimeWritebackLlmConfig(
  source: WritebackLlmConfigSource,
): RuntimeWritebackLlmConfig {
  return readLayeredConfigFields<RuntimeWritebackLlmConfig>(
    [
      mapConfigSourceFields<RuntimeWritebackLlmConfig, WritebackLlmConfigSource>(source, writebackLlmConfigFieldMap),
      readJsonConfigFile(source.AXIS_MEMORY_LLM_CONFIG_PATH),
      readUnifiedMemoryLlmConfig(source),
    ],
    writebackLlmConfigReaders,
  );
}

export function hasCompleteRuntimeWritebackLlmConfig(source: WritebackLlmConfigSource) {
  const config = resolveRuntimeWritebackLlmConfig(source);
  return Boolean(config.baseUrl && config.model);
}

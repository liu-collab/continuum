import os from "node:os";
import path from "node:path";

import {
  type ConfigFieldReaders,
  type ConfigSourceFieldMap,
  mapLoopbackHttpConfigUrlForRuntime,
  mapConfigSourceFields,
  normalizeHttpConfigUrl,
  readJsonConfigFile,
  readLayeredConfigFields,
  readOptionalConfigString,
} from "./config-file.js";

type EmbeddingConfigSource = {
  EMBEDDING_BASE_URL?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_API_KEY?: string;
  AXIS_EMBEDDING_CONFIG_PATH?: string;
  AXIS_MANAGED_CONFIG_PATH?: string;
  AXIS_MANAGED_SECRETS_PATH?: string;
  AXIS_RUNTIME_CONTAINER?: string | boolean;
  AXIS_RUNTIME_LOCALHOST_HOST?: string;
};

export type RuntimeEmbeddingConfig = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

const embeddingConfigReaders: ConfigFieldReaders<RuntimeEmbeddingConfig> = {
  baseUrl: normalizeHttpConfigUrl,
  model: readOptionalConfigString,
  apiKey: readOptionalConfigString,
};

const embeddingConfigFieldMap: ConfigSourceFieldMap<RuntimeEmbeddingConfig, EmbeddingConfigSource> = {
  baseUrl: "EMBEDDING_BASE_URL",
  model: "EMBEDDING_MODEL",
  apiKey: "EMBEDDING_API_KEY",
};

function resolveManagedConfigPath(source: EmbeddingConfigSource) {
  return readOptionalConfigString(source.AXIS_MANAGED_CONFIG_PATH)
    ?? path.join(os.homedir(), ".axis", "managed", "config.json");
}

function resolveManagedSecretsPath(source: EmbeddingConfigSource) {
  return readOptionalConfigString(source.AXIS_MANAGED_SECRETS_PATH)
    ?? path.join(os.homedir(), ".axis", "managed", "secrets.json");
}

function readUnifiedEmbeddingConfig(source: EmbeddingConfigSource) {
  const managedConfig = readJsonConfigFile<{
    embedding?: {
      baseUrl?: string;
      model?: string;
    };
  }>(resolveManagedConfigPath(source));
  const managedSecrets = readJsonConfigFile<{
    embedding_api_key?: string;
  }>(resolveManagedSecretsPath(source));

  return {
    ...(managedConfig?.embedding ?? {}),
    ...(managedSecrets?.embedding_api_key ? { apiKey: managedSecrets.embedding_api_key } : {}),
  };
}

function mapRuntimeLoopbackUrls(
  config: Partial<RuntimeEmbeddingConfig> | undefined,
  source: EmbeddingConfigSource,
): Partial<RuntimeEmbeddingConfig> {
  if (!config) {
    return {};
  }

  return {
    ...config,
    ...(config.baseUrl
      ? { baseUrl: mapLoopbackHttpConfigUrlForRuntime(config.baseUrl, source) }
      : {}),
  };
}

export function resolveRuntimeEmbeddingConfig(source: EmbeddingConfigSource): RuntimeEmbeddingConfig {
  return readLayeredConfigFields<RuntimeEmbeddingConfig>(
    [
      mapRuntimeLoopbackUrls(
        mapConfigSourceFields<RuntimeEmbeddingConfig, EmbeddingConfigSource>(source, embeddingConfigFieldMap),
        source,
      ),
      mapRuntimeLoopbackUrls(readJsonConfigFile(source.AXIS_EMBEDDING_CONFIG_PATH), source),
      mapRuntimeLoopbackUrls(readUnifiedEmbeddingConfig(source), source),
    ],
    embeddingConfigReaders,
  );
}

export function hasCompleteRuntimeEmbeddingConfig(source: EmbeddingConfigSource) {
  const config = resolveRuntimeEmbeddingConfig(source);
  return Boolean(config.baseUrl && config.model && config.apiKey);
}

import {
  type ConfigFieldReaders,
  type ConfigSourceFieldMap,
  normalizeHttpConfigUrl,
  readLayeredMappedJsonConfigFields,
  readOptionalConfigString,
} from "./config-file.js";

type EmbeddingConfigSource = {
  EMBEDDING_BASE_URL?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_API_KEY?: string;
  CONTINUUM_EMBEDDING_CONFIG_PATH?: string;
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

export function resolveRuntimeEmbeddingConfig(source: EmbeddingConfigSource): RuntimeEmbeddingConfig {
  return readLayeredMappedJsonConfigFields<RuntimeEmbeddingConfig, EmbeddingConfigSource>(
    source,
    embeddingConfigFieldMap,
    source.CONTINUUM_EMBEDDING_CONFIG_PATH,
    embeddingConfigReaders,
  );
}

export function hasCompleteRuntimeEmbeddingConfig(source: EmbeddingConfigSource) {
  const config = resolveRuntimeEmbeddingConfig(source);
  return Boolean(config.baseUrl && config.model);
}

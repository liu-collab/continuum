import fs from "node:fs";

type EmbeddingConfigSource = {
  embedding_base_url?: string | undefined;
  embedding_model?: string | undefined;
  embedding_api_key?: string | undefined;
  axis_embedding_config_path?: string | undefined;
};

export type StorageEmbeddingConfig = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

function readNonEmpty(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function readManagedEmbeddingConfig(filePath: string | undefined): StorageEmbeddingConfig {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };

    const baseUrl = normalizeUrl(readNonEmpty(payload.baseUrl));
    const model = readNonEmpty(payload.model);
    const apiKey = readNonEmpty(payload.apiKey);

    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
      ...(apiKey ? { apiKey } : {}),
    };
  } catch {
    return {};
  }
}

export function resolveStorageEmbeddingConfig(source: EmbeddingConfigSource): StorageEmbeddingConfig {
  const envBaseUrl = normalizeUrl(readNonEmpty(source.embedding_base_url));
  const envModel = readNonEmpty(source.embedding_model);
  const envApiKey = readNonEmpty(source.embedding_api_key);

  return {
    ...(envBaseUrl ? { baseUrl: envBaseUrl } : {}),
    ...(envModel ? { model: envModel } : {}),
    ...(envApiKey ? { apiKey: envApiKey } : {}),
    ...readManagedEmbeddingConfig(readNonEmpty(source.axis_embedding_config_path)),
  };
}

export function hasCompleteStorageEmbeddingConfig(source: EmbeddingConfigSource) {
  const config = resolveStorageEmbeddingConfig(source);
  return Boolean(config.baseUrl && config.model);
}

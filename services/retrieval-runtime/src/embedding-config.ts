import fs from "node:fs";

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

function readManagedEmbeddingConfig(filePath: string | undefined): RuntimeEmbeddingConfig {
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

export function resolveRuntimeEmbeddingConfig(source: EmbeddingConfigSource): RuntimeEmbeddingConfig {
  const envBaseUrl = normalizeUrl(readNonEmpty(source.EMBEDDING_BASE_URL));
  const envModel = readNonEmpty(source.EMBEDDING_MODEL);
  const envApiKey = readNonEmpty(source.EMBEDDING_API_KEY);

  return {
    ...(envBaseUrl ? { baseUrl: envBaseUrl } : {}),
    ...(envModel ? { model: envModel } : {}),
    ...(envApiKey ? { apiKey: envApiKey } : {}),
    ...readManagedEmbeddingConfig(readNonEmpty(source.CONTINUUM_EMBEDDING_CONFIG_PATH)),
  };
}

export function hasCompleteRuntimeEmbeddingConfig(source: EmbeddingConfigSource) {
  const config = resolveRuntimeEmbeddingConfig(source);
  return Boolean(config.baseUrl && config.model);
}

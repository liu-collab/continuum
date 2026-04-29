import process from "node:process";

import { bilingualMessage } from "./messages.js";

export type ThirdPartyEmbeddingConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type PartialThirdPartyEmbeddingConfig = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

function readNonEmpty(value: string | boolean | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function ensureUrl(value: string, fieldName: string) {
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

export function resolveThirdPartyEmbeddingConfig(
  options: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv = process.env,
): ThirdPartyEmbeddingConfig {
  const partial = resolveOptionalThirdPartyEmbeddingConfig(options, env);
  const baseUrl = partial.baseUrl;
  const model = partial.model;
  const apiKey = partial.apiKey;

  if (!baseUrl || !model) {
    throw new Error(
      bilingualMessage(
        "axis start 需要第三方 embedding 配置。请提供 EMBEDDING_BASE_URL 和 EMBEDDING_MODEL，或使用 --embedding-base-url / --embedding-model 传入。",
        "axis start requires third-party embedding configuration. Provide EMBEDDING_BASE_URL and EMBEDDING_MODEL, or pass --embedding-base-url / --embedding-model.",
      ),
    );
  }

  return {
    baseUrl: ensureUrl(baseUrl, "EMBEDDING_BASE_URL"),
    model,
    ...(apiKey ? { apiKey } : {}),
  };
}

export function resolveOptionalThirdPartyEmbeddingConfig(
  options: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv = process.env,
): PartialThirdPartyEmbeddingConfig {
  const baseUrl = readNonEmpty(options["embedding-base-url"]) ?? readNonEmpty(env.EMBEDDING_BASE_URL);
  const model = readNonEmpty(options["embedding-model"]) ?? readNonEmpty(env.EMBEDDING_MODEL);
  const apiKey = readNonEmpty(options["embedding-api-key"]) ?? readNonEmpty(env.EMBEDDING_API_KEY);

  return {
    ...(baseUrl ? { baseUrl: ensureUrl(baseUrl, "EMBEDDING_BASE_URL") } : {}),
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

export function buildEmbeddingsEndpoint(baseUrl: string) {
  return new URL("./embeddings", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

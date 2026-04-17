import process from "node:process";

export type ThirdPartyEmbeddingConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
};

function readNonEmpty(value: string | boolean | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function ensureUrl(value: string, fieldName: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`${fieldName} 必须是有效的 http(s) URL。`);
  }
}

export function resolveThirdPartyEmbeddingConfig(
  options: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv = process.env,
): ThirdPartyEmbeddingConfig {
  const baseUrl = readNonEmpty(options["embedding-base-url"]) ?? readNonEmpty(env.EMBEDDING_BASE_URL);
  const model = readNonEmpty(options["embedding-model"]) ?? readNonEmpty(env.EMBEDDING_MODEL);
  const apiKey = readNonEmpty(options["embedding-api-key"]) ?? readNonEmpty(env.EMBEDDING_API_KEY);

  if (!baseUrl || !model) {
    throw new Error(
      "continuum start 需要第三方 embedding 配置。请提供 EMBEDDING_BASE_URL 和 EMBEDDING_MODEL，或使用 --embedding-base-url / --embedding-model 传入。",
    );
  }

  return {
    baseUrl: ensureUrl(baseUrl, "EMBEDDING_BASE_URL"),
    model,
    ...(apiKey ? { apiKey } : {}),
  };
}

export function buildEmbeddingsEndpoint(baseUrl: string) {
  return new URL("./embeddings", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

import type { AppConfig } from "../config.js";
import {
  hasCompleteRuntimeEmbeddingConfig,
  resolveRuntimeEmbeddingConfig,
} from "../embedding-config.js";

export interface EmbeddingsClient {
  embedText(text: string, signal?: AbortSignal): Promise<number[]>;
}

export class HttpEmbeddingsClient implements EmbeddingsClient {
  constructor(private readonly config: AppConfig) {}

  isConfigured() {
    return hasCompleteRuntimeEmbeddingConfig(this.config);
  }

  async embedText(text: string, signal?: AbortSignal): Promise<number[]> {
    const activeConfig = resolveRuntimeEmbeddingConfig(this.config);
    if (!activeConfig.baseUrl || !activeConfig.model) {
      throw new Error("embedding config is not complete");
    }

    const response = await fetch(this.buildEmbeddingsUrl(activeConfig.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(activeConfig.apiKey ? { authorization: `Bearer ${activeConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: activeConfig.model,
        input: text,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`embeddings request failed with ${response.status}`);
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = payload.data?.[0]?.embedding;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("embeddings response did not include an embedding vector");
    }

    return embedding;
  }

  private buildEmbeddingsUrl(baseUrl: string) {
    return new URL("./embeddings", `${baseUrl.replace(/\/+$/, "")}/`);
  }
}

import type { StorageConfig } from "../config.js";
import {
  hasCompleteStorageEmbeddingConfig,
  resolveStorageEmbeddingConfig,
} from "../embedding-config.js";

export interface EmbeddingsClient {
  embedText(text: string, signal?: AbortSignal): Promise<number[]>;
  embedTexts?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  isConfigured?(): boolean;
}

export class HttpEmbeddingsClient implements EmbeddingsClient {
  constructor(private readonly config: StorageConfig) {}

  isConfigured() {
    return hasCompleteStorageEmbeddingConfig(this.config);
  }

  async embedText(text: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embedTexts([text], signal);
    if (!embedding) {
      throw new Error("embeddings response did not include an embedding vector");
    }

    return embedding;
  }

  async embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const activeConfig = resolveStorageEmbeddingConfig(this.config);
    if (!activeConfig.baseUrl || !activeConfig.model) {
      throw new Error("embedding config is not complete");
    }

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(activeConfig.apiKey
          ? { authorization: `Bearer ${activeConfig.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: activeConfig.model,
        input: texts,
      }),
    };

    if (signal) {
      requestInit.signal = signal;
    }

    const response = await fetch(this.buildEmbeddingsUrl(activeConfig.baseUrl), requestInit);

    if (!response.ok) {
      throw new Error(`embeddings request failed with ${response.status}`);
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const embeddings =
      payload.data?.map((item) => item.embedding).filter((item): item is number[] => Array.isArray(item)) ?? [];

    if (embeddings.length !== texts.length) {
      throw new Error("embeddings response did not include an embedding vector");
    }

    return embeddings.map((embedding) => embedding.map((item) => Number(item)));
  }

  private buildEmbeddingsUrl(baseUrl: string) {
    return new URL("./embeddings", `${baseUrl.replace(/\/+$/, "")}/`);
  }
}

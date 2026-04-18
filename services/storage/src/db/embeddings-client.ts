import type { StorageConfig } from "../config.js";

export interface EmbeddingsClient {
  embedText(text: string, signal?: AbortSignal): Promise<number[]>;
  embedTexts?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export class HttpEmbeddingsClient implements EmbeddingsClient {
  constructor(private readonly config: StorageConfig) {}

  async embedText(text: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embedTexts([text], signal);
    if (!embedding) {
      throw new Error("embeddings response did not include an embedding vector");
    }

    return embedding;
  }

  async embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.embedding_base_url) {
      throw new Error("embedding base url is not configured");
    }

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.embedding_api_key
          ? { authorization: `Bearer ${this.config.embedding_api_key}` }
          : {}),
      },
      body: JSON.stringify({
        model: this.config.embedding_model,
        input: texts,
      }),
    };

    if (signal) {
      requestInit.signal = signal;
    }

    const response = await fetch(this.buildEmbeddingsUrl(), requestInit);

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

  private buildEmbeddingsUrl() {
    return new URL("./embeddings", `${this.config.embedding_base_url!.replace(/\/+$/, "")}/`);
  }
}

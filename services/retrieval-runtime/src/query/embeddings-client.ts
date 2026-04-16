import type { AppConfig } from "../config.js";

export interface EmbeddingsClient {
  embedText(text: string, signal?: AbortSignal): Promise<number[]>;
}

export class HttpEmbeddingsClient implements EmbeddingsClient {
  constructor(private readonly config: AppConfig) {}

  async embedText(text: string, signal?: AbortSignal): Promise<number[]> {
    const response = await fetch(new URL("/embeddings", this.config.EMBEDDING_BASE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.EMBEDDING_API_KEY ? { authorization: `Bearer ${this.config.EMBEDDING_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: this.config.EMBEDDING_MODEL,
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
}

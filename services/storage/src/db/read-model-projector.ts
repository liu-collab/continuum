import type { MemoryRecord, ReadModelEntry } from "../contracts.js";
import type { ReadModelRepository } from "./repositories.js";
import type { EmbeddingsClient } from "./embeddings-client.js";

export class ReadModelProjector {
  constructor(
    private readonly repository: ReadModelRepository,
    private readonly embeddingsClient?: EmbeddingsClient,
  ) {}

  async project(record: MemoryRecord) {
    if (record.status === "deleted") {
      await this.repository.delete(record.id);
      return {
        embedding_updated: false,
        degradation_reason: undefined,
      };
    }

    const embeddingResult = await this.generateEmbedding(record.summary);

    const entry: ReadModelEntry = {
      id: record.id,
      workspace_id: record.workspace_id,
      user_id: record.user_id,
      task_id: record.task_id,
      session_id: record.session_id,
      memory_type: record.memory_type,
      scope: record.scope,
      status: record.status,
      summary: record.summary,
      details: record.details_json,
      importance: record.importance,
      confidence: record.confidence,
      source: {
        source_type: record.source_type,
        source_ref: record.source_ref,
        service_name: record.created_by_service,
        origin_workspace_id: record.workspace_id,
        confirmed_by_user: Boolean(record.last_confirmed_at),
      },
      last_confirmed_at: record.last_confirmed_at,
      last_used_at: null,
      created_at: record.created_at,
      updated_at: record.updated_at,
      summary_embedding: embeddingResult.embedding,
      embedding_status: embeddingResult.embedding ? "ok" : "pending",
      embedding_attempted_at: new Date().toISOString(),
      embedding_attempt_count: 1,
    };

    await this.repository.upsert(entry);
    return {
      embedding_updated: Boolean(embeddingResult.embedding),
      degradation_reason: embeddingResult.degradation_reason,
    };
  }

  async refreshPendingEmbeddings(limit: number) {
    if (!this.embeddingsClient?.embedTexts) {
      return 0;
    }

    const entries = await this.repository.listPendingEmbeddings(limit);
    if (entries.length === 0) {
      return 0;
    }

    try {
      const embeddings = await this.embeddingsClient.embedTexts(entries.map((entry) => entry.summary));
      await Promise.all(
        entries.map((entry, index) =>
          this.repository.upsert({
            ...entry,
            summary_embedding: embeddings[index] ?? null,
            embedding_status: embeddings[index] ? "ok" : "failed",
            embedding_attempted_at: new Date().toISOString(),
            embedding_attempt_count: (entry.embedding_attempt_count ?? 0) + 1,
          }),
        ),
      );
      return entries.length;
    } catch {
      await Promise.all(
        entries.map((entry) =>
          this.repository.upsert({
            ...entry,
            embedding_status: "pending",
            embedding_attempted_at: new Date().toISOString(),
            embedding_attempt_count: (entry.embedding_attempt_count ?? 0) + 1,
          }),
        ),
      );
      return 0;
    }
  }

  private async generateEmbedding(summary: string) {
    if (!this.embeddingsClient) {
      return {
        embedding: null,
        degradation_reason: "embedding_unavailable",
      };
    }

    try {
      return {
        embedding: await this.embeddingsClient.embedText(summary),
        degradation_reason: undefined,
      };
    } catch {
      return {
        embedding: null,
        degradation_reason: "embedding_unavailable",
      };
    }
  }
}

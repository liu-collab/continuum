import { createHash } from "node:crypto";

import type {
  ArchiveRecordInput,
  RecordPatchInput,
  ResolveConflictInput,
  RestoreVersionInput,
  RuntimeWriteBackBatchRequest,
  SubmittedWriteBackJob,
  WriteBackCandidate,
} from "./contracts.js";
import type { StorageConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { StorageDatabase } from "./db/client.js";
import type { EmbeddingsClient } from "./db/embeddings-client.js";
import { normalizeCandidate } from "./domain/normalizer.js";
import { GovernanceEngine } from "./domain/governance-engine.js";
import { createRepositories, type StorageRepositories } from "./db/repositories.js";
import { JobWorker } from "./jobs/job-worker.js";

export interface DependencyStatus {
  name: string;
  status: "healthy" | "unavailable" | "not_configured";
  message: string | undefined;
}

export interface LivenessStatus {
  status: "alive";
}

export interface ReadinessStatus {
  status: "ready" | "not_ready";
  reason?: string;
}

export interface DependenciesReport {
  dependencies: DependencyStatus[];
}

export interface RecordListFilters {
  workspace_id?: string | undefined;
  user_id?: string | undefined;
  task_id?: string | undefined;
  memory_type?: string | undefined;
  scope?: string | undefined;
  status?: string | undefined;
  limit: number;
}

export class StorageService {
  private readonly governance: GovernanceEngine;
  private readonly worker: JobWorker;
  private readonly embeddingsClient: EmbeddingsClient | undefined;

  constructor(
    readonly repositories: StorageRepositories,
    private readonly logger: Logger,
    private readonly config: StorageConfig,
    private readonly database?: StorageDatabase,
    embeddingsClient?: EmbeddingsClient,
  ) {
    this.governance = new GovernanceEngine(repositories);
    this.embeddingsClient = embeddingsClient;
    this.worker = new JobWorker(repositories, logger, {
      batch_size: config.write_job_batch_size,
      max_retries: config.write_job_max_retries,
      read_model_refresh_max_retries: config.read_model_refresh_max_retries,
    }, embeddingsClient);
  }

  async submitWriteBackCandidate(candidate: WriteBackCandidate) {
    const normalized = normalizeCandidate(candidate);
    const idempotencyKey =
      candidate.idempotency_key ??
      createHash("sha256")
        .update(JSON.stringify(candidate))
        .digest("hex");

    return this.repositories.jobs.enqueue({
      idempotency_key: idempotencyKey,
      candidate_hash: normalized.candidate_hash,
      source_service: candidate.source.service_name,
      candidate,
    });
  }

  async submitWriteBackCandidates(candidates: WriteBackCandidate[]) {
    const jobs = await Promise.all(
      candidates.map((candidate) => this.submitWriteBackCandidate(candidate)),
    );

    return jobs;
  }

  async submitRuntimeWriteBackBatch(
    payload: RuntimeWriteBackBatchRequest,
  ): Promise<SubmittedWriteBackJob[]> {
    const candidates = payload.candidates.map((candidate, index) =>
      adaptRuntimeCandidateToStorage(payload, candidate, index),
    );

    const jobs = await this.submitWriteBackCandidates(candidates);

    return jobs.map((job, index) => ({
      candidate_summary: payload.candidates[index]!.summary,
      job_id: job.id,
      status: "accepted_async",
    }));
  }

  async getWriteJob(jobId: string) {
    return this.repositories.jobs.findById(jobId);
  }

  async listWriteJobs(limit = 50) {
    return this.repositories.jobs.listRecent(limit);
  }

  async processWriteJobs() {
    return this.worker.processAvailableJobs();
  }

  async listRecords(filters: RecordListFilters) {
    return this.repositories.records.listRecords(filters);
  }

  async patchRecord(recordId: string, input: RecordPatchInput) {
    return this.governance.patchRecord(recordId, input);
  }

  async archiveRecord(recordId: string, input: ArchiveRecordInput) {
    return this.governance.archiveRecord(recordId, input);
  }

  async restoreVersion(recordId: string, input: RestoreVersionInput) {
    return this.governance.restoreVersion(recordId, input);
  }

  async listConflicts(status?: string) {
    return this.repositories.conflicts.listConflicts(status);
  }

  async resolveConflict(conflictId: string, input: ResolveConflictInput) {
    return this.governance.resolveConflict(conflictId, input);
  }

  async getMetrics() {
    return this.repositories.metrics.collect();
  }

  async getLiveness(): Promise<LivenessStatus> {
    return {
      status: "alive",
    };
  }

  async getReadiness(): Promise<ReadinessStatus> {
    const databaseStatus = await this.getDatabaseDependencyStatus();

    if (databaseStatus.status !== "healthy") {
      return {
        status: "not_ready",
        reason: databaseStatus.message ?? "database is not ready",
      };
    }

    return {
      status: "ready",
    };
  }

  async getDependencies(): Promise<DependenciesReport> {
    return {
      dependencies: await this.listDependencyStatuses(),
    };
  }

  async getHealth() {
    const [liveness, readiness, dependencyReport] = await Promise.all([
      this.getLiveness(),
      this.getReadiness(),
      this.getDependencies(),
    ]);

    return {
      liveness: liveness.status,
      readiness: readiness.status,
      reason: readiness.reason,
      dependencies: dependencyReport.dependencies,
    };
  }

  private async listDependencyStatuses(): Promise<DependencyStatus[]> {
    return [
      await this.getDatabaseDependencyStatus(),
      this.getRedisDependencyStatus(),
      this.getEmbeddingDependencyStatus(),
    ];
  }

  private async getDatabaseDependencyStatus(): Promise<DependencyStatus> {
    if (!this.database) {
      return {
        name: "database",
        status: "not_configured",
        message: undefined,
      };
    }

    try {
      await this.database.ping();
      return {
        name: "database",
        status: "healthy",
        message: undefined,
      };
    } catch (error) {
      return {
        name: "database",
        status: "unavailable",
        message: error instanceof Error ? error.message : "database ping failed",
      };
    }
  }

  private getRedisDependencyStatus(): DependencyStatus {
    if (!this.config.redis_url) {
      return {
        name: "redis",
        status: "not_configured",
        message: undefined,
      };
    }

    return {
      name: "redis",
      status: "unavailable",
      message: "redis is optional and not connected in this build",
    };
  }

  private getEmbeddingDependencyStatus(): DependencyStatus {
    if (!this.config.embedding_base_url) {
      return {
        name: "embedding_service",
        status: "not_configured",
        message: undefined,
      };
    }

    if (!this.embeddingsClient) {
      return {
        name: "embedding_service",
        status: "unavailable",
        message: "embedding client is not connected",
      };
    }

    return {
      name: "embedding_service",
      status: "healthy",
      message: undefined,
    };
  }
}

export function createStorageService(input: {
  repositories?: StorageRepositories;
  logger: Logger;
  config: StorageConfig;
  database?: StorageDatabase;
  embeddingsClient?: EmbeddingsClient | undefined;
}) {
  const repositories =
    input.repositories ?? (input.database ? createRepositories(input.database) : undefined);

  if (!repositories) {
    throw new Error("storage service requires repositories or a database");
  }

  return new StorageService(
    repositories,
    input.logger,
    input.config,
    input.database,
    input.embeddingsClient,
  );
}

function adaptRuntimeCandidateToStorage(
  payload: RuntimeWriteBackBatchRequest,
  candidate: RuntimeWriteBackBatchRequest["candidates"][number],
  index: number,
): WriteBackCandidate {
  const candidateType =
    candidate.candidate_type === "commitment" || candidate.candidate_type === "important_event"
      ? "episodic"
      : candidate.candidate_type;

  return {
    workspace_id: payload.workspace_id,
    user_id: payload.user_id,
    task_id: candidate.scope === "task" ? (candidate.source.task_id ?? payload.task_id ?? null) : null,
    session_id: candidate.scope === "session" ? payload.session_id : null,
    candidate_type: candidateType,
    scope: candidate.scope,
    summary: candidate.summary,
    details: {
      ...candidate.details,
      runtime_candidate_type: candidate.candidate_type,
      runtime_source: candidate.source,
      runtime_dedupe_key: candidate.dedupe_key,
    },
    importance: candidate.importance,
    confidence: candidate.confidence,
    write_reason: candidate.write_reason,
    source: {
      source_type: candidate.source.host,
      source_ref: candidate.source.turn_id ?? candidate.source.thread_id ?? `${payload.session_id}:${index}`,
      service_name: payload.source_service,
      confirmed_by_user: candidate.candidate_type === "fact_preference",
    },
    idempotency_key: `${payload.workspace_id}:${payload.user_id}:${candidate.dedupe_key}`,
  };
}

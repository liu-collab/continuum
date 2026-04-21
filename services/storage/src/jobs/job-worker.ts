import type { Logger } from "../logger.js";
import type { EmbeddingsClient } from "../db/embeddings-client.js";
import { ReadModelProjector } from "../db/read-model-projector.js";
import type { StorageRepositories } from "../db/repositories.js";
import { AppError } from "../errors.js";
import { WritebackProcessor } from "../domain/writeback-processor.js";

export interface JobWorkerOptions {
  batch_size: number;
  max_retries: number;
  read_model_refresh_max_retries: number;
}

export class JobWorker {
  private readonly processor: WritebackProcessor;
  private readonly projector: ReadModelProjector;

  constructor(
    private readonly repositories: StorageRepositories,
    private readonly logger: Logger,
    private readonly options: JobWorkerOptions,
    embeddingsClient?: EmbeddingsClient,
  ) {
    this.processor = new WritebackProcessor(repositories, logger);
    this.projector = new ReadModelProjector(repositories.readModel, embeddingsClient);
  }

  async processAvailableJobs() {
    const jobs = await this.repositories.transaction((tx) =>
      tx.jobs.claimQueuedJobs(this.options.batch_size),
    );

    for (const job of jobs) {
      try {
        const result = await this.processor.processJob(job);
        await this.repositories.jobs.markSucceeded(job.id, {
          result_record_id: result.record_id,
          result_status: result.result_status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown job failure";
        const code = error instanceof AppError ? error.code : "job_processing_failed";
        const nextRetryCount = job.retry_count + 1;

        this.logger.error({ jobId: job.id, error }, "write job processing failed");

        if (nextRetryCount > this.options.max_retries) {
          await this.repositories.jobs.markDeadLetter(job.id, {
            error_code: code,
            error_message: message,
          });
          continue;
        }

        await this.repositories.jobs.requeue(job.id, message);
      }
    }

    await this.processRefreshJobs();
    await this.recoverEmbeddingDimensionDeadLetters();
    await this.projector.refreshPendingEmbeddings(this.options.batch_size);
    return jobs.length;
  }

  private async processRefreshJobs() {
    const refreshJobs = await this.repositories.transaction((tx) =>
      tx.readModel.claimRefreshJobs(this.options.batch_size),
    );

    for (const job of refreshJobs) {
      try {
        const record = await this.repositories.records.findById(job.source_record_id);

        if (!record) {
          if (job.refresh_type === "delete") {
            await this.repositories.readModel.delete(job.source_record_id);
            await this.repositories.readModel.markRefreshSucceeded(job.id, {
              embedding_updated: false,
              degradation_reason: undefined,
            });
            continue;
          }

          throw new Error(`source record ${job.source_record_id} not found`);
        }

        const outcome = await this.projector.project(record);
        await this.repositories.readModel.markRefreshSucceeded(job.id, outcome);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown refresh failure";
        this.logger.error({ refreshJobId: job.id, error }, "read model refresh failed");
        const nextRetryCount = job.retry_count + 1;

        if (nextRetryCount > this.options.read_model_refresh_max_retries) {
          await this.repositories.readModel.markRefreshDeadLetter(job.id, message);
          continue;
        }

        await this.repositories.readModel.markRefreshFailed(job.id, message);
      }
    }
  }

  private async recoverEmbeddingDimensionDeadLetters() {
    const refreshJobs = await this.repositories.transaction((tx) =>
      tx.readModel.claimRecoverableDeadLetterRefreshJobs({
        limit: this.options.batch_size,
        errorPattern: "expected 1536 dimensions",
      }),
    );

    for (const job of refreshJobs) {
      try {
        const record = await this.repositories.records.findById(job.source_record_id);
        if (!record) {
          await this.repositories.readModel.markRefreshDeadLetter(job.id, "source record not found");
          continue;
        }

        const outcome = await this.projector.project(record);
        await this.repositories.readModel.markRefreshSucceeded(job.id, {
          embedding_updated: false,
          degradation_reason: outcome.degradation_reason,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "dead-letter recovery failed";
        this.logger.error({ refreshJobId: job.id, error }, "read model dead-letter recovery failed");
        await this.repositories.readModel.markRefreshDeadLetter(job.id, message);
      }
    }
  }
}

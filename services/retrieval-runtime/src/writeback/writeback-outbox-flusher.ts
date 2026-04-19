import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import { nowIso } from "../shared/utils.js";
import type { StorageWritebackClient } from "./storage-client.js";

const retryScheduleMs = [1000, 5000, 30_000, 120_000, 600_000];

function nextRetryDelayMs(retryCount: number) {
  return retryScheduleMs[Math.min(retryCount, retryScheduleMs.length - 1)] ?? 600_000;
}

export class WritebackOutboxFlusher {
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly repository: RuntimeRepository,
    private readonly storageClient: StorageWritebackClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush().catch((error) => {
        this.logger.warn({ error }, "writeback outbox flush failed");
      });
    }, this.config.WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    try {
      const claimed = await this.repository.claimPendingWritebackOutbox(
        this.config.WRITEBACK_OUTBOX_BATCH_SIZE,
        nowIso(),
      );
      if (claimed.length === 0) {
        return;
      }

      for (const record of claimed) {
        try {
          await this.storageClient.submitCandidates([record.candidate]);
          await this.repository.markWritebackOutboxSubmitted([record.id], nowIso());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (record.retry_count + 1 >= this.config.WRITEBACK_OUTBOX_MAX_RETRIES) {
            await this.repository.markWritebackOutboxDeadLetter(record.id, message);
            continue;
          }

          await this.repository.requeueWritebackOutbox(
            record.id,
            new Date(Date.now() + nextRetryDelayMs(record.retry_count)).toISOString(),
            message,
          );
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

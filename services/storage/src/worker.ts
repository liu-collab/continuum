import { setTimeout as delay } from "node:timers/promises";

import { loadConfig } from "./config.js";
import { StorageDatabase } from "./db/client.js";
import { HttpEmbeddingsClient } from "./db/embeddings-client.js";
import { createLogger } from "./logger.js";
import { createStorageService } from "./services.js";

export interface WorkerRuntime {
  service: Pick<ReturnType<typeof createStorageService>, "processWriteJobs">;
  database: Pick<StorageDatabase, "close">;
  logger: Pick<ReturnType<typeof createLogger>, "info" | "error"> & Partial<Pick<ReturnType<typeof createLogger>, "warn" | "fatal">>;
  pollIntervalMs: number;
  delay?: (ms: number) => Promise<void>;
  onSignal?: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
}

const MAX_CONSECUTIVE_FAILURES = 10;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export async function runWorker(runtime: WorkerRuntime) {
  const wait = runtime.delay ?? delay;
  const registerSignal =
    runtime.onSignal ?? ((signal: "SIGINT" | "SIGTERM", handler: () => void) => void process.on(signal, handler));

  let active = true;
  let consecutiveFailures = 0;
  let currentDelay = runtime.pollIntervalMs;
  const stop = () => {
    active = false;
  };

  registerSignal("SIGINT", stop);
  registerSignal("SIGTERM", stop);

  runtime.logger.info("storage worker started");

  while (active) {
    try {
      await runtime.service.processWriteJobs();
      consecutiveFailures = 0;
      currentDelay = runtime.pollIntervalMs;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        runtime.logger.fatal?.(
          { error, consecutiveFailures },
          "storage worker exceeded max consecutive failures, stopping",
        ) ?? runtime.logger.error(
          { error, consecutiveFailures },
          "storage worker exceeded max consecutive failures, stopping",
        );
        active = false;
        break;
      }

      currentDelay = Math.min(BASE_BACKOFF_MS * (2 ** (consecutiveFailures - 1)), MAX_BACKOFF_MS);
      runtime.logger.warn?.(
        { error, consecutiveFailures, backoffMs: currentDelay },
        "storage worker cycle failed, backing off",
      ) ?? runtime.logger.error(
        { error, consecutiveFailures, backoffMs: currentDelay },
        "storage worker cycle failed, backing off",
      );
    }

    if (active) {
      await wait(currentDelay);
    }
  }

  runtime.logger.info("storage worker shutting down");
  await runtime.database.close();
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.log_level);
  const database = new StorageDatabase(config, logger);
  const embeddingsClient = new HttpEmbeddingsClient(config);
  const service = createStorageService({
    logger,
    config,
    database,
    embeddingsClient,
  });

  await runWorker({
    service,
    database,
    logger,
    pollIntervalMs: config.write_job_poll_interval_ms,
  });
}

const entryScript = process.argv[1];

if (entryScript && import.meta.url === new URL(entryScript, "file://").href) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}

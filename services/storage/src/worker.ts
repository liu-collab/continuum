import { setTimeout as delay } from "node:timers/promises";

import { loadConfig } from "./config.js";
import { StorageDatabase } from "./db/client.js";
import { HttpEmbeddingsClient } from "./db/embeddings-client.js";
import { createLogger } from "./logger.js";
import { createStorageService } from "./services.js";

export interface WorkerRuntime {
  service: Pick<ReturnType<typeof createStorageService>, "processWriteJobs">;
  database: Pick<StorageDatabase, "close">;
  logger: Pick<ReturnType<typeof createLogger>, "info" | "error">;
  pollIntervalMs: number;
  delay?: (ms: number) => Promise<void>;
  onSignal?: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
}

export async function runWorker(runtime: WorkerRuntime) {
  const wait = runtime.delay ?? delay;
  const registerSignal =
    runtime.onSignal ?? ((signal: "SIGINT" | "SIGTERM", handler: () => void) => void process.on(signal, handler));

  let active = true;
  const stop = () => {
    active = false;
  };

  registerSignal("SIGINT", stop);
  registerSignal("SIGTERM", stop);

  runtime.logger.info("storage worker started");

  while (active) {
    try {
      await runtime.service.processWriteJobs();
    } catch (error) {
      runtime.logger.error({ error }, "storage worker cycle failed");
    }

    if (active) {
      await wait(runtime.pollIntervalMs);
    }
  }

  runtime.logger.info("storage worker shutting down");
  await runtime.database.close();
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.log_level);
  const database = new StorageDatabase(config, logger);
  const embeddingsClient = config.embedding_base_url
    ? new HttpEmbeddingsClient(config)
    : undefined;
  const service = createStorageService({
    logger,
    config,
    database,
    ...(embeddingsClient ? { embeddingsClient } : {}),
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

import { loadConfig } from "./config.js";
import { StorageDatabase } from "./db/client.js";
import { HttpEmbeddingsClient } from "./db/embeddings-client.js";
import { createLogger } from "./logger.js";
import { createStorageService } from "./services.js";
import { createApp } from "./api/app.js";

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
  const app = createApp(service);

  const close = async () => {
    await app.close();
    await database.close();
  };

  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());

  await app.listen({
    host: config.host,
    port: config.port,
  });

  logger.info({ host: config.host, port: config.port }, "storage server started");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { StorageDatabase } from "./client.js";
import { runMigrations } from "./migration-runner.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.log_level);
  const db = new StorageDatabase(config, logger);
  await runMigrations(config, logger, db);
  await db.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

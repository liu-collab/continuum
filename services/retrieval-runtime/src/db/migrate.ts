import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createPgPool } from "./postgres-utils.js";
import { runMigrations } from "./migration-runner.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPgPool(config.DATABASE_URL);

  try {
    await runMigrations(config, logger, pool);
  } finally {
    await pool.end?.();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

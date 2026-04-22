import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import type { StorageConfig } from "../src/config.js";
import { StorageDatabase, quoteIdentifier } from "../src/db/client.js";
import { createLogger } from "../src/logger.js";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export interface PostgresTestContext {
  config: StorageConfig;
  database: StorageDatabase;
  logger: ReturnType<typeof createLogger>;
  migrationsDir: string;
  migrationFileNames: string[];
  privateSchema: string;
  sharedSchema: string;
  cleanup(): Promise<void>;
}

export async function createPostgresTestContext(prefix: string): Promise<PostgresTestContext> {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for postgres integration tests");
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const privateSchema = `${prefix}_private_${suffix}`;
  const sharedSchema = `${prefix}_shared_${suffix}`;
  const migrationsClone = await cloneMigrations(suffix);
  const logger = createLogger("silent");
  const config: StorageConfig = {
    port: 3001,
    host: "127.0.0.1",
    log_level: "silent",
    database_url: testDatabaseUrl,
    storage_schema_private: privateSchema,
    storage_schema_shared: sharedSchema,
    write_job_poll_interval_ms: 10,
    write_job_batch_size: 10,
    write_job_max_retries: 3,
    read_model_refresh_max_retries: 2,
    embedding_base_url: undefined,
    embedding_api_key: undefined,
    embedding_model: "text-embedding-3-small",
    redis_url: undefined,
  };
  const database = new StorageDatabase(config, logger);

  return {
    config,
    database,
    logger,
    migrationsDir: migrationsClone.dir,
    migrationFileNames: migrationsClone.fileNames,
    privateSchema,
    sharedSchema,
    async cleanup() {
      try {
        await database.session().query(
          `delete from public.service_migrations where service_name = 'storage' and file_name = any($1::text[])`,
          [migrationsClone.fileNames],
        );
      } catch {
        // ignore cleanup failures for migration bookkeeping
      }

      try {
        await database.session().query(
          `drop schema if exists ${quoteIdentifier(privateSchema)} cascade`,
        );
        await database.session().query(
          `drop schema if exists ${quoteIdentifier(sharedSchema)} cascade`,
        );
      } finally {
        await database.close();
        await rm(migrationsClone.dir, { recursive: true, force: true });
      }
    },
  };
}

async function cloneMigrations(suffix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "storage-pg-migrations-"));
  const sources = [
    "0001_storage_init.sql",
    "0002_read_model_contract.sql",
    "0004_governance_executions.sql",
  ] as const;
  const fileNames: string[] = [];

  for (const source of sources) {
    const targetName = source.replace(/^000([0-9]+)_/, `000$1_${suffix}_`);
    const template = await readFile(path.resolve(process.cwd(), "migrations", source), "utf8");
    await writeFile(path.join(dir, targetName), template, "utf8");
    fileNames.push(targetName);
  }

  return {
    dir,
    fileNames,
  };
}

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { createPgPool, quoteIdentifier, type PgPoolLike } from "./postgres-utils.js";

const RUNTIME_SCHEMA_IDENT_TOKEN = "__RUNTIME_SCHEMA_IDENT__";
const RUNTIME_SCHEMA_LITERAL_TOKEN = "__RUNTIME_SCHEMA_LITERAL__";

export async function runMigrations(
  config: AppConfig,
  logger: Logger,
  pool: PgPoolLike = createPgPool(config.DATABASE_URL),
  migrationsDir = path.resolve(process.cwd(), "migrations"),
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.service_migrations (
      service_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (service_name, file_name)
    )
  `);

  const files = await listMigrationFiles(migrationsDir);

  for (const file of files) {
    const applied = await pool.query<{ file_name: string }>(
      `SELECT file_name FROM public.service_migrations WHERE service_name = $1 AND file_name = $2`,
      ["retrieval-runtime", file],
    );

    if ((applied.rows?.length ?? 0) > 0) {
      continue;
    }

    const sql = await renderMigrationFile(path.join(migrationsDir, file), config);
    logger.info({ file }, "running retrieval-runtime migration");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO public.service_migrations (service_name, file_name) VALUES ($1, $2)`,
        ["retrieval-runtime", file],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function listMigrationFiles(migrationsDir: string) {
  return (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

export async function renderMigrationFile(filePath: string, config: Pick<AppConfig, "RUNTIME_SCHEMA">) {
  const template = await readFile(filePath, "utf8");
  return renderMigrationTemplate(template, config);
}

export function renderMigrationTemplate(template: string, config: Pick<AppConfig, "RUNTIME_SCHEMA">) {
  return template
    .replaceAll(RUNTIME_SCHEMA_IDENT_TOKEN, quoteIdentifier(config.RUNTIME_SCHEMA))
    .replaceAll(RUNTIME_SCHEMA_LITERAL_TOKEN, quoteSqlLiteral(config.RUNTIME_SCHEMA));
}

function quoteSqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

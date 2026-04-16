import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { StorageConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { quoteIdentifier, type StorageDatabase } from "./client.js";

const PRIVATE_SCHEMA_IDENT_TOKEN = "__PRIVATE_SCHEMA_IDENT__";
const PRIVATE_SCHEMA_LITERAL_TOKEN = "__PRIVATE_SCHEMA_LITERAL__";
const SHARED_SCHEMA_IDENT_TOKEN = "__SHARED_SCHEMA_IDENT__";
const SHARED_SCHEMA_LITERAL_TOKEN = "__SHARED_SCHEMA_LITERAL__";

export async function runMigrations(
  config: StorageConfig,
  logger: Logger,
  db: StorageDatabase,
  migrationsDir = path.resolve(process.cwd(), "migrations"),
) {
  await db.withTransaction(async (tx) => {
    await tx.query(`
      create table if not exists public.service_migrations (
        service_name text not null,
        file_name text not null,
        executed_at timestamptz not null default now(),
        primary key (service_name, file_name)
      )
    `);
  });

  const files = await listMigrationFiles(migrationsDir);

  for (const file of files) {
    const alreadyApplied = await db.session().query<{ file_name: string }>(
      `select file_name from public.service_migrations where service_name = $1 and file_name = $2`,
      ["storage", file],
    );

    if (alreadyApplied.rowCount) {
      continue;
    }

    const sql = await renderMigrationFile(path.join(migrationsDir, file), config);
    logger.info({ file }, "running storage migration");

    await db.withTransaction(async (tx) => {
      await tx.query(sql);
      await tx.query(
        `insert into public.service_migrations (service_name, file_name) values ($1, $2)`,
        ["storage", file],
      );
    });
  }
}

export async function listMigrationFiles(migrationsDir: string) {
  return (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

export async function renderMigrationFile(
  filePath: string,
  config: Pick<StorageConfig, "storage_schema_private" | "storage_schema_shared">,
) {
  const template = await readFile(filePath, "utf8");
  return renderMigrationTemplate(template, config);
}

export function renderMigrationTemplate(
  template: string,
  config: Pick<StorageConfig, "storage_schema_private" | "storage_schema_shared">,
) {
  return template
    .replaceAll(PRIVATE_SCHEMA_IDENT_TOKEN, quoteIdentifier(config.storage_schema_private))
    .replaceAll(
      PRIVATE_SCHEMA_LITERAL_TOKEN,
      quoteSqlLiteral(config.storage_schema_private),
    )
    .replaceAll(SHARED_SCHEMA_IDENT_TOKEN, quoteIdentifier(config.storage_schema_shared))
    .replaceAll(
      SHARED_SCHEMA_LITERAL_TOKEN,
      quoteSqlLiteral(config.storage_schema_shared),
    );
}

function quoteSqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

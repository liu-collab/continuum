import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { StorageConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import {
  renderMigrationFile,
  renderMigrationTemplate,
  runMigrations,
} from "../src/db/migration-runner.js";
import { createPostgresTestContext, testDatabaseUrl } from "./postgres-test-helpers.js";

const logger = createLogger("silent");

describe("storage migrations", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("renders custom schemas into migration sql", async () => {
    const sql = await renderMigrationFile(
      path.resolve(
        process.cwd(),
        "migrations",
        "0001_storage_init.sql",
      ),
      {
        storage_schema_private: "tenant_private",
        storage_schema_shared: "tenant_shared_v2",
      },
    );

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "tenant_private"');
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "tenant_shared_v2"');
    expect(sql).not.toContain("storage_private.memory_records");
    expect(sql).not.toContain("storage_shared_v1.memory_read_model_v1");
  });

  it("keeps legacy column upgrade behind guarded blocks for fresh databases", async () => {
    const raw0002 = await renderMigrationFile(
      path.resolve(
        process.cwd(),
        "migrations",
        "0002_read_model_contract.sql",
      ),
      {
        storage_schema_private: "storage_private",
        storage_schema_shared: "storage_shared_v1",
      },
    );

    expect(raw0002).toContain("IF EXISTS");
    expect(raw0002).toContain("details_preview_json");
    expect(raw0002).toContain("source_type");
    expect(raw0002).toContain('DROP COLUMN IF EXISTS details_preview_json');
    expect(raw0002).toContain('DROP COLUMN IF EXISTS source_type');
  });

  it("runs migrations in order with custom schemas", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "storage-migrations-"));
    tempDirs.push(tempDir);
    const migrationsDir = path.join(tempDir, "migrations");
    await mkdir(migrationsDir, { recursive: true });

    await writeFile(
      path.join(migrationsDir, "0001_test.sql"),
      "create schema if not exists __PRIVATE_SCHEMA_IDENT__;\nselect __PRIVATE_SCHEMA_LITERAL__ as private_schema;\n",
      "utf8",
    );
    await writeFile(
      path.join(migrationsDir, "0002_test.sql"),
      "create schema if not exists __SHARED_SCHEMA_IDENT__;\nselect __SHARED_SCHEMA_LITERAL__ as shared_schema;\n",
      "utf8",
    );

    const executed: string[] = [];
    const db = createFakeDatabase(executed);
    const config = buildTestConfig();

    await runMigrations(config, logger, db as never, migrationsDir);

    expect(executed.some((sql) => sql.includes('"tenant_private"'))).toBe(true);
    expect(executed.some((sql) => sql.includes('"tenant_shared_v2"'))).toBe(true);
    expect(executed.findIndex((sql) => sql.includes("private_schema"))).toBeLessThan(
      executed.findIndex((sql) => sql.includes("shared_schema")),
    );
  });

  it("renders legacy upgrade sql with configured shared schema literal", () => {
    const rendered = renderMigrationTemplate(
      "select __SHARED_SCHEMA_LITERAL__ as shared_name, __PRIVATE_SCHEMA_LITERAL__ as private_name",
      {
        storage_schema_private: "tenant_private",
        storage_schema_shared: "tenant_shared_v2",
      },
    );

    expect(rendered).toContain("'tenant_private'");
    expect(rendered).toContain("'tenant_shared_v2'");
  });
});

describe.skipIf(!testDatabaseUrl)("storage migrations against postgres", () => {
  it("applies 0001 then 0002 on a fresh database and keeps the expected contract", async () => {
    const context = await createPostgresTestContext("storage_migration_test");

    try {
      await runMigrations(
        context.config,
        context.logger,
        context.database,
        context.migrationsDir,
      );

      const tableCheck = await context.database.session().query<{
        table_schema: string;
        table_name: string;
      }>(
        `
          select table_schema, table_name
          from information_schema.tables
          where (table_schema = $1 and table_name in (
            'memory_records',
            'memory_record_versions',
            'memory_write_jobs',
            'memory_conflicts',
            'memory_governance_actions',
            'memory_read_model_refresh_jobs'
          ))
             or (table_schema = $2 and table_name = 'memory_read_model_v1')
          order by table_schema, table_name
        `,
        [context.privateSchema, context.sharedSchema],
      );

      expect(tableCheck.rows).toHaveLength(7);

      const readModelColumns = await context.database.session().query<{
        column_name: string;
      }>(
        `
          select column_name
          from information_schema.columns
          where table_schema = $1
            and table_name = 'memory_read_model_v1'
            and column_name in ('details', 'source', 'summary_embedding', 'created_at')
          order by column_name
        `,
        [context.sharedSchema],
      );

      expect(readModelColumns.rows.map((row) => row.column_name)).toEqual([
        "created_at",
        "details",
        "source",
        "summary_embedding",
      ]);

      const legacyColumns = await context.database.session().query<{
        column_name: string;
      }>(
        `
          select column_name
          from information_schema.columns
          where table_schema = $1
            and table_name = 'memory_read_model_v1'
            and column_name in ('details_preview_json', 'source_type', 'source_ref')
        `,
        [context.sharedSchema],
      );

      expect(legacyColumns.rows).toHaveLength(0);

      const refreshConstraint = await context.database.session().query<{
        check_clause: string;
      }>(
        `
          select cc.check_clause
          from information_schema.table_constraints tc
          join information_schema.check_constraints cc
            on tc.constraint_name = cc.constraint_name
          where tc.table_schema = $1
            and tc.table_name = 'memory_read_model_refresh_jobs'
            and tc.constraint_name = 'memory_read_model_refresh_jobs_job_status_check'
        `,
        [context.privateSchema],
      );

      expect(refreshConstraint.rows[0]?.check_clause).toContain("dead_letter");

      const governanceConstraint = await context.database.session().query<{
        check_clause: string;
      }>(
        `
          select cc.check_clause
          from information_schema.table_constraints tc
          join information_schema.check_constraints cc
            on tc.constraint_name = cc.constraint_name
          where tc.table_schema = $1
            and tc.table_name = 'memory_governance_actions'
            and tc.constraint_name = 'memory_governance_actions_action_type_check'
        `,
        [context.privateSchema],
      );

      expect(governanceConstraint.rows[0]?.check_clause).toContain("invalidate");
    } finally {
      await context.cleanup();
    }
  });
});

function buildTestConfig(): StorageConfig {
  return {
    port: 3001,
    host: "127.0.0.1",
    log_level: "silent",
    database_url: "postgres://example",
    storage_schema_private: "tenant_private",
    storage_schema_shared: "tenant_shared_v2",
    write_job_poll_interval_ms: 1000,
    write_job_batch_size: 10,
    write_job_max_retries: 3,
    read_model_refresh_max_retries: 2,
    embedding_base_url: undefined,
    embedding_api_key: undefined,
    embedding_model: "text-embedding-3-small",
    redis_url: undefined,
  };
}

function createFakeDatabase(executed: string[]) {
  const session = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string) {
      executed.push(sql);

      if (sql.includes("select file_name from public.service_migrations")) {
        return {
          rows: [] as T[],
          rowCount: 0,
        };
      }

      return {
        rows: [] as T[],
        rowCount: 0,
      };
    },
  };

  return {
    session: () => session,
    withTransaction: async <T>(callback: (tx: typeof session) => Promise<T>) => callback(session),
  };
}

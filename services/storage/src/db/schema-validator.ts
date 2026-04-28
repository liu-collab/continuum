import { pathToFileURL } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { StorageDatabase } from "./client.js";
import { createSchema } from "./schema.js";

type SchemaDatabase = {
  privateSchema: string;
  sharedSchema: string;
  schema?: StorageSchemaForValidation;
  session(): {
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[] }>;
  };
};

type StorageSchemaForValidation = Partial<Record<keyof ReturnType<typeof createSchema>, PgTable>>;

type ActualColumnRow = {
  table_schema: string;
  table_name: string;
  column_name: string;
  is_nullable: string;
  formatted_type: string;
};

type ExpectedColumn = {
  name: string;
  type: string;
  nullable: boolean;
};

type ExpectedTable = {
  schema: string;
  name: string;
  columns: Map<string, ExpectedColumn>;
};

export async function validateSchemaAlignment(
  db: SchemaDatabase,
  drizzleSchema: StorageSchemaForValidation = db.schema ?? createSchema({
    privateSchema: db.privateSchema,
    sharedSchema: db.sharedSchema,
  }),
): Promise<string[]> {
  const expected = describeDrizzleSchema(drizzleSchema);
  const actual = await loadActualColumns(db);
  const issues: string[] = [];

  for (const [tableKey, expectedTable] of expected) {
    const actualTable = actual.get(tableKey);
    if (!actualTable) {
      issues.push(`missing table ${tableKey}`);
      continue;
    }

    for (const [columnName, expectedColumn] of expectedTable.columns) {
      const actualColumn = actualTable.columns.get(columnName);
      if (!actualColumn) {
        issues.push(`missing column ${tableKey}.${columnName}`);
        continue;
      }

      const expectedType = normalizeSqlType(expectedColumn.type);
      const actualType = normalizeSqlType(actualColumn.type);
      if (expectedType !== actualType) {
        issues.push(
          `column type mismatch ${tableKey}.${columnName}: expected ${expectedType}, got ${actualType}`,
        );
      }

      if (expectedColumn.nullable !== actualColumn.nullable) {
        issues.push(
          `column nullability mismatch ${tableKey}.${columnName}: expected ${
            expectedColumn.nullable ? "nullable" : "NOT NULL"
          }, got ${actualColumn.nullable ? "nullable" : "NOT NULL"}`,
        );
      }
    }

    for (const columnName of actualTable.columns.keys()) {
      if (!expectedTable.columns.has(columnName)) {
        issues.push(`unexpected column ${tableKey}.${columnName}`);
      }
    }
  }

  for (const tableKey of actual.keys()) {
    if (!expected.has(tableKey)) {
      issues.push(`unexpected table ${tableKey}`);
    }
  }

  return issues;
}

function describeDrizzleSchema(schema: StorageSchemaForValidation) {
  const tables = new Map<string, ExpectedTable>();

  for (const table of Object.values(schema)) {
    if (!table) {
      continue;
    }

    const config = getTableConfig(table);
    if (!config.schema) {
      continue;
    }

    const columns = new Map<string, ExpectedColumn>();
    for (const column of config.columns) {
      columns.set(column.name, {
        name: column.name,
        type: column.getSQLType(),
        nullable: !column.notNull,
      });
    }

    tables.set(tableKey(config.schema, config.name), {
      schema: config.schema,
      name: config.name,
      columns,
    });
  }

  return tables;
}

async function loadActualColumns(db: SchemaDatabase) {
  const result = await db.session().query<ActualColumnRow>(
    `
      select
        c.table_schema,
        c.table_name,
        c.column_name,
        c.is_nullable,
        format_type(a.atttypid, a.atttypmod) as formatted_type
      from information_schema.columns c
      join pg_namespace n
        on n.nspname = c.table_schema
      join pg_class cls
        on cls.relnamespace = n.oid
       and cls.relname = c.table_name
      join pg_attribute a
        on a.attrelid = cls.oid
       and a.attname = c.column_name
      where c.table_schema in ($1, $2)
      order by c.table_schema, c.table_name, c.ordinal_position
    `,
    [db.privateSchema, db.sharedSchema],
  );

  const tables = new Map<string, {
    columns: Map<string, { type: string; nullable: boolean }>;
  }>();

  for (const row of result.rows) {
    const key = tableKey(row.table_schema, row.table_name);
    const table = tables.get(key) ?? {
      columns: new Map<string, { type: string; nullable: boolean }>(),
    };
    table.columns.set(row.column_name, {
      type: row.formatted_type,
      nullable: row.is_nullable === "YES",
    });
    tables.set(key, table);
  }

  return tables;
}

function tableKey(schema: string, table: string) {
  return `${schema}.${table}`;
}

function normalizeSqlType(type: string) {
  return type
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.log_level);
  const db = new StorageDatabase(config, logger);

  try {
    const issues = await validateSchemaAlignment(db);
    if (issues.length > 0) {
      for (const issue of issues) {
        logger.error({ issue }, "storage schema alignment issue");
      }
      process.exitCode = 1;
      return;
    }

    logger.info("storage schema alignment check passed");
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}

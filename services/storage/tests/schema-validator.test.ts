import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { validateSchemaAlignment } from "../src/db/schema-validator.js";
import { createSchema } from "../src/db/schema.js";

type ActualColumnRow = {
  table_schema: string;
  table_name: string;
  column_name: string;
  is_nullable: string;
  formatted_type: string;
};

describe("storage schema validator", () => {
  it("accepts matching database columns for configured schemas", async () => {
    const schema = createSchema({
      privateSchema: "tenant_private",
      sharedSchema: "tenant_shared_v2",
    });
    const queries: { text: string; values: unknown[] | undefined }[] = [];
    const db = createFakeSchemaDatabase(schemaRows([schema.memoryRecords, schema.memoryReadModel]), queries);

    const issues = await validateSchemaAlignment(db, {
      memoryRecords: schema.memoryRecords,
      memoryReadModel: schema.memoryReadModel,
    });

    expect(issues).toEqual([]);
    expect(queries[0]?.text).toContain("information_schema.columns");
    expect(queries[0]?.values).toEqual(["tenant_private", "tenant_shared_v2"]);
  });

  it("reports missing, unexpected, type, and nullability drift", async () => {
    const schema = createSchema({
      privateSchema: "tenant_private",
      sharedSchema: "tenant_shared_v2",
    });
    const rows = schemaRows([schema.memoryRecords])
      .filter((row) => row.column_name !== "summary")
      .map((row) => {
        if (row.column_name === "importance") {
          return { ...row, formatted_type: "text" };
        }
        if (row.column_name === "details_json") {
          return { ...row, is_nullable: "YES" };
        }
        return row;
      });
    rows.push({
      table_schema: "tenant_private",
      table_name: "memory_records",
      column_name: "legacy_column",
      is_nullable: "YES",
      formatted_type: "text",
    });
    rows.push({
      table_schema: "tenant_private",
      table_name: "unknown_table",
      column_name: "id",
      is_nullable: "NO",
      formatted_type: "uuid",
    });

    const issues = await validateSchemaAlignment(
      createFakeSchemaDatabase(rows),
      { memoryRecords: schema.memoryRecords },
    );

    expect(issues).toContain("missing column tenant_private.memory_records.summary");
    expect(issues).toContain(
      "column type mismatch tenant_private.memory_records.importance: expected smallint, got text",
    );
    expect(issues).toContain(
      "column nullability mismatch tenant_private.memory_records.details_json: expected NOT NULL, got nullable",
    );
    expect(issues).toContain("unexpected column tenant_private.memory_records.legacy_column");
    expect(issues).toContain("unexpected table tenant_private.unknown_table");
  });
});

function schemaRows(tables: PgTable[]): ActualColumnRow[] {
  return tables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns.map((column) => ({
      table_schema: config.schema ?? "public",
      table_name: config.name,
      column_name: column.name,
      is_nullable: column.notNull ? "NO" : "YES",
      formatted_type: column.getSQLType(),
    }));
  });
}

function createFakeSchemaDatabase(
  rows: ActualColumnRow[],
  queries: { text: string; values: unknown[] | undefined }[] = [],
) {
  return {
    privateSchema: "tenant_private",
    sharedSchema: "tenant_shared_v2",
    session() {
      return {
        async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
          queries.push({ text, values });
          return {
            rows: rows as unknown as T[],
            rowCount: rows.length,
          };
        },
      };
    },
  };
}

import { describe, expect, it } from "vitest";

import type { MemoryRecord, ReadModelEntry } from "../src/contracts.js";
import { createRepositories, snapshotRecord } from "../src/db/repositories.js";

type RecordedQuery = {
  text: string;
  values: unknown[] | undefined;
};

describe("storage repositories", () => {
  it("deep copies record snapshots", async () => {
    const record = {
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      user_id: null,
      task_id: null,
      session_id: null,
      memory_type: "fact_preference",
      scope: "workspace",
      status: "active",
      summary: "Project uses pnpm",
      details_json: {
        nested: {
          value: "before",
        },
      },
      importance: 4,
      confidence: 0.9,
      dedupe_key: "project-uses-pnpm",
      source_type: "user_input",
      source_ref: "turn-1",
      created_by_service: "retrieval-runtime",
      last_confirmed_at: null,
      created_at: "2026-04-22T00:00:00.000Z",
      updated_at: "2026-04-22T00:00:00.000Z",
      archived_at: null,
      deleted_at: null,
      version: 1,
    } satisfies MemoryRecord;

    const snapshot = snapshotRecord(record);
    record.details_json.nested = { value: "after" };

    expect(snapshot.details_json).toEqual({
      nested: {
        value: "before",
      },
    });
  });

  it("binds created_after into record list queries", async () => {
    const queries: RecordedQuery[] = [];
    const session = {
      privateSchema: "storage_private",
      sharedSchema: "storage_shared_v1",
      async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("count(*)")) {
          return {
            rows: [{ total: "0" }] as unknown as T[],
            rowCount: 1,
          };
        }
        return {
          rows: [] as T[],
          rowCount: 0,
        };
      },
    };

    const repositories = createRepositories({
      session: () => session,
      withTransaction: async <T>(callback: (tx: typeof session) => Promise<T>) => callback(session),
    } as never);

    await repositories.records.listRecords({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      scope: "workspace",
      status: "active",
      created_after: "2026-04-10T00:00:00.000Z",
      page: 1,
      page_size: 20,
    });

    const selectQuery = queries.find((query) => query.text.includes("select *") && query.text.includes("memory_records"));
    expect(selectQuery?.text).toContain("created_at >= $");
    expect(selectQuery?.text).toContain("::timestamptz");
    expect(selectQuery?.values).toContain("2026-04-10T00:00:00.000Z");
  });

  it("binds read model upsert values to the current 21-column contract", async () => {
    const queries: RecordedQuery[] = [];
    const session = {
      privateSchema: "storage_private",
      sharedSchema: "storage_shared_v1",
      async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [] as T[],
          rowCount: 0,
        };
      },
    };

    const repositories = createRepositories({
      session: () => session,
      withTransaction: async <T>(callback: (tx: typeof session) => Promise<T>) => callback(session),
    } as never);

    const entry: ReadModelEntry = {
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      user_id: "33333333-3333-4333-8333-333333333333",
      task_id: "44444444-4444-4444-8444-444444444444",
      session_id: "55555555-5555-4555-8555-555555555555",
      memory_type: "fact_preference",
      scope: "user",
      status: "active",
      summary: "User prefers concise answers",
      details: {
        subject: "user",
      },
      importance: 5,
      confidence: 0.9,
      source: {
        source_type: "user_input",
      },
      last_confirmed_at: "2026-04-21T00:00:00.000Z",
      last_used_at: "2026-04-21T00:00:00.000Z",
      created_at: "2026-04-21T00:00:00.000Z",
      updated_at: "2026-04-21T00:00:00.000Z",
      summary_embedding: [0.1, 0.2, 0.3],
      embedding_status: "ok",
      embedding_attempted_at: "2026-04-21T00:00:00.000Z",
      embedding_attempt_count: 1,
    };

    await repositories.readModel.upsert(entry);

    const upsertQuery = queries.find((query) => query.text.includes("insert into") && query.text.includes("memory_read_model_v1"));
    expect(upsertQuery).toBeDefined();
    expect(upsertQuery?.text).toContain("$18::vector, $19, $20, $21");
    expect(upsertQuery?.values).toHaveLength(21);
    expect(upsertQuery?.values?.[17]).toBe("[0.1,0.2,0.3]");
    expect(upsertQuery?.values?.[18]).toBe("ok");
    expect(upsertQuery?.values?.[19]).toBe("2026-04-21T00:00:00.000Z");
    expect(upsertQuery?.values?.[20]).toBe(1);
  });
});

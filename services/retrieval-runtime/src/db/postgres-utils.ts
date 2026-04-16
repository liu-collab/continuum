import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface PgQueryConfig {
  text: string;
  values?: unknown[];
}

export interface PgClientLike {
  query<T extends QueryResultRow = QueryResultRow>(
    queryTextOrConfig: string | PgQueryConfig,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
  release(destroy?: boolean): void;
}

export interface PgPoolLike {
  query<T extends QueryResultRow = QueryResultRow>(
    queryTextOrConfig: string | PgQueryConfig,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
  connect(): Promise<PgClientLike>;
  end?(): Promise<void>;
}

export function createPgPool(connectionString: string, max = 4): PgPoolLike {
  return new Pool({
    connectionString,
    max,
    allowExitOnIdle: true,
  });
}

export function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

export async function withPgTransaction<T>(
  pool: PgPoolLike,
  callback: (client: PgClientLike) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function asPoolLike(pool: Pool): PgPoolLike {
  return pool as unknown as PgPoolLike;
}

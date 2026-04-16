import { Pool, type PoolClient, type QueryResult } from "pg";

import type { StorageConfig } from "../config.js";
import type { Logger } from "../logger.js";

export interface DbSession {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
  readonly privateSchema: string;
  readonly sharedSchema: string;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

class Session implements DbSession {
  readonly privateSchema: string;
  readonly sharedSchema: string;
  private readonly client: Pool | PoolClient;

  constructor(client: Pool | PoolClient, privateSchema: string, sharedSchema: string) {
    this.client = client;
    this.privateSchema = privateSchema;
    this.sharedSchema = sharedSchema;
  }

  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) {
    return this.client.query<T>(text, values);
  }
}

export class StorageDatabase {
  readonly privateSchema: string;
  readonly sharedSchema: string;
  private readonly pool: Pool;
  private readonly logger: Logger;

  constructor(config: StorageConfig, logger: Logger) {
    this.privateSchema = config.storage_schema_private;
    this.sharedSchema = config.storage_schema_shared;
    this.logger = logger;
    this.pool = new Pool({
      connectionString: config.database_url,
    });
  }

  session(): DbSession {
    return new Session(this.pool, this.privateSchema, this.sharedSchema);
  }

  async withTransaction<T>(callback: (session: DbSession) => Promise<T>) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const session = new Session(client, this.privateSchema, this.sharedSchema);
      const result = await callback(session);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ping() {
    await this.pool.query("select 1");
  }

  async close() {
    await this.pool.end();
    this.logger.info("database pool closed");
  }
}

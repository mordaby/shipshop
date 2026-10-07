import type { DatabaseConfig } from '@chatprint/shared';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

/** Any Drizzle Postgres database with our schema: node-postgres in the app, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseConnection {
  db: Database;
  close(): Promise<void>;
}

export function connectDatabase(config: DatabaseConfig): DatabaseConnection {
  const pool = new pg.Pool({ connectionString: config.url });
  const db = drizzle({ client: pool, schema });
  return { db, close: () => pool.end() };
}

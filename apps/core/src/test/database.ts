import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_FOLDER } from '../db/migrate.js';
import * as schema from '../db/schema.js';

/**
 * A fresh, migrated database for tests. PGlite is Postgres compiled to
 * WebAssembly and runs in-process, so unit tests need no server; the same
 * migrations run against real Postgres in the integration tests.
 */
export async function createTestDatabase() {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

/** The Postgres error code of a failed statement (Drizzle wraps driver errors in `cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

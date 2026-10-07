import { GelatoProductApi, resolveGelatoProduct } from '@chatprint/providers';
import {
  FIXTURE_CANVAS_PRODUCT_UID,
  gelatoCanvasRoutes,
  mockFetch,
} from '@chatprint/providers/testing';
import { CATALOG, databaseConfig, DESTINATION_COUNTRIES, readEnv } from '@chatprint/shared';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, type DatabaseConnection } from './client.js';
import { migrateDatabase } from './migrate.js';
import { catalogPrices, catalogVariants, quotes, users } from './schema.js';
import { seedCatalog } from './seed-catalog.js';

// Runs against the docker-compose Postgres (DATABASE_URL) in a scratch
// database that is created for this run and dropped afterwards.
const serverUrl = databaseConfig(readEnv()).url;
const scratchName = `chatprint_it_${randomUUID().replaceAll('-', '')}`;
const scratchUrl = (() => {
  const url = new URL(serverUrl);
  url.pathname = `/${scratchName}`;
  return url.toString();
})();

async function query<Row extends pg.QueryResultRow>(url: string, text: string): Promise<Row[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<Row>(text)).rows;
  } finally {
    await client.end();
  }
}

let connection: DatabaseConnection | undefined;

function db() {
  if (connection === undefined) throw new Error('The migration test did not connect');
  return connection.db;
}

beforeAll(async () => {
  await query(serverUrl, `CREATE DATABASE ${scratchName}`);
});

afterAll(async () => {
  await connection?.close();
  await query(serverUrl, `DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
});

describe('on Postgres', () => {
  it('migrates a fresh database, with concurrent runs serialised by the lock', async () => {
    await Promise.all([
      migrateDatabase({ url: scratchUrl }),
      migrateDatabase({ url: scratchUrl }),
      migrateDatabase({ url: scratchUrl }),
    ]);
    await migrateDatabase({ url: scratchUrl });

    const tables = await query<{ count: string }>(
      scratchUrl,
      `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(Number(tables[0]!.count)).toBe(14);
    connection = connectDatabase({ url: scratchUrl });
  });

  it('seeds the catalog through the Gelato lookup (mocked HTTP)', async () => {
    const mock = mockFetch([...gelatoCanvasRoutes(), ...gelatoCanvasRoutes()]);
    const api = new GelatoProductApi({ apiKey: 'test-key', fetch: mock.fetch });
    const options = {
      catalog: CATALOG,
      production: false,
      resolveVariant: (variant: (typeof CATALOG)[number]['variants'][number]) =>
        resolveGelatoProduct(api, {
          sku: variant.sku,
          lookup: variant.gelato,
          sizeMm: { width: variant.widthMm, height: variant.heightMm },
          countries: DESTINATION_COUNTRIES,
        }).then((r) => ({ gelatoProductUid: r.productUid, warnings: r.warnings })),
    };

    await seedCatalog(db(), options);
    await seedCatalog(db(), options);

    const variants = await db().select().from(catalogVariants);
    expect(variants.map((v) => [v.sku, v.gelatoProductUid])).toEqual([
      ['CANVAS-30X30-SLIM', FIXTURE_CANVAS_PRODUCT_UID],
    ]);
    expect(await db().select().from(catalogPrices)).toHaveLength(1);
  });

  it('enforces money constraints', async () => {
    const [user] = await db().insert(users).values({ phone: '+972500000001' }).returning();
    await expect(
      db().insert(quotes).values({
        userId: user!.id,
        destinationCountry: 'IL',
        currency: 'ILS',
        productPriceMinor: -1,
        shippingPriceMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });
});

import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, pgErrorCode, type TestDatabase } from '../test/database.js';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INVALID_TEXT_REPRESENTATION = '22P02';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.close();
});

let phoneCounter = 0;
async function insertUser() {
  phoneCounter += 1;
  const [user] = await t.db
    .insert(schema.users)
    .values({ phone: `+97250000${String(phoneCounter).padStart(4, '0')}` })
    .returning();
  return user!;
}

async function insertQuote(
  userId: string,
  overrides: Partial<typeof schema.quotes.$inferInsert> = {},
) {
  const [quote] = await t.db
    .insert(schema.quotes)
    .values({
      userId,
      destinationCountry: 'IL',
      currency: 'ILS',
      productPriceMinor: 24900,
      shippingPriceMinor: 3500,
      taxMinor: 0,
      totalMinor: 28400,
      expiresAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    })
    .returning();
  return quote!;
}

const address = {
  firstName: 'Dana',
  lastName: 'Levi',
  addressLine1: '1 Herzl St',
  city: 'Tel Aviv',
  postCode: '6100000',
  country: 'IL',
  email: 'dana@example.com',
};

async function insertOrder(userId: string, quoteId: string) {
  const [order] = await t.db
    .insert(schema.orders)
    .values({
      userId,
      quoteId,
      channel: 'mcp',
      shippingAddress: address,
      currency: 'ILS',
      productPriceMinor: 24900,
      shippingPriceMinor: 3500,
      taxMinor: 0,
      totalMinor: 28400,
    })
    .returning();
  return order!;
}

async function failureCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return pgErrorCode(error);
  }
  throw new Error('Expected the statement to fail');
}

describe('migrations', () => {
  it('create a table for every entity', async () => {
    const result = await t.client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      'catalog_prices',
      'catalog_products',
      'catalog_variants',
      'design_preparations',
      'designs',
      'event_log',
      'order_items',
      'orders',
      'payments',
      'quote_items',
      'quotes',
      'shipments',
      'support_tickets',
      'users',
    ]);
  });

  it('match schema.ts (run `pnpm db:generate` after editing the schema)', async () => {
    const journal = JSON.parse(
      await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    const last = journal.entries.at(-1)!;
    const snapshotFile = path.join(
      MIGRATIONS_FOLDER,
      'meta',
      `${String(last.idx).padStart(4, '0')}_snapshot.json`,
    );
    // drizzle-kit's snapshot type imports zod v3, which isn't installed here; `never` sidesteps it.
    const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8')) as never;

    const pending = await generateMigration(snapshot, generateDrizzleJson(schema));

    expect(pending).toEqual([]);
  });
});

describe('ids', () => {
  it('are random v4 UUIDs, not sequential', async () => {
    const a = await insertUser();
    const b = await insertUser();
    for (const id of [a.id, b.id]) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(a.id).not.toBe(b.id);
  });
});

describe('constraints', () => {
  it('require E.164 phone numbers, unique per user', async () => {
    expect(await failureCode(t.db.insert(schema.users).values({ phone: '050-1234567' }))).toBe(
      CHECK_VIOLATION,
    );
    const user = await insertUser();
    expect(await failureCode(t.db.insert(schema.users).values({ phone: user.phone }))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it('reject negative money and unsupported currencies', async () => {
    const user = await insertUser();
    expect(await failureCode(insertQuote(user.id, { totalMinor: -1 }))).toBe(CHECK_VIOLATION);
    expect(await failureCode(insertQuote(user.id, { currency: 'GBP' as never }))).toBe(
      INVALID_TEXT_REPRESENTATION,
    );
  });

  it('reject fractional money at the column type', async () => {
    const user = await insertUser();
    const code = await failureCode(
      t.db.execute(
        sql`INSERT INTO quotes (user_id, destination_country, currency, product_price_minor,
              shipping_price_minor, tax_minor, total_minor, expires_at)
            VALUES (${user.id}, 'IL', 'ILS', '249.5', 0, 0, 0, now())`,
      ),
    );
    expect(code).toBe(INVALID_TEXT_REPRESENTATION);
  });

  it('require upper-case ISO country codes', async () => {
    const user = await insertUser();
    expect(await failureCode(insertQuote(user.id, { destinationCountry: 'il' }))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('allow one order per quote', async () => {
    const user = await insertUser();
    const quote = await insertQuote(user.id);
    const order = await insertOrder(user.id, quote.id);
    expect(order.status).toBe('awaiting_payment');
    expect(order.reviewStatus).toBe('pending');
    expect(await failureCode(insertOrder(user.id, quote.id))).toBe(UNIQUE_VIOLATION);
  });

  it('refuse a succeeded payment without the verified webhook that confirmed it', async () => {
    const user = await insertUser();
    const order = await insertOrder(user.id, (await insertQuote(user.id)).id);
    const payment = {
      orderId: order.id,
      processor: 'paypal' as const,
      amountMinor: 28400,
      currency: 'ILS' as const,
      status: 'succeeded' as const,
    };
    expect(await failureCode(t.db.insert(schema.payments).values(payment))).toBe(CHECK_VIOLATION);

    const [event] = await t.db
      .insert(schema.eventLog)
      .values({ source: 'paypal', externalId: 'WH-1', rawBody: '{}', verification: 'verified' })
      .returning();
    await expect(
      t.db.insert(schema.payments).values({ ...payment, confirmedByEventId: event!.id }),
    ).resolves.toBeDefined();
  });

  it('keep refunds within the amount paid', async () => {
    const user = await insertUser();
    const order = await insertOrder(user.id, (await insertQuote(user.id)).id);
    const code = await failureCode(
      t.db.insert(schema.payments).values({
        orderId: order.id,
        processor: 'fake',
        amountMinor: 100,
        refundedAmountMinor: 101,
        currency: 'ILS',
      }),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('store each webhook delivery once per source and event ID', async () => {
    const row = { source: 'gelato', externalId: 'evt-42', rawBody: '{"id":"evt-42"}' };
    await t.db.insert(schema.eventLog).values(row);
    expect(await failureCode(t.db.insert(schema.eventLog).values(row))).toBe(UNIQUE_VIOLATION);
    // Events without an ID from the sender are all kept.
    await t.db.insert(schema.eventLog).values({ source: 'gelato', rawBody: '{}' });
    await t.db.insert(schema.eventLog).values({ source: 'gelato', rawBody: '{}' });
  });

  it('record a review decision together with its time', async () => {
    const user = await insertUser();
    const order = await insertOrder(user.id, (await insertQuote(user.id)).id);
    const code = await failureCode(
      t.db.execute(sql`UPDATE orders SET review_status = 'approved' WHERE id = ${order.id}`),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('tie designs and tickets to existing users and orders', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(
      await failureCode(
        t.db
          .insert(schema.designs)
          .values({ userId: missing, source: 'upload', originalKey: 'designs/x/original' }),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    const user = await insertUser();
    expect(
      await failureCode(
        t.db
          .insert(schema.supportTickets)
          .values({ orderId: missing, userId: user.id, channel: 'mcp', message: 'Where is it?' }),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('record provenance and attestation completely', async () => {
    const user = await insertUser();
    const [design] = await t.db
      .insert(schema.designs)
      .values({
        userId: user.id,
        source: 'assistant',
        sourceAssistant: 'chatgpt',
        prompt: 'a lighthouse at dusk',
        originalKey: `designs/${user.id}/original`,
      })
      .returning();
    expect(design!.createdAt).toBeInstanceOf(Date);
    const code = await failureCode(
      t.db.execute(sql`UPDATE designs SET rights_attested_at = now() WHERE id = ${design!.id}`),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });
});

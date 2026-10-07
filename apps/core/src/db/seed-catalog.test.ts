import { GelatoProductApi, resolveGelatoProduct } from '@chatprint/providers';
import {
  FIXTURE_CANVAS_PRODUCT_UID,
  gelatoCanvasRoutes,
  mockFetch,
  type MockRoute,
} from '@chatprint/providers/testing';
import {
  CATALOG,
  DESTINATION_COUNTRIES,
  type CatalogProductDefinition,
  type CatalogVariantDefinition,
} from '@chatprint/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test/database.js';
import { catalogPrices, catalogProducts, catalogVariants } from './schema.js';
import { CatalogSeedError, seedCatalog, type SeedCatalogOptions } from './seed-catalog.js';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.client.exec('TRUNCATE catalog_prices, catalog_variants, catalog_products CASCADE');
});

/** Seed options that resolve through the real lookup code against mocked Gelato responses. */
function gelatoBacked(routes: MockRoute[] = gelatoCanvasRoutes()) {
  const mock = mockFetch(routes);
  const api = new GelatoProductApi({ apiKey: 'test-key', fetch: mock.fetch });
  const options = (overrides: Partial<SeedCatalogOptions> = {}): SeedCatalogOptions => ({
    catalog: CATALOG,
    production: false,
    resolveVariant: (variant) =>
      resolveGelatoProduct(api, {
        sku: variant.sku,
        lookup: variant.gelato,
        sizeMm: { width: variant.widthMm, height: variant.heightMm },
        countries: DESTINATION_COUNTRIES,
      }).then((r) => ({ gelatoProductUid: r.productUid, warnings: r.warnings })),
    ...overrides,
  });
  return { mock, options };
}

const fixed = (uid: string) => () => Promise.resolve({ gelatoProductUid: uid, warnings: [] });

function withVariant(
  overrides: Partial<CatalogVariantDefinition>,
  product: CatalogProductDefinition = CATALOG[0]!,
): CatalogProductDefinition[] {
  return [{ ...product, variants: [{ ...product.variants[0]!, ...overrides }] }];
}

describe('seedCatalog', () => {
  it('writes the canvas with the productUid found through the product API', async () => {
    const { mock, options } = gelatoBacked();

    const result = await seedCatalog(t.db, options());

    expect(result.variants).toEqual([
      { sku: 'CANVAS-30X30-SLIM', gelatoProductUid: FIXTURE_CANVAS_PRODUCT_UID },
    ]);
    expect(mock.requests).toHaveLength(3);
    expect(mock.requests.every((r) => r.headers.get('x-api-key') === 'test-key')).toBe(true);

    const [product] = await t.db.select().from(catalogProducts);
    expect(product).toMatchObject({
      sku: 'CANVAS',
      type: 'canvas',
      nameKey: 'catalog.canvas.name',
    });

    const [variant] = await t.db.select().from(catalogVariants);
    expect(variant).toMatchObject({
      productId: product!.id,
      sku: 'CANVAS-30X30-SLIM',
      widthMm: 300,
      heightMm: 300,
      gelatoProductUid: FIXTURE_CANVAS_PRODUCT_UID,
      active: true,
      printAreas: [{ key: 'front', widthMm: 300, heightMm: 300 }],
      fileRequirements: { minDpi: 150, targetDpi: 300, colorSpace: 'sRGB' },
    });

    const prices = await t.db.select().from(catalogPrices);
    expect(prices).toEqual([
      expect.objectContaining({ variantId: variant!.id, currency: 'ILS', amountMinor: 24900 }),
    ]);
  });

  it('is idempotent', async () => {
    await seedCatalog(t.db, gelatoBacked().options());
    const [before] = await t.db.select().from(catalogVariants);

    await seedCatalog(t.db, gelatoBacked().options());

    const variants = await t.db.select().from(catalogVariants);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.id).toBe(before!.id);
    expect(await t.db.select().from(catalogProducts)).toHaveLength(1);
    expect(await t.db.select().from(catalogPrices)).toHaveLength(1);
  });

  it('updates prices and the productUid, and drops currencies no longer defined', async () => {
    await seedCatalog(t.db, {
      catalog: withVariant({
        retailPrices: [
          { currency: 'ILS', amountMinor: 24900, placeholder: true },
          { currency: 'USD', amountMinor: 6900, placeholder: true },
        ],
      }),
      production: false,
      resolveVariant: fixed('uid-old'),
    });

    await seedCatalog(t.db, {
      catalog: withVariant({
        retailPrices: [{ currency: 'ILS', amountMinor: 26900, placeholder: false }],
      }),
      production: false,
      resolveVariant: fixed('uid-new'),
    });

    const prices = await t.db.select().from(catalogPrices);
    expect(prices.map((p) => [p.currency, p.amountMinor])).toEqual([['ILS', 26900]]);
    const [variant] = await t.db.select().from(catalogVariants);
    expect(variant!.gelatoProductUid).toBe('uid-new');
  });

  it('marks variants that are no longer defined inactive instead of deleting them', async () => {
    await seedCatalog(t.db, { ...gelatoBacked().options(), resolveVariant: fixed('uid-a') });
    await seedCatalog(t.db, {
      catalog: withVariant({ sku: 'CANVAS-30X30-THICK' }),
      production: false,
      resolveVariant: fixed('uid-b'),
    });

    const rows = await t.db
      .select({ sku: catalogVariants.sku, active: catalogVariants.active })
      .from(catalogVariants)
      .orderBy(catalogVariants.sku);
    expect(rows).toEqual([
      { sku: 'CANVAS-30X30-SLIM', active: false },
      { sku: 'CANVAS-30X30-THICK', active: true },
    ]);
  });

  it('refuses placeholder prices in production before calling Gelato', async () => {
    const { mock, options } = gelatoBacked();

    await expect(seedCatalog(t.db, options({ production: true }))).rejects.toThrow(
      /placeholder prices in production: CANVAS-30X30-SLIM ILS/,
    );
    expect(mock.requests).toHaveLength(0);
    expect(await t.db.select().from(catalogProducts)).toHaveLength(0);
  });

  it('allows decided prices in production', async () => {
    const decided = withVariant({
      retailPrices: [{ currency: 'ILS', amountMinor: 24900, placeholder: false }],
    });
    await expect(
      seedCatalog(t.db, gelatoBacked().options({ catalog: decided, production: true })),
    ).resolves.toBeDefined();
  });

  it('writes nothing when the Gelato lookup fails', async () => {
    const { options } = gelatoBacked(gelatoCanvasRoutes({ products: [] }));

    await expect(seedCatalog(t.db, options())).rejects.toThrow(/No product in catalog canvas/);
    expect(await t.db.select().from(catalogProducts)).toHaveLength(0);
    expect(await t.db.select().from(catalogVariants)).toHaveLength(0);
  });

  it('rolls back everything when a write fails', async () => {
    // Make the database reject the second variant, after the first was written.
    await t.client.exec(`
      CREATE FUNCTION reject_broken() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.sku = 'CANVAS-BROKEN' THEN RAISE EXCEPTION 'broken variant'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_broken BEFORE INSERT ON catalog_variants
        FOR EACH ROW EXECUTE FUNCTION reject_broken();
    `);
    const variant = CATALOG[0]!.variants[0]!;
    const twoVariants: CatalogProductDefinition[] = [
      { ...CATALOG[0]!, variants: [variant, { ...variant, sku: 'CANVAS-BROKEN' }] },
    ];

    try {
      await expect(
        seedCatalog(t.db, {
          catalog: twoVariants,
          production: false,
          resolveVariant: fixed('uid'),
        }),
      ).rejects.toMatchObject({ cause: { message: 'broken variant' } });
    } finally {
      await t.client.exec('DROP TRIGGER reject_broken ON catalog_variants');
    }

    expect(await t.db.select().from(catalogProducts)).toHaveLength(0);
    expect(await t.db.select().from(catalogVariants)).toHaveLength(0);
    expect(await t.db.select().from(catalogPrices)).toHaveLength(0);
  });

  it('refuses an empty productUid', async () => {
    await expect(
      seedCatalog(t.db, { catalog: CATALOG, production: false, resolveVariant: fixed(' ') }),
    ).rejects.toThrow(CatalogSeedError);
  });

  it('rejects invalid definitions', async () => {
    await expect(
      seedCatalog(t.db, {
        catalog: withVariant({ widthMm: 0 }),
        production: false,
        resolveVariant: fixed('uid'),
      }),
    ).rejects.toThrow(/size must be positive/);
  });

  it('passes Gelato warnings back to the caller', async () => {
    const { options } = gelatoBacked(
      gelatoCanvasRoutes({
        products: [
          {
            productUid: FIXTURE_CANVAS_PRODUCT_UID,
            attributes: {},
            supportedCountries: ['IL'],
          },
        ],
      }),
    );
    const result = await seedCatalog(t.db, options());
    expect(result.warnings.join()).toMatch(/size not cross-checked/);
    const [variant] = await t.db
      .select()
      .from(catalogVariants)
      .where(eq(catalogVariants.sku, 'CANVAS-30X30-SLIM'));
    expect(variant!.gelatoProductUid).toBe(FIXTURE_CANVAS_PRODUCT_UID);
  });
});

import {
  catalogProblems,
  type CatalogProductDefinition,
  type CatalogVariantDefinition,
} from '@chatprint/shared';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { catalogPrices, catalogProducts, catalogVariants } from './schema.js';

export interface ResolvedVariant {
  gelatoProductUid: string;
  warnings: readonly string[];
}

export interface SeedCatalogOptions {
  catalog: readonly CatalogProductDefinition[];
  /** Looks up the variant's Gelato productUid (through the product API in the app). */
  resolveVariant: (variant: CatalogVariantDefinition) => Promise<ResolvedVariant>;
  production: boolean;
}

export interface SeedCatalogResult {
  variants: { sku: string; gelatoProductUid: string }[];
  warnings: string[];
}

export class CatalogSeedError extends Error {
  override name = 'CatalogSeedError';
}

/**
 * Writes the catalog definitions to the database. Idempotent: upserts by SKU,
 * replaces prices, and marks products or variants no longer defined inactive
 * (never deletes them, since orders reference them). All Gelato lookups run
 * before the transaction opens; any failure leaves the database untouched.
 */
export async function seedCatalog(
  db: Database,
  options: SeedCatalogOptions,
): Promise<SeedCatalogResult> {
  const { catalog } = options;
  const problems = catalogProblems(catalog);
  if (problems.length > 0) {
    throw new CatalogSeedError(`Catalog definitions are invalid:\n  - ${problems.join('\n  - ')}`);
  }

  const placeholders = catalog.flatMap((product) =>
    product.variants.flatMap((variant) =>
      variant.retailPrices.filter((p) => p.placeholder).map((p) => `${variant.sku} ${p.currency}`),
    ),
  );
  if (options.production && placeholders.length > 0) {
    throw new CatalogSeedError(
      `Refusing to seed placeholder prices in production: ${placeholders.join(', ')}. ` +
        'Set the real price list first.',
    );
  }

  const resolved = new Map<string, ResolvedVariant>();
  for (const product of catalog) {
    for (const variant of product.variants) {
      const result = await options.resolveVariant(variant);
      if (result.gelatoProductUid.trim() === '') {
        throw new CatalogSeedError(`No Gelato productUid resolved for ${variant.sku}`);
      }
      resolved.set(variant.sku, result);
    }
  }
  const productUidOf = (sku: string): string => {
    const result = resolved.get(sku);
    if (result === undefined) throw new CatalogSeedError(`${sku} was not resolved`);
    return result.gelatoProductUid;
  };

  await db.transaction(async (tx) => {
    for (const product of catalog) {
      const [row] = await tx
        .insert(catalogProducts)
        .values({ sku: product.sku, type: product.type, nameKey: product.nameKey, active: true })
        .onConflictDoUpdate({
          target: catalogProducts.sku,
          set: {
            type: product.type,
            nameKey: product.nameKey,
            active: true,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: catalogProducts.id });
      if (row === undefined) throw new CatalogSeedError(`Upsert of ${product.sku} returned no row`);

      for (const variant of product.variants) {
        const values = {
          productId: row.id,
          sku: variant.sku,
          widthMm: variant.widthMm,
          heightMm: variant.heightMm,
          color: variant.color,
          printAreas: [...variant.printAreas],
          fileRequirements: variant.fileRequirements,
          gelatoProductUid: productUidOf(variant.sku),
          active: true,
        };
        const [variantRow] = await tx
          .insert(catalogVariants)
          .values(values)
          .onConflictDoUpdate({
            target: catalogVariants.sku,
            set: { ...values, updatedAt: sql`now()` },
          })
          .returning({ id: catalogVariants.id });
        if (variantRow === undefined) {
          throw new CatalogSeedError(`Upsert of ${variant.sku} returned no row`);
        }

        const currencies = variant.retailPrices.map((p) => p.currency);
        await tx
          .delete(catalogPrices)
          .where(
            and(
              eq(catalogPrices.variantId, variantRow.id),
              notInArray(catalogPrices.currency, currencies),
            ),
          );
        for (const price of variant.retailPrices) {
          await tx
            .insert(catalogPrices)
            .values({
              variantId: variantRow.id,
              currency: price.currency,
              amountMinor: price.amountMinor,
            })
            .onConflictDoUpdate({
              target: [catalogPrices.variantId, catalogPrices.currency],
              set: { amountMinor: price.amountMinor, updatedAt: sql`now()` },
            });
        }
      }
    }

    const productSkus = catalog.map((p) => p.sku);
    const variantSkus = catalog.flatMap((p) => p.variants.map((v) => v.sku));
    await tx
      .update(catalogProducts)
      .set({ active: false })
      .where(notInArray(catalogProducts.sku, productSkus));
    await tx
      .update(catalogVariants)
      .set({ active: false })
      .where(notInArray(catalogVariants.sku, variantSkus));
  });

  return {
    variants: [...resolved].map(([sku, r]) => ({ sku, gelatoProductUid: r.gelatoProductUid })),
    warnings: [...resolved.values()].flatMap((r) => r.warnings),
  };
}

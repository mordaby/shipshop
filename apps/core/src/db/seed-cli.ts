import { GelatoProductApi, resolveGelatoProduct } from '@chatprint/providers';
import {
  assertConfigured,
  CATALOG,
  databaseConfig,
  DESTINATION_COUNTRIES,
  gelatoApiConfig,
  isProduction,
  readEnv,
} from '@chatprint/shared';
import { connectDatabase } from './client.js';
import { seedCatalog } from './seed-catalog.js';

// Seeds the catalog. Needs DATABASE_URL and GELATO_API_KEY: every variant's
// productUid is looked up live through Gelato's product API.
try {
  const env = readEnv();
  assertConfigured(env, ['database', 'gelato']);
  const gelato = new GelatoProductApi(gelatoApiConfig(env));
  const connection = connectDatabase(databaseConfig(env));
  try {
    const result = await seedCatalog(connection.db, {
      catalog: CATALOG,
      production: isProduction(env),
      resolveVariant: (variant) =>
        resolveGelatoProduct(gelato, {
          sku: variant.sku,
          lookup: variant.gelato,
          sizeMm: { width: variant.widthMm, height: variant.heightMm },
          countries: DESTINATION_COUNTRIES,
        }).then((r) => ({ gelatoProductUid: r.productUid, warnings: r.warnings })),
    });
    for (const variant of result.variants) {
      console.log(`${variant.sku} -> Gelato ${variant.gelatoProductUid}`);
    }
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    console.log('Catalog seeded.');
  } finally {
    await connection.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

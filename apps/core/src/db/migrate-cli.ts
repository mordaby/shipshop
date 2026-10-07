import { databaseConfig, readEnv } from '@chatprint/shared';
import { migrateDatabase } from './migrate.js';

try {
  await migrateDatabase(databaseConfig(readEnv()));
  console.log('Database migrated.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

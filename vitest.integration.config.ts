import { defineConfig } from 'vitest/config';

// Integration tests against the docker-compose services (Postgres and the
// S3-compatible store). Start them with `pnpm services:up`; the tests read
// DATABASE_URL and STORAGE_* from .env and fail if they are missing.
export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.integration.test.ts'],
    env: loadDotEnv(),
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

function loadDotEnv(): Record<string, string> {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {};
}

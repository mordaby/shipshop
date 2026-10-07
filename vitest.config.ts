import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests: no network, no running services. External HTTP is mocked;
// database tests run on PGlite (Postgres compiled to WebAssembly).
// Integration tests (*.integration.test.ts) run with vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
  },
});

import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` diffs src/db/schema.ts against the last snapshot and
// writes a SQL migration. It needs no database. Apply with `pnpm db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});

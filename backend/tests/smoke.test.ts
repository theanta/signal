import { config } from 'dotenv';
import path from 'path';
import { afterAll, expect, it } from 'vitest';
import { sql, closePool } from './helpers/db';
import { projectRef } from './setup';

afterAll(async () => {
  await closePool();
});

it('connects to the test database', async () => {
  const result = await sql('SELECT current_database() AS db');
  expect(result.rows[0].db).toBe('postgres');
});

// Deliberately NOT `process.env.SUPABASE_URL`: since Task 6, tests/setup.ts
// aliases that name onto the TEST project on purpose, so the modules under
// test (tenantContext, supabaseAdmin) read the test project through the names
// they actually use. Comparing against it would compare the test URL with
// itself and pass vacuously. The production value lives in the repo-root .env,
// or ambient in CI — snapshotted by setup.ts before the aliasing.
it('is not pointed at the production project', () => {
  const prod = config({ path: path.resolve(__dirname, '../../.env'), processEnv: {} });
  const prodUrl = prod.parsed?.SUPABASE_URL ?? process.env.__AMBIENT_PROD_SUPABASE_URL;
  if (!prodUrl) return; // no production reference available to compare against
  expect(process.env.SUPABASE_TEST_URL).not.toBe(prodUrl);
  expect(projectRef(process.env.SUPABASE_TEST_URL)).not.toBe(projectRef(prodUrl));
});

import { afterAll, expect, it } from 'vitest';
import { sql, closePool } from './helpers/db';

afterAll(async () => {
  await closePool();
});

it('connects to the test database', async () => {
  const result = await sql('SELECT current_database() AS db');
  expect(result.rows[0].db).toBe('postgres');
});

it('is not pointed at the production project', () => {
  expect(process.env.SUPABASE_TEST_URL).not.toBe(process.env.SUPABASE_URL);
});

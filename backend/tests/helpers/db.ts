import { Pool, QueryResult } from 'pg';

// supabase-js cannot run DDL, and the RLS suites need to assert against raw
// Postgres. A direct connection to the test project covers both.
const pool = new Pool({
  connectionString: process.env.SUPABASE_TEST_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
});

export function sql(text: string, params: unknown[] = []): Promise<QueryResult> {
  return pool.query(text, params);
}

export function closePool(): Promise<void> {
  return pool.end();
}

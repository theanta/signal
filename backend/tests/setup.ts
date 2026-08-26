import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../../.env.test') });

const REQUIRED = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_JWT_SECRET',
  'SUPABASE_TEST_DB_URL',
];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(
      `${key} is not set. Copy .env.test.example to .env.test and fill it in ` +
      `from the anta-lead-radar-test Supabase project.`,
    );
  }
}

// Extracts the Supabase project ref from either URL shape so an API URL and
// a DB URL from the same project can be compared directly:
//   https://<ref>.supabase.co
//   postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
export function projectRef(url: string | undefined): string | null {
  if (!url) return null;
  const apiMatch = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (apiMatch) return apiMatch[1];
  const dbMatch = url.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
  if (dbMatch) return dbMatch[1];
  return null;
}

// Guard against ever running the destructive suites against production.
// Load the app's .env explicitly (into a throwaway object, not process.env)
// so the comparison has something to compare against — relying on
// SUPABASE_URL being ambient meant the guard silently no-op'd whenever the
// app's own .env hadn't happened to be loaded first, the normal state for
// a bare `npx vitest run`. Fail closed: an unparseable ref on either side
// stops the run rather than skipping the check.
const prod = config({ path: path.resolve(__dirname, '../../.env'), processEnv: {} });
const prodRef = prod.parsed ? projectRef(prod.parsed.SUPABASE_URL) : null;

if (prod.parsed?.SUPABASE_URL && !prodRef) {
  throw new Error('.env has a SUPABASE_URL that could not be parsed for a project ref — refusing to run.');
}

if (prodRef) {
  for (const [varName, value] of [
    ['SUPABASE_TEST_URL', process.env.SUPABASE_TEST_URL],
    ['SUPABASE_TEST_DB_URL', process.env.SUPABASE_TEST_DB_URL],
  ] as const) {
    const ref = projectRef(value);
    if (!ref) {
      throw new Error(`${varName} could not be parsed for a project ref — refusing to run.`);
    }
    if (ref === prodRef) {
      throw new Error(
        `${varName} points at the production project (ref matches SUPABASE_URL) — ` +
        'refusing to run: these suites truncate tables and drop the schema.',
      );
    }
  }
}

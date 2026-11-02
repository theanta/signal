import { config } from 'dotenv';
import path from 'path';

// setup.ts runs once per test FILE, but process.env persists for the whole
// worker. The block at the bottom of this file overwrites SUPABASE_URL with
// the TEST project's URL, so by the second file the ambient value is no longer
// production's. Snapshot it on the first run (behind a marker so a later,
// already-overwritten value can never be mistaken for production) and let the
// guard below compare against the snapshot.
if (!process.env.__SETUP_ENV_SNAPSHOT_TAKEN) {
  process.env.__SETUP_ENV_SNAPSHOT_TAKEN = '1';
  if (process.env.SUPABASE_URL) {
    process.env.__AMBIENT_PROD_SUPABASE_URL = process.env.SUPABASE_URL;
  }
}

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

// Extracts the Supabase project ref from any of three URL shapes so an API URL
// and a DB URL from the same project can be compared directly:
//   https://<ref>.supabase.co
//   postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
//   postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
//
// The third shape is the connection pooler, where the ref moves out of the
// hostname and into the username. It has to be parsed because the direct
// `db.<ref>.supabase.co` host is IPv6-only and unreachable from an IPv4-only
// network — see HANDOFF.md. Note this ADDS a recognised shape rather than
// relaxing anything: an unrecognised URL still returns null, and the caller
// still fails closed on null.
export function projectRef(url: string | undefined): string | null {
  if (!url) return null;
  const apiMatch = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (apiMatch) return apiMatch[1];
  const dbMatch = url.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
  if (dbMatch) return dbMatch[1];
  // `.*@` (greedy) rather than `[^@]*@`: this project's DB password contains a
  // literal `@`, so anchoring on the FIRST `@` finds the one inside the password
  // and never reaches the host. Greedy takes the last `@`, the real separator.
  const poolerMatch = url.match(/:\/\/postgres\.([a-z0-9]+):.*@[^@]*\.pooler\.supabase\.com/i);
  if (poolerMatch) return poolerMatch[1];
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
// CI supplies secrets as environment variables, not a repo-root .env file —
// when the file yields no SUPABASE_URL, fall back to the ambient
// process.env.SUPABASE_URL before concluding there is no production
// reference to compare against, so the guard still works there.
const prodUrl = prod.parsed?.SUPABASE_URL ?? process.env.__AMBIENT_PROD_SUPABASE_URL;
const prodRef = prodUrl ? projectRef(prodUrl) : null;

if (prodUrl && !prodRef) {
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

// The production guard above has already run and is the ONLY thing that reads
// the production SUPABASE_URL. From here on, the modules under test must see
// the TEST project — under the names they actually read, so the tests exercise
// the real functions rather than a copy of them.
process.env.SUPABASE_URL = process.env.SUPABASE_TEST_URL;
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_TEST_JWT_SECRET;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-login-jwt-secret';

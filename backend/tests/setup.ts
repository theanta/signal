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

// Guard against ever running the destructive suites against production.
if (process.env.SUPABASE_URL && process.env.SUPABASE_TEST_URL === process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_TEST_URL equals SUPABASE_URL — refusing to run tests against production.');
}

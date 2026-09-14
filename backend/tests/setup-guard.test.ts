import { expect, it } from 'vitest';
import { projectRef } from './setup';

it('extracts the ref from an API URL', () => {
  expect(projectRef('https://abcdefgh.supabase.co')).toBe('abcdefgh');
});

it('extracts the ref from a DB connection string', () => {
  expect(projectRef('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres')).toBe('abcdefgh');
});

it('treats an API URL and DB URL from the same project as colliding', () => {
  const apiRef = projectRef('https://abcdefgh.supabase.co');
  const dbRef = projectRef('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres');
  expect(apiRef).toBe(dbRef);
});

it('does not collide refs from different projects', () => {
  const dbRef = projectRef('postgresql://postgres:pw@db.zyxwvuts.supabase.co:5432/postgres');
  const apiRef = projectRef('https://abcdefgh.supabase.co');
  expect(dbRef).not.toBe(apiRef);
});

it('extracts the ref from a pooler connection string, where it lives in the username', () => {
  expect(
    projectRef('postgresql://postgres.abcdefgh:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres'),
  ).toBe('abcdefgh');
});

it('parses a pooler URL whose password contains a literal @', () => {
  // This project's test DB password really does contain an `@`. Anchoring the
  // pooler pattern on the first `@` finds the one inside the password, fails to
  // reach the host, returns null — and setup.ts then fails closed and refuses
  // to run every DB-backed suite. Regression guard for that exact combination.
  expect(
    projectRef('postgresql://postgres.abcdefgh:p@ssw0rd@aws-0-us-east-2.pooler.supabase.com:5432/postgres'),
  ).toBe('abcdefgh');
  // The same password against a non-Supabase pooler host must still fail closed.
  expect(
    projectRef('postgresql://postgres.abcdefgh:p@ssw0rd@aws-0-us-east-2.pooler.example.com:5432/postgres'),
  ).toBeNull();
});

it('collides a pooler URL with its own project’s API URL', () => {
  // The whole point of parsing the pooler shape: switching the test DB to the
  // pooler must not silently disarm the production-collision guard by making
  // the ref unparseable on one side.
  const poolerRef = projectRef('postgresql://postgres.abcdefgh:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres');
  expect(poolerRef).toBe(projectRef('https://abcdefgh.supabase.co'));
  expect(poolerRef).not.toBe(projectRef('https://zyxwvuts.supabase.co'));
});

it('returns null for undefined or unparseable input', () => {
  expect(projectRef(undefined)).toBeNull();
  expect(projectRef('not-a-url')).toBeNull();
  // Still fails closed on a pooler-looking host that is not Supabase's, and on
  // a Supabase pooler host whose username carries no ref.
  expect(projectRef('postgresql://postgres.abcdefgh:pw@aws-0-us-east-2.pooler.example.com:5432/postgres')).toBeNull();
  expect(projectRef('postgresql://postgres:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres')).toBeNull();
});

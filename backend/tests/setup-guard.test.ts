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

it('returns null for undefined or unparseable input', () => {
  expect(projectRef(undefined)).toBeNull();
  expect(projectRef('not-a-url')).toBeNull();
});

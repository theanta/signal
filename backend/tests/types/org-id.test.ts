import { expect, it } from 'vitest';
import { asOrgId } from '../../../shared/types';

it('rejects a value that is not a UUID', () => {
  expect(() => asOrgId('not-a-uuid')).toThrow(/OrgId/);
});

it('rejects an empty string', () => {
  expect(() => asOrgId('')).toThrow(/OrgId/);
});

it('returns the same string for a valid UUID', () => {
  const uuid = '3f0a2c1e-9b6d-4f2a-8c1b-5d7e9a0b1c2d';
  expect(asOrgId(uuid)).toBe(uuid);
});

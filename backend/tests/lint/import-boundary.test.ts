import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, expect, it } from 'vitest';

const dir = mkdtempSync(path.join(tmpdir(), 'anta-lint-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function lint(relativePath: string, source: string): string {
  const file = path.join(__dirname, '../..', relativePath);
  writeFileSync(file, source);
  try {
    execFileSync('npx', ['eslint', '--format', 'json', file], {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf8',
    });
    return '';
  } catch (err) {
    return String((err as { stdout?: string }).stdout ?? '');
  } finally {
    rmSync(file, { force: true });
  }
}

it('forbids importing supabaseAdmin from a controller', () => {
  const out = lint(
    'controllers/__lintProbe.ts',
    `import { supabaseAdmin } from '../services/supabaseAdmin';\nexport const x = supabaseAdmin;\n`,
  );
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids importing supabaseAdmin from a route', () => {
  const out = lint(
    'routes/__lintProbe.ts',
    `import { supabaseAdmin } from '../services/supabaseAdmin';\nexport const x = supabaseAdmin;\n`,
  );
  expect(out).toMatch(/no-restricted-imports/);
});

it('allows importing supabaseAdmin from a service', () => {
  const out = lint(
    'services/__lintProbe.ts',
    `import { supabaseAdmin } from './supabaseAdmin';\nexport const x = supabaseAdmin;\n`,
  );
  expect(out).not.toMatch(/no-restricted-imports/);
});

import { execFileSync } from 'child_process';
import { existsSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { expect, it } from 'vitest';

const backendRoot = path.join(__dirname, '../..');

// Probe files are written into the live source tree (ESLint's fenced
// directories don't exist as a scratch copy) and removed in a `finally`
// below. If a run is ever killed between `writeFileSync` and that `finally`,
// a stray `__lintProbe*.ts` would sit in `controllers/`, `routes/`, or
// `services/` and break `npm run lint` / `tsc` for the next person. Guard
// against that by self-healing any leftovers from a previous crashed run
// before this run starts, plus a `process.on('exit', ...)` handler below as
// a last-resort net for this run. Deliberately NOT `SIGINT`/`SIGTERM`
// handlers: registering either one suppresses Node's default
// immediate-terminate behavior for that signal, so a bare `cleanupActiveProbe()`
// call with no `process.exit()` would make Ctrl+C stop killing the process —
// a worse hazard than the stray file this exists to prevent.
const PROBE_GLOB_DIRS = ['controllers', 'routes', 'services', 'api/middleware'];
const PROBE_NAME = '__lintProbe.ts';

function strayProbePaths(): string[] {
  return PROBE_GLOB_DIRS.map((dir) => path.join(backendRoot, dir, PROBE_NAME)).filter(
    existsSync,
  );
}

// Self-heal: a previous run that was killed mid-test leaves exactly this file
// shape behind. Clean it up before we add our own.
strayProbePaths().forEach((p) => rmSync(p, { force: true }));

let activeProbeFile: string | null = null;
function cleanupActiveProbe(): void {
  if (activeProbeFile) {
    rmSync(activeProbeFile, { force: true });
    activeProbeFile = null;
  }
}
process.on('exit', cleanupActiveProbe);

function lint(dir: string, source: string): string {
  const file = path.join(backendRoot, dir, PROBE_NAME);
  activeProbeFile = file;
  writeFileSync(file, source);
  try {
    execFileSync('npx', ['eslint', '--format', 'json', file], {
      cwd: backendRoot,
      encoding: 'utf8',
    });
    return '';
  } catch (err) {
    return String((err as { stdout?: string }).stdout ?? '');
  } finally {
    cleanupActiveProbe();
  }
}

const IMPORT_LINE = `import { supabaseAdmin } from '../services/supabaseAdmin';`;
const NESTED_IMPORT_LINE = `import { supabaseAdmin } from '../../../services/supabaseAdmin';`;
const ALIAS_IMPORT_LINE = `import { supabaseAdmin } from '@/services/supabaseAdmin';`;
const TYPE_IMPORT_LINE = `import type { SupabaseClient } from '../services/supabaseAdmin';`;
const EXPORT_FROM_LINE = `export { supabaseAdmin } from '../services/supabaseAdmin';`;
const DOT_JS_IMPORT_LINE = `import { supabaseAdmin } from '../services/supabaseAdmin.js';`;
const DYNAMIC_IMPORT_SOURCE = `export async function f() {\n  const mod = await import('../services/supabaseAdmin');\n  return mod;\n}\n`;

it('forbids importing supabaseAdmin from a controller', () => {
  const out = lint('controllers', `${IMPORT_LINE}\nexport const x = supabaseAdmin;\n`);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids importing supabaseAdmin from a route', () => {
  const out = lint('routes', `${IMPORT_LINE}\nexport const x = supabaseAdmin;\n`);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids a nested relative path to supabaseAdmin', () => {
  const out = lint('controllers', `${NESTED_IMPORT_LINE}\nexport const x = supabaseAdmin;\n`);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids an aliased path to supabaseAdmin', () => {
  const out = lint('controllers', `${ALIAS_IMPORT_LINE}\nexport const x = supabaseAdmin;\n`);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids a type-only import of supabaseAdmin', () => {
  const out = lint('controllers', `${TYPE_IMPORT_LINE}\nexport const y: SupabaseClient | undefined = undefined;\n`);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids re-exporting supabaseAdmin', () => {
  const out = lint('controllers', EXPORT_FROM_LINE);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids an explicit .js extension on the supabaseAdmin specifier', () => {
  const out = lint('controllers', `${DOT_JS_IMPORT_LINE}\nexport const x = supabaseAdmin;\n`);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids a dynamic import() of supabaseAdmin', () => {
  const out = lint('controllers', DYNAMIC_IMPORT_SOURCE);
  expect(out).toMatch(/no-restricted-syntax/);
});

it('allows importing supabaseAdmin from a service, and services/ lints clean', () => {
  const out = lint('services', `import { supabaseAdmin } from './supabaseAdmin';\nexport const x = supabaseAdmin;\n`);
  expect(out).toBe('');
});

const TC_IMPORT_LINE = `import { createTenantContext } from '../services/tenantContext';`;
const TC_DOT_JS_IMPORT_LINE = `import { createTenantContext } from '../services/tenantContext.js';`;
const TC_DYNAMIC_IMPORT_SOURCE = `export async function f() {\n  const mod = await import('../services/tenantContext');\n  return mod;\n}\n`;

it('forbids importing tenantContext from a controller', () => {
  const out = lint('controllers', `${TC_IMPORT_LINE}\nexport const x = createTenantContext;\n`);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids an explicit .js extension on the tenantContext specifier', () => {
  const out = lint('controllers', `${TC_DOT_JS_IMPORT_LINE}\nexport const x = createTenantContext;\n`);
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids a dynamic import() of tenantContext', () => {
  const out = lint('controllers', TC_DYNAMIC_IMPORT_SOURCE);
  expect(out).toMatch(/no-restricted-syntax/);
});

it('allows importing tenantContext from api/middleware/ (the legitimate caller)', () => {
  const out = lint('api/middleware', `${TC_IMPORT_LINE}\nexport const x = createTenantContext;\n`);
  expect(out).toBe('');
});

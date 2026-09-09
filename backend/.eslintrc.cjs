/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2020: true },
  ignorePatterns: ['dist/', 'node_modules/', 'tests/'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // `while (true)` is the idiomatic shape for the SSE/stream-reader loops in
    // this codebase (routes/signals.ts, controllers/leadsController.ts) — allow it.
    'no-constant-condition': ['error', { checkLoops: false }],
    // Express's own type-augmentation pattern (api/middleware/auth.ts) requires
    // `declare global { namespace Express { ... } }`. The rule's own
    // `allowDeclarations` option covers exactly this ambient-declaration case,
    // so the rule stays on and still catches a plain runtime namespace elsewhere.
    '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
  },
  overrides: [
    {
      // The service-role client bypasses RLS. Request-handling code must reach
      // the database through a TenantContext, never around it — this makes that
      // a CI failure instead of a code-review habit.
      files: ['controllers/**/*.ts', 'routes/**/*.ts', 'api/**/*.ts'],
      rules: {
        // `no-restricted-imports` only sees static import/export declarations,
        // and its `group` patterns are extension-sensitive — so both an
        // explicit `.js` specifier (TS resolves it to the `.ts` file under
        // `module: commonjs`) and a bare-alias path can slip past a
        // single-pattern fence. The three patterns below cover: no extension,
        // an explicit `.js`/`.ts` extension, and any path (relative, nested,
        // or `@/`-aliased) ending in `services/supabaseAdmin*`.
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['**/supabaseAdmin', '**/supabaseAdmin.{js,ts}', '**/services/supabaseAdmin*'],
            message:
              'supabaseAdmin bypasses RLS. Use a TenantContext-scoped function ' +
              'from supabaseService instead. Genuine exceptions (auth, cron, ' +
              'engine callbacks) belong in services/ or scripts/.',
          }],
        }],
        // `no-restricted-imports` never sees `await import(...)` — it is an
        // expression, not a declaration — so a dynamic import is a second,
        // separate bypass of the fence above. Close it with a syntax rule.
        'no-restricted-syntax': ['error', {
          selector: "ImportExpression[source.value=/supabaseAdmin/]",
          message:
            'supabaseAdmin bypasses RLS. Use a TenantContext-scoped function ' +
            'from supabaseService instead. Genuine exceptions (auth, cron, ' +
            'engine callbacks) belong in services/ or scripts/.',
        }],
      },
    },
  ],
};

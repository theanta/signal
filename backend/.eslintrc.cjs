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
    // `declare global { namespace Express { ... } }` — there is no ES-module
    // equivalent, so this rule can't be satisfied by rewriting the code.
    '@typescript-eslint/no-namespace': 'off',
  },
  overrides: [
    {
      // The service-role client bypasses RLS. Request-handling code must reach
      // the database through a TenantContext, never around it — this makes that
      // a CI failure instead of a code-review habit.
      files: ['controllers/**/*.ts', 'routes/**/*.ts', 'api/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['**/supabaseAdmin', '**/services/supabaseAdmin'],
            message:
              'supabaseAdmin bypasses RLS. Use a TenantContext-scoped function ' +
              'from supabaseService instead. Genuine exceptions (auth, cron, ' +
              'engine callbacks) belong in services/ or scripts/.',
          }],
        }],
      },
    },
  ],
};

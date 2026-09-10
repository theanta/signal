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
      //
      // createTenantContext(orgId: string, userId: string) takes a plain
      // string and only validates UUID *shape* — no existence or membership
      // check. Its only legitimate caller is the auth middleware, minting a
      // context from a verified login token's payload. A controller (or a
      // route/other api file) that imports it directly can mint a valid
      // cross-tenant context from e.g. req.body.orgId, and the RLS policies
      // arriving in Task 14 will honour it without complaint. Fence it the
      // same way supabaseAdmin is fenced below.
      //
      // Both fences live in this one override deliberately: ESLint merges
      // overlapping `overrides` blocks per rule name, not per pattern entry —
      // a second block matching the same files with its own
      // `no-restricted-imports`/`no-restricted-syntax` config would *replace*
      // this one for those rules, not add to it. Keeping both fences' pattern
      // objects inside the same rule call is what makes them additive.
      //
      // api/middleware/** is excluded from the *tenantContext* half only
      // (it's the one legitimate caller, api/middleware/auth.ts) but must
      // stay fenced from supabaseAdmin — see the second override below,
      // which re-applies just the supabaseAdmin half there.
      files: ['controllers/**/*.ts', 'routes/**/*.ts', 'api/**/*.ts'],
      excludedFiles: ['api/middleware/**'],
      rules: {
        // `no-restricted-imports` only sees static import/export declarations,
        // and its `group` patterns are extension-sensitive — so both an
        // explicit `.js` specifier (TS resolves it to the `.ts` file under
        // `module: commonjs`) and a bare-alias path can slip past a
        // single-pattern fence. Each pattern object below covers, per target:
        // no extension, an explicit `.js`/`.ts` extension, and any path
        // (relative, nested, or `@/`-aliased) ending in `services/<name>*`.
        'no-restricted-imports': ['error', {
          patterns: [
            {
              group: ['**/supabaseAdmin', '**/supabaseAdmin.{js,ts}', '**/services/supabaseAdmin*'],
              message:
                'supabaseAdmin bypasses RLS. Use a TenantContext-scoped function ' +
                'from supabaseService instead. Genuine exceptions (auth, cron, ' +
                'engine callbacks) belong in services/ or scripts/.',
            },
            {
              group: ['**/tenantContext', '**/tenantContext.{js,ts}', '**/services/tenantContext*'],
              message:
                'tenantContext mints an org-scoped session from a plain string ' +
                'with no membership check. Only the auth middleware may call ' +
                'createTenantContext, from a verified token payload — a ' +
                'controller must read the context off req.ctx (see ctxOf in ' +
                'api/middleware/auth.ts) instead of minting its own.',
            },
          ],
        }],
        // `no-restricted-imports` never sees `await import(...)` — it is an
        // expression, not a declaration — so a dynamic import is a second,
        // separate bypass of each fence above. Close it with a syntax rule
        // per target (the rule accepts multiple config objects).
        'no-restricted-syntax': ['error',
          {
            selector: "ImportExpression[source.value=/supabaseAdmin/]",
            message:
              'supabaseAdmin bypasses RLS. Use a TenantContext-scoped function ' +
              'from supabaseService instead. Genuine exceptions (auth, cron, ' +
              'engine callbacks) belong in services/ or scripts/.',
          },
          {
            selector: "ImportExpression[source.value=/tenantContext/]",
            message:
              'tenantContext mints an org-scoped session from a plain string ' +
              'with no membership check. Only the auth middleware may call ' +
              'createTenantContext, from a verified token payload — a ' +
              'controller must read the context off req.ctx (see ctxOf in ' +
              'api/middleware/auth.ts) instead of minting its own.',
          },
        ],
      },
    },
    {
      // api/middleware/** was excluded above so the legitimate tenantContext
      // caller (api/middleware/auth.ts) can import it. That exclusion also
      // lifted the supabaseAdmin fence for the whole directory as a side
      // effect of how the override matched — re-apply just the supabaseAdmin
      // half here so middleware stays held to the same RLS-bypass rule as
      // every other request-handling file.
      files: ['api/middleware/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['**/supabaseAdmin', '**/supabaseAdmin.{js,ts}', '**/services/supabaseAdmin*'],
            message:
              'supabaseAdmin bypasses RLS. Use a TenantContext-scoped function ' +
              'from supabaseService instead. Genuine exceptions (auth, cron, ' +
              'engine callbacks) belong in services/ or scripts/.',
          }],
        }],
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

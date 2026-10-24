#!/usr/bin/env bash
# Proves supabase/schema.sql and supabase/migrations/ still describe the same
# database. Non-destructive: it builds two THROWAWAY databases on a LOCAL
# postgres and never touches any Supabase project.
#
#   DB_A ("production upgrade" path): the pre-tenancy schema.sql, plus every
#         migration in supabase/migrations/README.md's chronological order,
#         plus 2026-08-26_tenancy_foundation.sql, 2026-10-24_drop_job_postings.sql,
#         2026-08-26_rls_policies.sql and 2026-10-24_scrape_job_store.sql.
#   DB_B ("fresh build" path):        the current supabase/schema.sql, alone.
#
# Then it diffs `pg_dump --schema-only` of the two. See
# supabase/migrations/README.md #4 for the one enumerated divergence that is
# expected (org_id's column ordinal position) and for what must stay aligned.
#
# Usage:  bash supabase/schema-parity-check.sh
# Requires: a local postgres 16 with the vector and uuid-ossp extensions
# available, and psql/pg_dump/createdb/dropdb on PATH.
set -uo pipefail
cd "$(dirname "$0")/.."

DB_A=${DB_A:-signal_parity_migrations}
DB_B=${DB_B:-signal_parity_schema}
# The pre-tenancy schema.sql. Overridable so this keeps working as history moves.
PRE_TENANCY_REV=${PRE_TENANCY_REV:-dd6f19f^}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Supabase's RLS policies call auth.role(), and schema.sql/the migrations use
# gen_random_uuid + uuid-ossp. Stub the auth schema identically in BOTH
# databases so the stub cancels out of the diff.
cat > "$WORK/bootstrap.sql" <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT 'service_role'::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT '{}'::jsonb $$;
SQL

git show "$PRE_TENANCY_REV:supabase/schema.sql" > "$WORK/schema_pre_tenancy.sql" || {
  echo "Cannot read supabase/schema.sql at $PRE_TENANCY_REV — set PRE_TENANCY_REV." >&2
  exit 1
}

dropdb --if-exists "$DB_A" >/dev/null 2>&1
dropdb --if-exists "$DB_B" >/dev/null 2>&1
createdb "$DB_A" || exit 1
createdb "$DB_B" || exit 1

echo "=== DB_A ($DB_A): pre-tenancy schema.sql + migrations + tenancy migration ==="
psql -q -d "$DB_A" -v ON_ERROR_STOP=1 -f "$WORK/bootstrap.sql" || exit 1
psql -q -d "$DB_A" -v ON_ERROR_STOP=1 -f "$WORK/schema_pre_tenancy.sql" >/dev/null || exit 1

MIGRATION_FILES=()
while IFS= read -r f; do
  [ -n "$f" ] && MIGRATION_FILES+=("$f")
done < <(grep -oE '^[A-Za-z0-9_.-]+\.sql$' supabase/migrations/README.md)
[ "${#MIGRATION_FILES[@]}" -ge 10 ] || {
  echo "Expected >=10 migration filenames from README.md, got ${#MIGRATION_FILES[@]}." >&2
  exit 1
}
echo "replaying ${#MIGRATION_FILES[@]} migrations in README order"
for f in "${MIGRATION_FILES[@]}"; do
  out="$(psql -q -d "$DB_A" -f "supabase/migrations/$f" 2>&1)"
  err="$(printf '%s\n' "$out" | grep -E 'ERROR:' || true)"
  [ -n "$err" ] && { echo "--- $f"; printf '%s\n' "$err"; }
done

# README #2: the pre-tenancy schema.sql and add_platform_config.sql both seed
# platform_config, and the tenancy migration's UNIQUE (org_id) then fails.
psql -q -d "$DB_A" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM platform_config WHERE id NOT IN (SELECT id FROM platform_config ORDER BY created_at ASC LIMIT 1);" || exit 1
psql -q -d "$DB_A" -v ON_ERROR_STOP=1 -f supabase/migrations/2026-08-26_tenancy_foundation.sql || exit 1
psql -q -d "$DB_A" -v ON_ERROR_STOP=1 -f supabase/migrations/2026-10-24_drop_job_postings.sql >/dev/null || exit 1
psql -q -d "$DB_A" -v ON_ERROR_STOP=1 -f supabase/migrations/2026-08-26_rls_policies.sql >/dev/null || exit 1
psql -q -d "$DB_A" -v ON_ERROR_STOP=1 -f supabase/migrations/2026-10-24_scrape_job_store.sql >/dev/null || exit 1

echo "=== DB_B ($DB_B): schema.sql alone ==="
psql -q -d "$DB_B" -v ON_ERROR_STOP=1 -f "$WORK/bootstrap.sql" || exit 1
psql -q -d "$DB_B" -v ON_ERROR_STOP=1 -f supabase/schema.sql >/dev/null || exit 1

# \restrict/\unrestrict carry a per-dump random nonce; strip them.
pg_dump --schema-only --no-owner --no-acl --no-comments -d "$DB_A" \
  | grep -v '^\\restrict\|^\\unrestrict' > "$WORK/a.sql"
pg_dump --schema-only --no-owner --no-acl --no-comments -d "$DB_B" \
  | grep -v '^\\restrict\|^\\unrestrict' > "$WORK/b.sql"

echo "=== DIFF: migrations path -> schema.sql path ==="
diff -u "$WORK/a.sql" "$WORK/b.sql"
rc=$?
dropdb --if-exists "$DB_A" >/dev/null 2>&1
dropdb --if-exists "$DB_B" >/dev/null 2>&1
if [ "$rc" -eq 0 ]; then
  echo "IDENTICAL."
else
  echo "=== The ONLY expected hunks are org_id's ordinal position (12 tables +"
  echo "=== the hot_leads view). Anything else is real drift — see README.md #4."
fi
exit "$rc"

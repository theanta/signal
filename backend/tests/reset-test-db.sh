#!/usr/bin/env bash
# Resets the Supabase TEST project to a clean schema. Destructive by design.
#
# It cannot rely on tests/setup.ts's production guard: that guard compares
# against the repo-root .env, which need not exist. Instead this asserts the
# two test variables describe one and the same project — a production
# connection string beside a test API URL fails that, with no knowledge of
# what production is.
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env.test ] || { echo "No .env.test — see .env.test.example" >&2; exit 1; }

# Preserve any values already exported by the invoking shell (used to prove
# the refusal path below without ever editing .env.test) so sourcing the
# file cannot silently clobber them — an explicit override always wins over
# the file's own value.
_override_db_url="${SUPABASE_TEST_DB_URL:-}"
_override_api_url="${SUPABASE_TEST_URL:-}"
set -a; . ./.env.test; set +a
[ -n "$_override_db_url" ] && SUPABASE_TEST_DB_URL="$_override_db_url"
[ -n "$_override_api_url" ] && SUPABASE_TEST_URL="$_override_api_url"

ref_of() { printf '%s' "$1" | sed -nE 's#.*[/@](db\.)?([a-z0-9]{16,})\.supabase\.(co|com).*#\2#p'; }

api_ref="$(ref_of "${SUPABASE_TEST_URL:-}")"
db_ref="$(ref_of "${SUPABASE_TEST_DB_URL:-}")"

[ -n "$api_ref" ] || { echo "Cannot parse a project ref from SUPABASE_TEST_URL" >&2; exit 1; }
[ -n "$db_ref" ]  || { echo "Cannot parse a project ref from SUPABASE_TEST_DB_URL" >&2; exit 1; }
[ "$api_ref" = "$db_ref" ] || {
  echo "REFUSING TO DROP: SUPABASE_TEST_DB_URL is project '$db_ref' but" >&2
  echo "SUPABASE_TEST_URL is project '$api_ref'. They must be the same project." >&2
  exit 1
}

# libpq's own URI parser (used by the psql CLI, unlike node-postgres) splits
# userinfo/host on the FIRST "@", not the last. A password containing a
# literal, un-percent-encoded "@" (as this project's does) then gets
# mis-parsed into the hostname and every psql call below fails with
# "could not translate host name". Percent-encode any "@" that appears
# before the real (last) "@" delimiter, in-memory only — .env.test itself is
# never touched.
urlencode_at() {
  local url="$1"
  local scheme="${url%%://*}"
  local rest="${url#*://}"
  local hostpart="${rest##*@}"
  local userinfo="${rest%@*}"
  printf '%s://%s@%s' "$scheme" "${userinfo//@/%40}" "$hostpart"
}
PSQL_DB_URL="$(urlencode_at "$SUPABASE_TEST_DB_URL")"

echo "About to DROP SCHEMA public CASCADE on project: $api_ref"
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
# Chronological order, per supabase/migrations/README.md — NOT alphabetical:
# jobs-dependent migrations sort before the one that creates `jobs`.
while read -r f; do
  [ -n "$f" ] && psql "$PSQL_DB_URL" -f "supabase/migrations/$f"
done < <(grep -oE '^[A-Za-z0-9_.-]+\.sql$' supabase/migrations/README.md)

# Both schema.sql and add_platform_config.sql seed platform_config, and the
# pre-tenancy table has no unique constraint for ON CONFLICT to bite on, so a
# replay leaves two rows and UNIQUE (org_id) below fails. See README.md.
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM platform_config a USING platform_config b WHERE a.ctid < b.ctid;"
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/2026-08-26_tenancy_foundation.sql

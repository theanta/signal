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

# .env.test is authoritative. A shell-exported SUPABASE_TEST_DB_URL /
# SUPABASE_TEST_URL is honoured ONLY when RESET_DB_ALLOW_ENV_OVERRIDE=1 is
# also set (used to prove the refusal path below without ever editing
# .env.test) — without that opt-in, sourcing the file always wins, so a
# stray environment variable (direnv, a stale export, CI secrets, an earlier
# `. .env`) can never silently substitute a different project. This was a
# real gap in an earlier draft: unconditionally restoring any pre-set value
# after sourcing meant a *consistent* production pair exported in the shell
# passed the "do the two vars agree" gate and proceeded, with the file
# contributing nothing but the existence check above.
_override_db_url="${SUPABASE_TEST_DB_URL:-}"
_override_api_url="${SUPABASE_TEST_URL:-}"
set -a; . ./.env.test; set +a
if [ "${RESET_DB_ALLOW_ENV_OVERRIDE:-}" = "1" ]; then
  [ -n "$_override_db_url" ] && SUPABASE_TEST_DB_URL="$_override_db_url"
  [ -n "$_override_api_url" ] && SUPABASE_TEST_URL="$_override_api_url"
fi

# Anchored on the host label immediately before .supabase.co/.com, not "the
# last such substring anywhere in the string" — a path or query segment
# after the real host could otherwise win. This intentionally returns empty
# (and so refuses, via the checks below) for pooler hosts
# (aws-0-*.pooler.supabase.com), bare IPs, localhost, and custom domains —
# none of those carry a parseable project ref, so the script cannot verify
# them and treats them as unusable rather than guessing. That means this
# script does NOT work with the pooler connection string Supabase now
# offers by default; use the direct db.<ref>.supabase.co URL in .env.test.
# Userinfo is matched greedily up to the LAST "@" before the host, since
# this project's own SUPABASE_TEST_DB_URL password contains a literal,
# un-percent-encoded "@" (see urlencode_at below) — anchoring on the
# first "@" instead would cut the ref out of the wrong segment.
ref_of() { printf '%s' "$1" | sed -nE 's#^[a-zA-Z]+://([^/]*@)?(db\.)?([a-z0-9]{16,})\.supabase\.(co|com)(:[0-9]+)?(/.*)?$#\3#p'; }

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
# never touched. Guarded on the userinfo actually containing "@": a
# password-less URL (PGPASSWORD / .pgpass) or one with no userinfo at all
# has no "@" before the host, and blindly re-splitting it would eat the
# host into a fake "userinfo" and duplicate the whole remainder — silent
# corruption, not merely a no-op.
urlencode_at() {
  local url="$1"
  local scheme="${url%%://*}"
  local rest="${url#*://}"
  if [[ "$rest" != *@* ]]; then
    printf '%s://%s' "$scheme" "$rest"
    return
  fi
  local hostpart="${rest##*@}"
  local userinfo="${rest%@*}"
  if [[ "$userinfo" != *@* ]]; then
    # Exactly one "@" — it's already the real delimiter, nothing to fix.
    printf '%s://%s@%s' "$scheme" "$userinfo" "$hostpart"
    return
  fi
  printf '%s://%s@%s' "$scheme" "${userinfo//@/%40}" "$hostpart"
}
PSQL_DB_URL="$(urlencode_at "$SUPABASE_TEST_DB_URL")"

echo "About to DROP SCHEMA public CASCADE on project: $api_ref"
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql

# Chronological order, per supabase/migrations/README.md — NOT alphabetical:
# jobs-dependent migrations sort before the one that creates `jobs`. Read
# the whole list up front (not piped straight into the while-loop) so a
# renamed or reformatted README that yields zero — or an implausibly small
# number of — filenames aborts loudly instead of silently applying no
# migrations and exiting 0: process substitution isn't covered by
# `pipefail`, so a `while read ... < <(grep ...)` loop that matches nothing
# just runs zero times and the script sails on with the schema already
# dropped.
MIGRATION_FILES=()
while IFS= read -r f; do
  [ -n "$f" ] && MIGRATION_FILES+=("$f")
done < <(grep -oE '^[A-Za-z0-9_.-]+\.sql$' supabase/migrations/README.md)
[ "${#MIGRATION_FILES[@]}" -ge 10 ] || {
  echo "Expected at least 10 migration filenames from supabase/migrations/README.md," >&2
  echo "got ${#MIGRATION_FILES[@]}. The README's ordered list may have been renamed" >&2
  echo "or reformatted — refusing to continue with the schema already dropped." >&2
  exit 1
}
for f in "${MIGRATION_FILES[@]}"; do
  psql "$PSQL_DB_URL" -f "supabase/migrations/$f"
done

# Both schema.sql and add_platform_config.sql seed platform_config, and the
# pre-tenancy table has no unique constraint for ON CONFLICT to bite on, so a
# replay leaves two rows and UNIQUE (org_id) below fails. See README.md.
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM platform_config a USING platform_config b WHERE a.ctid < b.ctid;"
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/2026-08-26_tenancy_foundation.sql

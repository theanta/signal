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
#
# A second, subtler version of the same gap: if the two variables are
# simply ambient (already exported) and .env.test is empty, or has been
# edited so its lines defining them are renamed/commented out, sourcing an
# empty file sets nothing — the ambient values survive completely
# untouched, with no opt-in involved at all, and "the file is authoritative"
# quietly degrades to "the file exists". Closed by unsetting both variables
# before sourcing, so the file's own assignments are the ONLY way either
# variable can be non-empty afterward unless the explicit opt-in restores
# an override. The post-source non-empty check below then catches an
# empty/edited file explicitly, by name, instead of failing later with a
# confusing "cannot parse a project ref" message.
_override_db_url="${SUPABASE_TEST_DB_URL:-}"
_override_api_url="${SUPABASE_TEST_URL:-}"
unset SUPABASE_TEST_DB_URL SUPABASE_TEST_URL
set -a; . ./.env.test; set +a
if [ "${RESET_DB_ALLOW_ENV_OVERRIDE:-}" = "1" ]; then
  [ -n "$_override_db_url" ] && SUPABASE_TEST_DB_URL="$_override_db_url"
  [ -n "$_override_api_url" ] && SUPABASE_TEST_URL="$_override_api_url"
fi

[ -n "${SUPABASE_TEST_DB_URL:-}" ] || {
  echo "SUPABASE_TEST_DB_URL is empty after sourcing .env.test — check that" >&2
  echo "file defines it (it may be empty, or the line renamed/commented out)." >&2
  exit 1
}
[ -n "${SUPABASE_TEST_URL:-}" ] || {
  echo "SUPABASE_TEST_URL is empty after sourcing .env.test — check that" >&2
  echo "file defines it (it may be empty, or the line renamed/commented out)." >&2
  exit 1
}

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
# corruption, not merely a no-op. The split is done on the AUTHORITY portion
# only (scheme://userinfo@host — everything up to the first "/" after the
# scheme), not on the whole remainder: an "@" appearing later, in a path or
# query string, is not part of userinfo and must not be pulled into it.
urlencode_at() {
  local url="$1"
  local scheme="${url%%://*}"
  local rest="${url#*://}"
  local authority="$rest"
  local after_authority=""
  if [[ "$rest" == */* ]]; then
    authority="${rest%%/*}"
    after_authority="/${rest#*/}"
  fi
  if [[ "$authority" != *@* ]]; then
    printf '%s://%s%s' "$scheme" "$authority" "$after_authority"
    return
  fi
  local hostpart="${authority##*@}"
  local userinfo="${authority%@*}"
  if [[ "$userinfo" != *@* ]]; then
    # Exactly one "@" in the authority — it's already the real delimiter,
    # nothing to fix.
    printf '%s://%s@%s%s' "$scheme" "$userinfo" "$hostpart" "$after_authority"
    return
  fi
  printf '%s://%s@%s%s' "$scheme" "${userinfo//@/%40}" "$hostpart" "$after_authority"
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
# Cannot simply add -v ON_ERROR_STOP=1 here: replaying these migrations on
# top of the current schema.sql is EXPECTED to raise errors that
# supabase/migrations/README.md documents as benign ("already exists" style
# guards with no IF NOT EXISTS, and the one known enum-remap error from
# update_lead_source_enum.sql plus its in-transaction cascade) — ON_ERROR_STOP
# would abort the whole replay on those too. Instead: capture each psql
# call's output, scan it for ERROR lines, and only abort if one doesn't
# match the README's documented benign patterns — a genuinely new failure
# (a real syntax error, a missing table for a real reason, a permissions
# problem) still stops the replay immediately rather than leaving a
# half-built schema and exiting 0.
BENIGN_ERROR_PATTERN='already exists|invalid input value for enum lead_source: "wellfound"|current transaction is aborted, commands ignored until end of transaction block'
for f in "${MIGRATION_FILES[@]}"; do
  set +e
  output="$(psql "$PSQL_DB_URL" -f "supabase/migrations/$f" 2>&1)"
  status=$?
  set -e
  printf '%s\n' "$output"
  if [ "$status" -ne 0 ]; then
    echo "psql exited $status replaying supabase/migrations/$f — aborting." >&2
    exit 1
  fi
  unexpected="$(printf '%s\n' "$output" | grep -E '^psql:.*ERROR:' | grep -viE "$BENIGN_ERROR_PATTERN" || true)"
  if [ -n "$unexpected" ]; then
    echo "Unexpected error replaying supabase/migrations/$f (not one of the" >&2
    echo "benign patterns documented in supabase/migrations/README.md):" >&2
    printf '%s\n' "$unexpected" >&2
    exit 1
  fi
done

# Both schema.sql and add_platform_config.sql seed platform_config, and the
# pre-tenancy table has no unique constraint for ON CONFLICT to bite on, so a
# replay leaves two rows and UNIQUE (org_id) below fails. See README.md.
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM platform_config a USING platform_config b WHERE a.ctid < b.ctid;"
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/2026-08-26_tenancy_foundation.sql

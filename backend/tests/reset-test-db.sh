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

# supabase/schema.sql is the whole build. It defines all 12 org-scoped tables
# (plus refresh_tokens, organizations, the views and the triggers) with org_id
# already in place, so there is nothing to replay on top of it: schema.sql
# builds a fresh database, supabase/migrations/ upgrades an existing one.
# The two are kept convergent by a pg_dump --schema-only diff, documented in
# supabase/migrations/README.md #4 — not by this script re-deriving one from
# the other. That is why the old migration-replay loop (with its chronological
# ordering, its add_platform_config.sql skip, its platform_config dedup, its
# benign-error allowlist and its 5-table org_id backfill) is gone: every one of
# those existed only to paper over schema.sql being incomplete.
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql

# Restore the privileges `DROP SCHEMA public CASCADE` above destroys.
#
# Supabase ships a project with USAGE on `public` and full table privileges
# for postgres/anon/authenticated/service_role, plus ALTER DEFAULT PRIVILEGES
# so new tables inherit them. All of that is attached to the schema and is
# dropped with it. schema.sql re-grants only `authenticated` (its Section H)
# because that is the grant the tenancy work introduced; the platform-default
# service_role grant was never in schema.sql, since a real project never has
# its public schema dropped.
#
# Without this, every service-role code path — authController, routes/cron.ts,
# the engine callbacks, and the isolation suites' test harness — fails against
# the test project with "permission denied for schema public", which looks
# like an application bug and is not one. Kept here rather than in
# schema.sql so supabase/schema-parity-check.sh keeps comparing like with
# like: this is test-project repair, not part of the schema definition.
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES  TO service_role;
SQL

# schema.sql creates no organizations row on purpose — a fresh multi-tenant
# project has no tenant yet for a seed row to belong to. Create the one
# design-partner org this test project needs, then seed platform_config's
# single row against it.
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 -c \
  "INSERT INTO organizations (name, slug) VALUES ('ANTA', 'anta');"
psql "$PSQL_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO platform_config (org_id, config) VALUES (
  (SELECT id FROM organizations WHERE slug = 'anta'),
  '{
  "agency_name": "ANTA",
  "agency_location": "Detroit, Michigan",
  "agency_website": "",
  "agency_tagline": "Software consultancy specializing in operational modernization",
  "services": [
    "SaaS development and React/Next.js systems",
    "AI automation systems and intelligent workflows",
    "Operational dashboards and internal tools",
    "CRM systems and AI-powered operational software",
    "Startup MVP development",
    "Workflow automation and process optimization"
  ],
  "outreach_tone": "intelligent, consultative, NOT salesy, operationally focused",
  "cta_style": "15-min call",
  "sign_off": "ANTA Team",
  "target_locations": ["Detroit", "Michigan", "MI", "Dearborn", "Warren", "Troy", "Ann Arbor", "Livonia", "Sterling Heights"],
  "target_company_sizes": ["11-50", "51-200", "201-500"],
  "target_industries": [],
  "active_sources": ["linkedin", "crunchbase", "job_board", "local_business"]
}'
);
SQL

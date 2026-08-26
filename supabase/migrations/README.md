# Replaying this directory against a fresh database

This is written for whoever next needs to load the schema into an empty
database (a new test project, a local Postgres, `backend/tests/reset-test-db.sh`
in Task 3) by running `supabase/schema.sql` followed by every file in this
directory. Two things in that replay are not obvious from the files
themselves and will burn time if re-discovered from scratch.

## 1. Migrations must run in chronological order, not alphabetical

`for f in supabase/migrations/*.sql; do ...; done` — the shell glob — expands
these files alphabetically. That is **not** the order they were written in,
and for one group of files it is actively wrong: several migrations add
columns to or otherwise depend on the `jobs` table, but the migration that
actually creates `jobs` (`split_remote_jobs_into_jobs_table.sql`) sorts
*after* them alphabetically ("s" > "a"). Run in glob order, those earlier
files fail with `relation "jobs" does not exist` — a real failure, not the
benign "already exists" kind described below.

The correct order, derived from each file's `git log --diff-filter=A`
commit date, is:

```
add_platform_config.sql
add_contact_enrichment.sql
add_enrichment_fields.sql
update_lead_source_enum.sql
add_auth_tables.sql
add_cron_job_logs.sql
add_lead_source_count.sql
add_finalizing_scraping_status.sql
add_job_id_to_scraping_logs.sql
add_remote_jobs_source.sql
split_remote_jobs_into_jobs_table.sql
add_source_to_jobs.sql
fix_jobs_external_id_unique_constraint.sql
add_job_signals.sql
add_job_submissions.sql
add_job_verdict.sql
```

Any migration added after `2026-08-26_tenancy_foundation.sql` sorts after all
of the above by filename (it's date-prefixed) and can simply be appended to
the end of this list.

## 2. Replaying schema.sql + migrations double-seeds `platform_config`

`supabase/schema.sql` creates `platform_config` and inserts the one seed row
directly. `add_platform_config.sql` — one of the migrations folded into
schema.sql — does the same `CREATE TABLE IF NOT EXISTS` + `INSERT ...
ON CONFLICT DO NOTHING`. The `CREATE TABLE` skips harmlessly (table already
exists), but the `INSERT` does not: there is no unique constraint on
`platform_config` for `ON CONFLICT` to match against, so it runs
unconditionally and adds a *second* row (with stale, legacy
`active_sources` values from before `update_lead_source_enum.sql`).

This doesn't matter until `2026-08-26_tenancy_foundation.sql` runs, which
adds `UNIQUE (org_id)` to `platform_config`. Backfilling both rows to the
same org_id and then adding that constraint fails with a duplicate-key
error.

**Fix**: after replaying schema.sql and all migrations in this directory,
and before applying the tenancy migration, delete the extra row so exactly
one remains:

```sql
DELETE FROM platform_config
WHERE id NOT IN (SELECT id FROM platform_config ORDER BY created_at ASC LIMIT 1);
```

## 3. What errors during replay are expected

`schema.sql` is the from-scratch, current-state base — it already reflects
everything every migration in this directory does. Replaying the migrations
on top of it is really just confirming that base is complete, so nearly
every one will error in some form:

- `NOTICE: ... already exists, skipping` (table/column, from `IF NOT
  EXISTS`/`ADD COLUMN IF NOT EXISTS` guards) — benign.
- `ERROR: policy "..." already exists` / `ERROR: trigger "..." already
  exists` (unguarded `CREATE POLICY` / `CREATE TRIGGER`) — benign.
- `ERROR: invalid input value for enum lead_source: "wellfound"` from
  `update_lead_source_enum.sql` — benign: the enum in schema.sql is already
  the post-migration set, so the legacy values that migration tries to
  remap don't exist to remap.

Any error **other** than "already exists" / the enum case above — most
importantly `relation "jobs" does not exist`, which is what plain
alphabetical order produces — means something is genuinely missing or out
of order, not a benign replay artifact. Don't wave it through.

## 4. `schema.sql` now folds in tenancy for the tables it defines — two knock-on effects

As of Task 4 (2026-08-26), `schema.sql` creates `organizations` and already
puts `org_id` (NOT NULL, referencing `organizations`) directly on the 7
org-scoped tables it defines: `leads`, `lead_signals`, `lead_scores`,
`outreach_messages`, `outreach_history`, `scraping_logs`, `platform_config`.
It does **not** define the other 5 org-scoped tables — `users`, `jobs`,
`cron_job_logs`, `job_signals`, `job_submissions` — those still come from
migrations further down this list, exactly as before. `refresh_tokens` gets
no `org_id` anywhere, by design.

This changes what a correct replay must do, in two ways:

**a) `add_platform_config.sql` is now skipped, not replayed.** Its
`CREATE TABLE IF NOT EXISTS platform_config` still no-ops harmlessly, but its
unconditional `INSERT INTO platform_config (config) VALUES (...)` does not
set `org_id` — and `schema.sql`'s `platform_config` now has `org_id NOT
NULL` with no default, so that insert fails with a real
`not_null_violation`, not a benign "already exists". `schema.sql` no longer
seeds `platform_config` itself either (there is no organization yet at
`schema.sql`-build time for a seed row to belong to). `backend/tests/reset-test-db.sh`
seeds the one `platform_config` row itself, explicitly, against the ANTA
org it also creates — after `schema.sql`, before replaying the rest of this
list, and with `add_platform_config.sql` excluded from the replay entirely.

**b) The 5 tables `schema.sql` doesn't define still need `org_id` after
they're created.** Migrations further down this list (`add_auth_tables.sql`,
`split_remote_jobs_into_jobs_table.sql`, `add_cron_job_logs.sql`,
`add_job_signals.sql`, `add_job_submissions.sql`) create these 5 tables
exactly as they always have — with no `org_id` at all, since they predate
tenancy and are left untouched (migrations are not edited after they've
run). Re-running `2026-08-26_tenancy_foundation.sql` in full to backfill
them isn't possible either: its Section B does a plain `ADD COLUMN org_id`
on all 12 tables, including the 7 `schema.sql` already covers, and that
errors "column already exists" (a real error, not one of the benign
patterns above) rather than silently skipping.

`backend/tests/reset-test-db.sh` closes this gap itself, in a step run after
the migration replay: it adds `org_id` to just these 5 tables, backfills it
to the ANTA org, tightens to `NOT NULL`, adds the `idx_*_org` indexes, and
replaces `jobs.converted_lead_id` / `job_signals.job_id` /
`job_submissions.job_id`'s plain FKs with the composite
`(x_id, org_id) REFERENCES ... (id, org_id)` form — the same shape Section F
of `2026-08-26_tenancy_foundation.sql` uses for the tables `schema.sql`
already has, just scoped to the 5 it doesn't. All 5 tables are empty at this
point in a from-empty replay, so the backfill and the `NOT NULL` tightening
are no-ops in practice; the statements exist for the same reason Section
B/C/D of the original migration does.

This is test-harness-only scaffolding, needed because `schema.sql` and the
migration list are (deliberately, per Task 4's scope) not yet at full parity
for these 5 tables — a future task may fold their `CREATE TABLE`s into
`schema.sql` too, at which point this whole section and the corresponding
block in `reset-test-db.sh` can be deleted.

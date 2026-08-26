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

# Replaying this directory against a fresh database

**If you just want to build an empty database: run `supabase/schema.sql`
alone and stop. Do not replay this directory on top of it.** See section 4 —
that is the current, supported path, and it is what
`backend/tests/reset-test-db.sh` does.

Sections 1-3 below describe the *historical* "schema.sql then every file in
this directory" replay. They are kept because that replay is still the way
the production upgrade path is reconstructed for the schema.sql-vs-migrations
`pg_dump` diff described in section 4, and because the ordering and
double-seed hazards they document are non-obvious and will burn time if
re-discovered from scratch.

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

## 4. `schema.sql` builds a fresh database; this directory upgrades an old one

As of Task 4 (2026-08-26) the split above is exact, and sections 1–3 apply
only to the historical replay, not to any current workflow:

- **`supabase/schema.sql` is the from-scratch build.** It defines all 12
  org-scoped tables (`users`, `leads`, `jobs`, `scraping_logs`,
  `cron_job_logs`, `lead_signals`, `lead_scores`, `outreach_messages`,
  `outreach_history`, `job_signals`, `job_submissions`, `platform_config`)
  with `org_id NOT NULL` and the composite `(x_id, org_id)` foreign keys
  already in place, plus `organizations`, `refresh_tokens` (no `org_id`, by
  design — it is auth infrastructure scoped by `user_id`), the enums, the
  views and the triggers. Applying it to an empty database is the whole
  build. `backend/tests/reset-test-db.sh` does exactly that and nothing
  else: it no longer replays anything from this directory, so the
  chronological ordering, the `add_platform_config.sql` skip, the
  `platform_config` dedup and the benign-error allowlist are all gone from
  it. Every one of those existed only to work around `schema.sql` being
  incomplete.
- **This directory is the upgrade path** for a database that already exists
  (production). It is append-only; the files here are never edited after
  they have run.

`schema.sql` creates no `organizations` row and no `platform_config` row:
a fresh multi-tenant project has no tenant yet for a seed row to belong to.
The caller seeds them (see `backend/tests/reset-test-db.sh`).

### Keeping the two paths convergent

The two paths must produce the same database, and that is checked by
`supabase/schema-parity-check.sh` — run it after any change to either side.
It is non-destructive (two throwaway databases on a local postgres; it never
touches a Supabase project) and diffs `pg_dump --schema-only` output of

1. a database built from the pre-tenancy `schema.sql` + every file in this
   directory in the order in section 1 + `2026-08-26_tenancy_foundation.sql`
   (the "production upgrade" path), against
2. a database built from the current `supabase/schema.sql` alone.

That diff is empty except for **one enumerated divergence**: `org_id`'s
column ordinal position. On the upgrade path `ALTER TABLE ... ADD COLUMN`
necessarily appends `org_id` last on each of the 12 tables; in `schema.sql`
it is declared second, immediately after `id`, where it belongs. Postgres
cannot reorder a column in place, and nothing depends on ordinal position
except `SELECT *`, so this is accepted rather than worked around. It
propagates into the `hot_leads` view (which selects `l.*`) in the same
single way.

Everything else is byte-identical, including things that took deliberate
work to align and must not be "tidied" back:

- `lead_source`'s `'remote_jobs'` is the **last** enum value in
  `schema.sql`, because `ALTER TYPE ... ADD VALUE` can only append.
- `leads.source_count` / `leads.contributing_sources` are declared **after**
  `updated_at`, and `jobs.source` / `verdict` / `verdict_reasons` /
  `posted_at` **after** `jobs.updated_at`, and `scraping_logs.job_id`
  **after** `created_at` — matching where their later migrations put them.
- `jobs` has a real `UNIQUE (external_id)` constraint
  (`jobs_external_id_key`), not the original partial unique index — see
  `fix_jobs_external_id_unique_constraint.sql`.
- `scraping_logs_status_check` is named explicitly, because
  `add_finalizing_scraping_status.sql` drops the auto-named one and re-adds
  it under that name.
- `2026-08-26_tenancy_foundation.sql` has a Section G that drops and
  recreates `hot_leads`. Without it, an upgraded database would keep the
  view's frozen pre-tenancy column list and expose a `hot_leads` with no
  `org_id`, while a fresh one built from `schema.sql` has it.

When a future migration lands here, apply the same change to `schema.sql`
(honouring column-append order) and re-run that diff.

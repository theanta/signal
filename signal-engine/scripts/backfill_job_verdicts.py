"""One-off backfill: compute verdict / verdict_reasons / posted_at for
existing rows in the `jobs` table.

Run after applying the add_job_verdict.sql migration, from signal-engine/:

    python scripts/backfill_job_verdicts.py           # apply
    python scripts/backfill_job_verdicts.py --dry-run # preview counts only

Uses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment (.env
is loaded the same way main.py does). Safe to re-run — it recomputes and
overwrites the triage fields, nothing else.
"""

import os
import sys
from collections import Counter
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from supabase import create_client

from analyzers.job_qualifier import qualify_job

PAGE_SIZE = 500


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    verdicts: Counter[str] = Counter()
    updated = 0
    page = 0

    while True:
        rows = (
            sb.table("jobs")
            .select("id, job_title, location, description, posted_at_raw, scraped_at, created_at")
            .order("created_at", desc=True)
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
            .execute()
            .data
            or []
        )
        if not rows:
            break

        for row in rows:
            # Relative posted_at_raw ("3 days ago") is relative to when the
            # row was scraped, not to when this backfill runs.
            anchor_raw = row.get("scraped_at") or row.get("created_at")
            anchor = datetime.fromisoformat(anchor_raw.replace("Z", "+00:00")) if anchor_raw else None
            triage = qualify_job(row, posted_anchor=anchor)
            verdicts[triage["verdict"]] += 1
            if not dry_run:
                sb.table("jobs").update(triage).eq("id", row["id"]).execute()
            updated += 1

        if len(rows) < PAGE_SIZE:
            break
        page += 1

    label = "Would update" if dry_run else "Updated"
    print(f"{label} {updated} jobs — verdicts: {dict(verdicts)}")


if __name__ == "__main__":
    main()

"""Scrape runs, stored in Postgres (tables scrape_jobs and scrape_job_events).

A scrape RUN is one execution of POST /scrape. It is not a job posting.

The engine holds the service-role key, which bypasses RLS, so every read and
write here names `org_id` explicitly. A run of another org is reported as
missing, never returned.
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = ("queued", "running", "finalizing")
TERMINAL_STATUSES = ("completed", "failed")


class ActiveRunExists(Exception):
    """The org already has a run in an active status (one_active_scrape_per_org)."""


class ScrapeCapReached(Exception):
    """The org has started organizations.monthly_scrape_cap runs this month."""

    def __init__(self, org_id: str, cap: int):
        super().__init__(f"org {org_id} reached its monthly scrape cap of {cap}")
        self.cap = cap


def month_start(now: Optional[datetime] = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_unique_violation(err: Exception) -> bool:
    code = getattr(err, "code", None)
    if code is None and err.args and isinstance(err.args[0], dict):
        code = err.args[0].get("code")
    return code == "23505" or "one_active_scrape_per_org" in str(err)


class JobStore:
    def __init__(self, client: Any):
        self.db = client

    # ---- writes ----

    def create_run(self, org_id: str, sources: list[str], config: dict) -> str:
        """Record a new running run for the org.

        Raises ScrapeCapReached when the org has already started its monthly
        cap of runs (every run counts, failed ones too: they spent credits),
        and ActiveRunExists when it has one in progress. The count and the
        insert cannot race: one_active_scrape_per_org admits one at a time."""
        cap = self.monthly_cap(org_id)
        if self.runs_this_month(org_id) >= cap:
            raise ScrapeCapReached(org_id, cap)
        try:
            res = self.db.table("scrape_jobs").insert({
                "org_id": org_id,
                "status": "running",
                "sources": sources,
                "source_state": {s: {"status": "pending"} for s in sources},
                "config": config,
                "worker_id": os.environ.get("RENDER_INSTANCE_ID") or os.environ.get("HOSTNAME"),
            }).execute()
        except Exception as e:
            if _is_unique_violation(e):
                raise ActiveRunExists(org_id) from e
            raise
        return res.data[0]["id"]

    def update_run(self, run_id: str, org_id: str, **fields: Any) -> None:
        """Update an ACTIVE run. Once a run is terminal — finished, or failed by
        the reaper — later writes from a straggling worker are no-ops, so they
        can neither resurrect it nor collide with the org's next run."""
        fields["heartbeat_at"] = _now()
        (self.db.table("scrape_jobs").update(fields)
         .eq("id", run_id).eq("org_id", org_id).in_("status", list(ACTIVE_STATUSES))
         .execute())

    def heartbeat(self, run_id: str, org_id: str) -> None:
        self.update_run(run_id, org_id)

    def finish(self, run_id: str, org_id: str, status: str, results: int,
               error: Optional[str] = None, source_state: Optional[dict] = None) -> None:
        fields: dict[str, Any] = {"status": status, "results": results, "error": error,
                                  "finished_at": _now()}
        if source_state is not None:
            fields["source_state"] = source_state
        self.update_run(run_id, org_id, **fields)

    def append_event(self, run_id: str, org_id: str, event: dict) -> None:
        self.db.table("scrape_job_events").insert({
            "job_id": run_id, "org_id": org_id, "event": event,
        }).execute()

    def reap_stale(self, stale_after: timedelta) -> list[dict]:
        """Fail every active run whose heartbeat is older than `stale_after`.

        Deliberately cross-org: it is engine housekeeping, not tenant work.
        One conditional UPDATE, so a run that heartbeats in the meantime no
        longer matches and is left alone. Returns the runs it failed."""
        cutoff = (datetime.now(timezone.utc) - stale_after).isoformat()
        stale_error = f"reaped: no heartbeat for {int(stale_after.total_seconds() // 60)} minutes"
        res = (self.db.table("scrape_jobs")
               .update({"status": "failed", "error": stale_error, "finished_at": _now()})
               .in_("status", list(ACTIVE_STATUSES)).lt("heartbeat_at", cutoff)
               .execute())
        reaped = res.data or []
        for run in reaped:
            try:
                self.append_event(run["id"], run["org_id"],
                                  {"phase": "complete", "status": "failed", "results": run.get("results", 0)})
            except Exception as e:
                logger.error(f"[reaper] could not close the stream of run {run['id']}: {e}")
        return reaped

    # ---- reads ----

    def monthly_cap(self, org_id: str) -> int:
        res = (self.db.table("organizations").select("monthly_scrape_cap")
               .eq("id", org_id).limit(1).execute())
        if not res.data:
            raise ValueError(f"unknown org {org_id}")
        return int(res.data[0]["monthly_scrape_cap"])

    def runs_this_month(self, org_id: str) -> int:
        res = (self.db.table("scrape_jobs").select("id", count="exact")
               .eq("org_id", org_id).gte("created_at", month_start().isoformat())
               .limit(1).execute())
        return int(res.count or 0)

    def get_run(self, run_id: str, org_id: str) -> Optional[dict]:
        res = (self.db.table("scrape_jobs").select("*")
               .eq("id", run_id).eq("org_id", org_id).limit(1).execute())
        return res.data[0] if res.data else None

    def events_after(self, run_id: str, org_id: str, after_seq: int) -> list[dict]:
        res = (self.db.table("scrape_job_events").select("seq, event")
               .eq("job_id", run_id).eq("org_id", org_id).gt("seq", after_seq)
               .order("seq").execute())
        return res.data or []


_store: Optional[JobStore] = None


def get_store() -> JobStore:
    """The process-wide store on a service-role client, created on first use."""
    global _store
    if _store is None:
        from supabase import create_client
        _store = JobStore(create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        ))
    return _store

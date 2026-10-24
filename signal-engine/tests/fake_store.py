"""An in-memory JobStore with the same contract as jobstore.JobStore,
including one_active_scrape_per_org and org-scoped reads."""
import uuid

from jobstore import ACTIVE_STATUSES, ActiveRunExists


class FakeStore:
    def __init__(self):
        self.runs: dict[str, dict] = {}
        self.events: list[dict] = []

    def create_run(self, org_id, sources, config):
        if any(r["org_id"] == org_id and r["status"] in ACTIVE_STATUSES for r in self.runs.values()):
            raise ActiveRunExists(org_id)
        run_id = str(uuid.uuid4())
        self.runs[run_id] = {
            "id": run_id, "org_id": org_id, "status": "running", "sources": sources,
            "source_state": {s: {"status": "pending"} for s in sources}, "config": config,
            "results": 0, "error": None, "created_at": "2026-10-24T00:00:00+00:00",
            "finished_at": None, "heartbeat_at": "2026-10-24T00:00:00+00:00",
        }
        return run_id

    def update_run(self, run_id, org_id, **fields):
        run = self.runs.get(run_id)
        if run and run["org_id"] == org_id:
            run.update(fields)

    def finish(self, run_id, org_id, status, results, error=None, source_state=None):
        fields = {"status": status, "results": results, "error": error, "finished_at": "done"}
        if source_state is not None:
            fields["source_state"] = source_state
        self.update_run(run_id, org_id, **fields)

    def append_event(self, run_id, org_id, event):
        self.events.append({"seq": len(self.events) + 1, "job_id": run_id, "org_id": org_id, "event": event})

    def get_run(self, run_id, org_id):
        run = self.runs.get(run_id)
        return dict(run) if run and run["org_id"] == org_id else None

    def events_after(self, run_id, org_id, after_seq):
        return [{"seq": e["seq"], "event": e["event"]} for e in self.events
                if e["job_id"] == run_id and e["org_id"] == org_id and e["seq"] > after_seq]

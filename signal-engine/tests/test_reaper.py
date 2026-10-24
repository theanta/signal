"""Heartbeat and reaper: a run whose worker died stops holding its org's
active-run slot, and a live run is never reaped."""
import asyncio
from datetime import timedelta

import main
from tests.conftest import TEST_CONFIG, tenant_config

ORG = "11111111-1111-1111-1111-111111111111"


def _stale(store, run_id):
    """Backdate the run's heartbeat well past the reaper's cutoff."""
    store.runs[run_id]["heartbeat_at"] = "2000-01-01T00:00:00+00:00"


def test_a_stale_active_run_is_failed_and_its_stream_closed(store):
    run_id = store.create_run(ORG, ["linkedin"], {})
    _stale(store, run_id)
    reaped = store.reap_stale(timedelta(minutes=15))
    assert [r["id"] for r in reaped] == [run_id]
    assert store.get_run(run_id, ORG)["status"] == "failed"
    assert store.events[-1]["event"] == {"phase": "complete", "status": "failed", "results": 0}


def test_a_fresh_run_is_left_alone(store):
    run_id = store.create_run(ORG, ["linkedin"], {})
    assert store.reap_stale(timedelta(minutes=15)) == []
    assert store.get_run(run_id, ORG)["status"] == "running"


def test_a_finished_run_is_never_reaped(store):
    run_id = store.create_run(ORG, ["linkedin"], {})
    store.finish(run_id, ORG, "completed", 2)
    _stale(store, run_id)
    assert store.reap_stale(timedelta(minutes=15)) == []
    assert store.get_run(run_id, ORG)["status"] == "completed"


def test_reaping_frees_the_org_for_a_new_run(store):
    run_id = store.create_run(ORG, ["linkedin"], {})
    _stale(store, run_id)
    store.reap_stale(timedelta(minutes=15))
    assert store.create_run(ORG, ["linkedin"], {}) != run_id


def test_a_straggler_cannot_resurrect_a_reaped_run(store):
    run_id = store.create_run(ORG, ["linkedin"], {})
    _stale(store, run_id)
    store.reap_stale(timedelta(minutes=15))
    store.update_run(run_id, ORG, status="finalizing")
    store.finish(run_id, ORG, "completed", 9)
    assert store.get_run(run_id, ORG)["status"] == "failed"


def test_a_running_scrape_heartbeats(store, monkeypatch):
    monkeypatch.setattr(main, "HEARTBEAT_SECONDS", 0.01)
    async def slow_body(job_id, org_id, sources, cfg, supabase):
        await asyncio.sleep(0.1)

    monkeypatch.setattr(main, "_run_scrape_job_body", slow_body)
    monkeypatch.setattr("supabase.create_client", lambda *_a, **_k: object())
    run_id = store.create_run(ORG, ["linkedin"], {})
    asyncio.run(main.run_scrape_job(run_id, ORG, ["linkedin"], tenant_config()))
    assert store.heartbeats.count(run_id) >= 3


def test_the_heartbeat_stops_when_the_run_ends(store, monkeypatch):
    monkeypatch.setattr(main, "HEARTBEAT_SECONDS", 0.01)

    async def quick_body(*_a):
        return None

    monkeypatch.setattr(main, "_run_scrape_job_body", quick_body)
    monkeypatch.setattr("supabase.create_client", lambda *_a, **_k: object())
    run_id = store.create_run(ORG, ["linkedin"], {})

    async def run_then_wait():
        await main.run_scrape_job(run_id, ORG, ["linkedin"], tenant_config())
        n = len(store.heartbeats)
        await asyncio.sleep(0.05)
        return n

    before = asyncio.run(run_then_wait())
    assert len(store.heartbeats) == before

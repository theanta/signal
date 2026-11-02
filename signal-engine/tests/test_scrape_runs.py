"""Scrape runs live in the run store: one active run per org, org-scoped
status and stream, and the run's progress recorded as it goes."""
import asyncio
import json

import main
from tests.conftest import VALID_KEY, TEST_CONFIG, tenant_config

ORG_A = "11111111-1111-1111-1111-111111111111"
ORG_B = "22222222-2222-2222-2222-222222222222"
H = {"X-Engine-Key": VALID_KEY}


def _start(client, org, monkeypatch=None):
    return client.post("/scrape", headers=H, json={"sources": ["linkedin"], "org_id": org, "config": TEST_CONFIG})


def _no_background(monkeypatch):
    async def _noop(*_a, **_k):
        return None
    monkeypatch.setattr(main, "run_scrape_job", _noop)


def test_start_records_a_running_run(client, store, monkeypatch):
    _no_background(monkeypatch)
    r = _start(client, ORG_A)
    assert r.status_code == 200
    run = store.get_run(r.json()["job_id"], ORG_A)
    assert run["status"] == "running"
    assert run["sources"] == ["linkedin"]


def test_second_active_run_for_the_same_org_is_409(client, store, monkeypatch):
    _no_background(monkeypatch)
    assert _start(client, ORG_A).status_code == 200
    r = _start(client, ORG_A)
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "scrape_already_running"


def test_another_org_can_start_while_one_is_running(client, store, monkeypatch):
    _no_background(monkeypatch)
    assert _start(client, ORG_A).status_code == 200
    assert _start(client, ORG_B).status_code == 200


def test_a_finished_run_frees_the_slot(client, store, monkeypatch):
    _no_background(monkeypatch)
    run_id = _start(client, ORG_A).json()["job_id"]
    store.finish(run_id, ORG_A, "completed", 3)
    assert _start(client, ORG_A).status_code == 200


def test_status_is_scoped_to_the_org(client, store, monkeypatch):
    _no_background(monkeypatch)
    run_id = _start(client, ORG_A).json()["job_id"]
    own = client.get(f"/scrape/{run_id}?org_id={ORG_A}", headers=H)
    assert own.status_code == 200 and own.json()["job_id"] == run_id
    other = client.get(f"/scrape/{run_id}?org_id={ORG_B}", headers=H)
    assert other.status_code == 404


def test_status_requires_an_org(client, store, monkeypatch):
    _no_background(monkeypatch)
    run_id = _start(client, ORG_A).json()["job_id"]
    assert client.get(f"/scrape/{run_id}", headers=H).status_code == 422


def test_stream_is_scoped_to_the_org(client, store, monkeypatch):
    _no_background(monkeypatch)
    run_id = _start(client, ORG_A).json()["job_id"]
    assert client.get(f"/scrape/{run_id}/stream?org_id={ORG_B}", headers=H).status_code == 404


def _frames(text):
    return [json.loads(line[len("data: "):]) for line in text.splitlines() if line.startswith("data: ")]


def test_stream_of_a_finished_run_is_snapshot_then_events(client, store):
    run_id = store.create_run(ORG_A, ["job_board"], {})
    store.append_event(run_id, ORG_A, {"phase": "source", "source": "job_board", "status": "completed"})
    store.append_event(run_id, ORG_A, {"phase": "complete", "status": "completed", "results": 2})
    r = client.get(f"/scrape/{run_id}/stream?org_id={ORG_A}", headers=H)
    frames = _frames(r.text)
    assert frames[0]["phase"] == "snapshot"
    assert [f["phase"] for f in frames[1:]] == ["source", "complete"]


def test_run_scrape_job_records_progress_and_finishes(store, monkeypatch):
    class _Fake:
        def __init__(self, *a, **k):
            pass

        def scrape(self):
            raise RuntimeError("actor down")

    monkeypatch.setattr(main, "JobBoardScraper", _Fake)
    monkeypatch.setattr("supabase.create_client", lambda *_a, **_k: _NullDb())
    run_id = store.create_run(ORG_A, ["job_board"], {})
    asyncio.run(main.run_scrape_job(run_id, ORG_A, ["job_board"], tenant_config()))

    run = store.get_run(run_id, ORG_A)
    assert run["status"] == "failed"
    assert run["source_state"]["job_board"]["status"] == "failed"
    phases = [e["event"]["phase"] for e in store.events]
    assert phases == ["source", "complete"]


class _NullDb:
    def table(self, _name):
        return self

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        class _R:
            data = [{"id": 1}]
        return _R()


def _ids(text):
    return [int(line[len("id: "):]) for line in text.splitlines() if line.startswith("id: ")]


def _running_run_with_events(store, n):
    run_id = store.create_run(ORG_A, ["job_board", "linkedin"], {})
    for i in range(n - 1):
        store.append_event(run_id, ORG_A, {"phase": "source", "source": f"s{i}", "status": "completed"})
    store.append_event(run_id, ORG_A, {"phase": "complete", "status": "completed", "results": 1})
    return run_id


def test_every_event_carries_its_seq_as_the_sse_id(client, store):
    run_id = _running_run_with_events(store, 3)
    r = client.get(f"/scrape/{run_id}/stream?org_id={ORG_A}", headers=H)
    assert _ids(r.text) == [1, 2, 3]


def test_last_event_id_resumes_after_that_event(client, store):
    run_id = _running_run_with_events(store, 3)
    r = client.get(f"/scrape/{run_id}/stream?org_id={ORG_A}",
                   headers={**H, "Last-Event-ID": "1"})
    assert _ids(r.text) == [2, 3]
    phases = [f["phase"] for f in _frames(r.text)]
    assert phases == ["snapshot", "source", "complete"]


def test_a_malformed_last_event_id_replays_from_the_start(client, store):
    run_id = _running_run_with_events(store, 2)
    r = client.get(f"/scrape/{run_id}/stream?org_id={ORG_A}",
                   headers={**H, "Last-Event-ID": "not-a-number"})
    assert _ids(r.text) == [1, 2]


def test_a_run_that_ends_without_a_complete_event_still_closes_the_stream(client, store, monkeypatch):
    monkeypatch.setattr(main, "STREAM_POLL_SECONDS", 0)
    run_id = store.create_run(ORG_A, ["job_board"], {})
    calls = {"n": 0}
    real_get = store.get_run

    def get_run(rid, org):
        # The first read (the snapshot) sees it running; it is then reaped.
        calls["n"] += 1
        if calls["n"] == 2:
            store.runs[rid]["status"] = "failed"
        return real_get(rid, org)

    monkeypatch.setattr(store, "get_run", get_run)
    r = client.get(f"/scrape/{run_id}/stream?org_id={ORG_A}", headers=H)
    frames = _frames(r.text)
    assert frames[-1] == {"phase": "complete", "status": "failed", "results": 0}


def test_paused_sources_are_ignored(client, store, monkeypatch):
    """Indeed and Crunchbase are paused this phase: asking for them starts
    only the enabled sources, so they never spend Apify credits."""
    _no_background(monkeypatch)
    r = client.post("/scrape", headers=H, json={
        "sources": ["linkedin", "job_board", "crunchbase", "local_business"],
        "org_id": ORG_A, "config": TEST_CONFIG})
    assert store.get_run(r.json()["job_id"], ORG_A)["sources"] == ["linkedin", "local_business"]

"""Every paid external call is attributed to the org (and run) that caused
it, and the monthly scrape cap is enforced before a run starts."""
import asyncio
from types import SimpleNamespace

import main
import metering
from tests.conftest import VALID_KEY, TEST_CONFIG, tenant_config

ORG = "11111111-1111-1111-1111-111111111111"
H = {"X-Engine-Key": VALID_KEY}


def test_record_attributes_to_the_bound_org_and_run(usage):
    async def go():
        metering.bind(ORG, "run-1")
        await asyncio.to_thread(metering.record, "serper", "search", 1)
    asyncio.run(go())
    assert usage == [{"org_id": ORG, "job_id": "run-1", "provider": "serper",
                      "operation": "search", "units": 1, "cost_cents": None}]


def test_nothing_is_recorded_without_an_org(usage):
    asyncio.run(asyncio.to_thread(metering.record, "groq", "chat", 10))
    assert usage == []


def test_a_failed_write_never_raises(monkeypatch):
    def boom(_row):
        raise RuntimeError("db down")
    monkeypatch.setattr(metering, "_write", boom)

    async def go():
        metering.bind(ORG)
        metering.record("apify", "actor:x", 3)
    asyncio.run(go())  # no exception


def test_usd_to_cents():
    assert metering.usd_to_cents(0.2654) == 27
    assert metering.usd_to_cents(None) is None
    assert metering.usd_to_cents("bad") is None


def test_apify_runs_are_metered_with_their_cost(usage, monkeypatch):
    from scrapers import apify_base

    class _Client:
        def __init__(self, _token):
            pass

        def actor(self, _id):
            return SimpleNamespace(call=lambda **_k: SimpleNamespace(
                default_dataset_id="d", usage_total_usd=0.05))

        def dataset(self, _id):
            return SimpleNamespace(list_items=lambda: SimpleNamespace(items=[{}, {}, {}]))

    monkeypatch.setattr(apify_base, "ApifyClient", _Client)

    class _Scraper(apify_base.ApifyBaseScraper):
        def scrape(self):
            return self._run_actor("compass/crawler-google-places", {})

    async def go():
        metering.bind(ORG, "run-9")
        return await asyncio.to_thread(_Scraper().scrape)
    assert len(asyncio.run(go())) == 3
    assert usage == [{"org_id": ORG, "job_id": "run-9", "provider": "apify",
                      "operation": "actor:compass/crawler-google-places",
                      "units": 3, "cost_cents": 5}]


def test_a_scrape_run_binds_its_org_and_run_id(usage, store, monkeypatch):
    seen = {}

    async def body(job_id, org_id, *_a):
        seen["bound"] = (metering._org_id.get(), metering._job_id.get())

    monkeypatch.setattr(main, "_run_scrape_job_body", body)
    monkeypatch.setattr("supabase.create_client", lambda *_a, **_k: object())
    run_id = store.create_run(ORG, ["linkedin"], {})
    asyncio.run(main.run_scrape_job(run_id, ORG, ["linkedin"], tenant_config()))
    assert seen["bound"] == (ORG, run_id)


def test_scrape_over_the_monthly_cap_is_429(client, store, monkeypatch):
    async def _noop(*_a, **_k):
        return None
    monkeypatch.setattr(main, "run_scrape_job", _noop)
    store.caps[ORG] = 2
    for _ in range(2):
        run_id = client.post("/scrape", headers=H, json={"sources": ["job_board"], "org_id": ORG, "config": TEST_CONFIG}).json()["job_id"]
        store.finish(run_id, ORG, "completed", 0)
    r = client.post("/scrape", headers=H, json={"sources": ["job_board"], "org_id": ORG, "config": TEST_CONFIG})
    assert r.status_code == 429
    assert r.json()["detail"]["error"] == "scrape_cap_reached"


def test_failed_runs_count_toward_the_cap(store):
    store.caps[ORG] = 1
    run_id = store.create_run(ORG, ["x"], {})
    store.finish(run_id, ORG, "failed", 0)
    import pytest
    from jobstore import ScrapeCapReached
    with pytest.raises(ScrapeCapReached):
        store.create_run(ORG, ["x"], {})

"""The engine writes with the service-role key, so it can write into any org.
It must therefore never infer one: the org arrives from an authenticated
backend or the request is rejected."""
import asyncio

import main
from tests.conftest import VALID_KEY, TEST_CONFIG, tenant_config

HEADERS = {"X-Engine-Key": VALID_KEY}

LEAD = {
    "company_name": "Acme",
    "website": "https://acme.test",
    "source_url": "https://acme.test/jobs",
    "source": "manual",
    "scraped_at": "2026-08-26T00:00:00Z",
}
ORG = "3f0a2c1e-9b6d-4f2a-8c1b-5d7e9a0b1c2d"


def test_analyze_without_org_id_is_rejected(client):
    r = client.post("/analyze", json={"lead": LEAD}, headers=HEADERS)
    assert r.status_code == 422
    assert "org_id" in r.text


def test_analyze_stream_without_org_id_is_rejected(client):
    r = client.post("/analyze/stream", json={"lead": LEAD}, headers=HEADERS)
    assert r.status_code == 422
    assert "org_id" in r.text


def test_analyze_with_a_non_uuid_org_id_is_rejected(client):
    r = client.post("/analyze", json={"lead": LEAD, "org_id": "anta"}, headers=HEADERS)
    assert r.status_code == 422


def test_scrape_without_org_id_is_rejected(client):
    r = client.post("/scrape", json={"sources": ["linkedin"]}, headers=HEADERS)
    assert r.status_code == 422
    assert "org_id" in r.text


def test_org_id_does_not_bypass_the_engine_key(client):
    r = client.post("/scrape", json={"sources": ["linkedin"], "org_id": ORG})
    assert r.status_code == 401


class _Recorder:
    """A stand-in Supabase client that records every write and filter."""

    def __init__(self, existing_external_ids=()):
        self.calls: list[tuple] = []
        self.existing = list(existing_external_ids)

    def table(self, name):
        rec = self

        class _Q:
            def __init__(self):
                self.op = None
                self.payload = None
                self.filters: list[tuple] = []
                self.kwargs: dict = {}

            def select(self, cols="*"):
                self.op, self.cols = "select", cols
                return self

            def insert(self, payload):
                self.op, self.payload = "insert", payload
                return self

            def update(self, payload):
                self.op, self.payload = "update", payload
                return self

            def upsert(self, payload, **kwargs):
                self.op, self.payload, self.kwargs = "upsert", payload, kwargs
                return self

            def eq(self, col, val):
                self.filters.append(("eq", col, val))
                return self

            def in_(self, col, vals):
                self.filters.append(("in", col, tuple(vals)))
                return self

            def execute(self):
                rec.calls.append((name, self.op, self.payload, self.filters, self.kwargs))

                class _R:
                    data = []

                return _R()

        return _Q()


def _rows(payload):
    return payload if isinstance(payload, list) else [payload]


def test_run_scrape_job_stamps_every_write(monkeypatch):
    sb = _Recorder()
    monkeypatch.setattr("supabase.create_client", lambda *_a, **_k: sb)

    class _Fake:
        def __init__(self, *a, **k):
            pass

        def scrape(self):
            return [{
                "company_name": "Acme", "website": "https://acme.test",
                "source_url": "https://acme.test/jobs", "source": "job_board",
            }]

    monkeypatch.setattr(main, "JobBoardScraper", _Fake)

    job_id = main.get_store().create_run(ORG, ["job_board"], {})
    asyncio.run(main.run_scrape_job(job_id, ORG, ["job_board"], tenant_config()))

    writes = [c for c in sb.calls if c[1] in ("insert", "update", "upsert")]
    tables = {c[0] for c in writes}
    assert {"leads", "scraping_logs"} <= tables
    for table, op, payload, filters, _k in writes:
        if op == "update":
            assert ("eq", "org_id", ORG) in filters, f"{table} update is not org-scoped"
        else:
            assert all(row["org_id"] == ORG for row in _rows(payload)), f"{table} {op} lacks org_id"
    for table, op, _p, filters, _k in sb.calls:
        if op == "select":
            assert ("eq", "org_id", ORG) in filters, f"{table} lookup is not org-scoped"

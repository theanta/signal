"""The engine writes with the service-role key, so it can write into any org.
It must therefore never infer one: the org arrives from an authenticated
backend or the request is rejected."""
import asyncio

import main
from tests.conftest import VALID_KEY

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

                if self.op == "select" and name == "jobs" and self.cols == "external_id":
                    _R.data = [{"external_id": e} for e in rec.existing]
                return _R()

        return _Q()


def _rows(payload):
    return payload if isinstance(payload, list) else [payload]


def test_persist_job_postings_stamps_and_filters_by_org():
    sb = _Recorder(existing_external_ids=["ext-1"])
    postings = [
        {"external_id": "ext-1", "job_title": "Dev", "company_name": "A", "source_url": "u1"},
        {"external_id": None, "job_title": "Dev", "company_name": "B", "source_url": "u2"},
    ]
    main._persist_job_postings(sb, ORG, postings)

    writes = [c for c in sb.calls if c[1] in ("insert", "update", "upsert")]
    assert writes, "expected at least one write"
    for _table, _op, payload, _filters, _kw in writes:
        assert all(row["org_id"] == ORG for row in _rows(payload))

    # Every lookup that decides "is this posting already ours?" is org-scoped,
    # or one tenant's scrape would update another tenant's row.
    for _table, op, _payload, filters, _kw in sb.calls:
        if op == "select":
            assert ("eq", "org_id", ORG) in filters

    upserts = [c for c in sb.calls if c[1] == "upsert"]
    assert upserts and all(c[4].get("on_conflict") == "org_id,external_id" for c in upserts)


def test_persist_job_postings_never_trusts_an_org_id_in_the_posting():
    sb = _Recorder()
    other = "11111111-1111-4111-8111-111111111111"
    main._persist_job_postings(sb, ORG, [
        {"external_id": "x", "job_title": "Dev", "company_name": "A", "source_url": "u", "org_id": other},
    ])
    for _t, op, payload, _f, _k in sb.calls:
        if op in ("insert", "update", "upsert"):
            assert all(row["org_id"] == ORG for row in _rows(payload))


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

    job_id = "job-1"
    main.scrape_jobs[job_id] = {"status": "running", "org_id": ORG, "sources": {}, "events": []}
    main.scrape_conditions[job_id] = asyncio.Condition()
    asyncio.run(main.run_scrape_job(job_id, ORG, ["job_board"]))

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

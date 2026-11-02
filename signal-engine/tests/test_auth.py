"""The engine holds the Supabase service-role key. Every mutating route must
prove the caller is our backend before it runs."""
from tests.conftest import VALID_KEY

ANALYZE_BODY = {"lead": {"company_name": "Acme", "website": "https://acme.test"}}


def test_analyze_without_key_is_rejected(client):
    r = client.post("/analyze", json=ANALYZE_BODY)
    assert r.status_code == 401


def test_analyze_with_wrong_key_is_rejected(client):
    r = client.post("/analyze", json=ANALYZE_BODY,
                    headers={"X-Engine-Key": "wrong-key"})
    assert r.status_code == 401


def test_missing_and_wrong_key_are_indistinguishable(client):
    missing = client.post("/analyze", json=ANALYZE_BODY)
    wrong = client.post("/analyze", json=ANALYZE_BODY,
                        headers={"X-Engine-Key": "wrong-key"})
    assert missing.status_code == wrong.status_code
    assert missing.json() == wrong.json()


def test_health_needs_no_key(client):
    r = client.get("/health")
    assert r.status_code == 200


def test_rejection_body_does_not_leak_the_key(client):
    r = client.post("/analyze", json=ANALYZE_BODY,
                    headers={"X-Engine-Key": "wrong-key"})
    assert VALID_KEY not in r.text


import pytest

PROTECTED = [
    ("post", "/analyze", ANALYZE_BODY),
    ("post", "/analyze/stream", ANALYZE_BODY),
    ("post", "/scrape", {"sources": ["job_board"]}),
    ("get", "/scrape/00000000-0000-0000-0000-000000000000", None),
    ("get", "/scrape/00000000-0000-0000-0000-000000000000/stream", None),
]


@pytest.mark.parametrize("method,path,body", PROTECTED)
def test_every_mutating_route_requires_the_key(client, method, path, body):
    r = getattr(client, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 401, f"{method.upper()} {path} is unauthenticated"


# Only the GET routes are exercised on the positive path. A valid key on
# POST /analyze or POST /scrape would run a real analysis against live Groq
# and Apify calls; the GET routes short-circuit on an unknown job id, so they
# prove the gate opens without doing any work.
_ORG_Q = "?org_id=11111111-1111-1111-1111-111111111111"
POSITIVE_PATH = [
    ("get", "/scrape/00000000-0000-0000-0000-000000000000" + _ORG_Q),
    ("get", "/scrape/00000000-0000-0000-0000-000000000000/stream" + _ORG_Q),
]


@pytest.mark.parametrize("method,path", POSITIVE_PATH)
def test_valid_key_is_not_rejected(client, method, path):
    """A correct key must get past auth. Downstream returns 404 for the unknown
    job id — anything but 401 proves the gate opened."""
    r = getattr(client, method)(path, headers={"X-Engine-Key": VALID_KEY})
    assert r.status_code == 404


def test_cors_is_not_wide_open(client):
    r = client.get("/health", headers={"Origin": "https://evil.test"})
    assert r.headers.get("access-control-allow-origin") != "*"

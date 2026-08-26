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

"""Test harness for the signal engine.

`main` reads configuration and constructs scrapers at import time, so every
environment variable it touches must exist before the import below runs.
"""
import os

os.environ.setdefault("ENGINE_API_KEY", "test-key-do-not-use-in-production")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("APIFY_API_TOKEN", "test-apify-token")
os.environ.setdefault("SERPER_API_KEY", "test-serper-key")

import pytest
from fastapi.testclient import TestClient

import main
import metering
from main import app
from tests.fake_store import FakeStore

VALID_KEY = os.environ["ENGINE_API_KEY"]

# A non-ANTA tenant, so a test that passes only with ANTA's values fails.
TEST_CONFIG = {
    "agency_name": "Harbor Growth Partners",
    "agency_location": "Austin, Texas",
    "services": ["Paid Social Campaigns", "Marketing Automation"],
    "target_locations": ["Austin", "Texas", "TX"],
    "target_industries": ["dental clinics"],
    "target_roles": ["marketing coordinator"],
    "active_sources": ["linkedin", "crunchbase", "job_board", "local_business"],
}


def tenant_config():
    return main.PlatformConfig(**TEST_CONFIG)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def store(monkeypatch) -> FakeStore:
    """Every test gets its own in-memory run store instead of Postgres."""
    fake = FakeStore()
    monkeypatch.setattr(main, "get_store", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def usage(monkeypatch) -> list[dict]:
    """Usage rows recorded during the test, instead of writes to Postgres."""
    rows: list[dict] = []
    monkeypatch.setattr(metering, "_write", rows.append)
    return rows

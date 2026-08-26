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

from main import app

VALID_KEY = os.environ["ENGINE_API_KEY"]


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)

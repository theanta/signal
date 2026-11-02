"""Shared-secret authentication for the signal engine.

The engine holds SUPABASE_SERVICE_ROLE_KEY and writes directly to the database,
so it must never accept an unauthenticated request. It is called only by the
Express backend, server-to-server.
"""
import hmac
import os

from fastapi import Header, HTTPException

ENGINE_KEY_HEADER = "X-Engine-Key"


def _expected_key() -> str:
    key = os.environ.get("ENGINE_API_KEY")
    if not key:
        # Fail closed. A missing secret must stop the process, never widen access.
        raise RuntimeError(
            "ENGINE_API_KEY is not set. The signal engine refuses to start "
            "without it — an unauthenticated engine exposes the Supabase "
            "service-role key to anyone who finds its URL."
        )
    return key


def require_engine_key(x_engine_key: str | None = Header(None)) -> None:
    """Reject any caller that cannot present the shared secret.

    A missing key and a wrong key return the same response, so the header's
    absence tells a prober nothing. compare_digest keeps the comparison
    constant-time so the secret cannot be recovered by timing.
    """
    expected = _expected_key()
    if x_engine_key is None or not hmac.compare_digest(x_engine_key, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def verify_engine_key_configured() -> None:
    """Call at startup so misconfiguration surfaces on boot, not on first request."""
    _expected_key()

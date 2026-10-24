"""Usage metering: one usage_events row per call to a paid external service.

The org (and scrape run, if any) reach the call sites through context
variables, so scrapers and enrichment helpers need no extra parameters.
`asyncio.to_thread` copies the context into the worker thread, so a value
bound in the request or background task is visible inside the sync call.

Metering never raises: a failed usage write must not fail the scrape or the
analysis that caused it.
"""

import logging
from contextvars import ContextVar
from typing import Optional

logger = logging.getLogger(__name__)

PROVIDERS = ("apify", "serper", "groq", "millionverifier")

_org_id: ContextVar[Optional[str]] = ContextVar("metering_org_id", default=None)
_job_id: ContextVar[Optional[str]] = ContextVar("metering_job_id", default=None)


def bind(org_id: str, job_id: Optional[str] = None) -> None:
    """Attribute every call made from here on (in this context) to this org."""
    _org_id.set(org_id)
    _job_id.set(job_id)


def record(provider: str, operation: str, units: int, cost_cents: Optional[int] = None) -> None:
    org_id = _org_id.get()
    if not org_id:
        logger.warning(f"[metering] {provider}:{operation} called with no org bound; not recorded")
        return
    row = {
        "org_id": org_id,
        "job_id": _job_id.get(),
        "provider": provider,
        "operation": operation,
        "units": max(0, int(units or 0)),
        "cost_cents": cost_cents,
    }
    try:
        _write(row)
    except Exception as e:
        logger.error(f"[metering] could not record {provider}:{operation} for org {org_id}: {e}")


def _write(row: dict) -> None:
    from jobstore import get_store
    get_store().db.table("usage_events").insert(row).execute()


def usd_to_cents(usd: Optional[float]) -> Optional[int]:
    if usd is None:
        return None
    try:
        return round(float(usd) * 100)
    except (TypeError, ValueError):
        return None

"""Base class for Apify-backed scrapers."""

import logging
import os
from abc import ABC, abstractmethod
from datetime import timedelta
from decimal import Decimal

from apify_client import ApifyClient

import metering

logger = logging.getLogger(__name__)

# LinkedIn scraper needs time for browser startup + multi-keyword scraping
DEFAULT_TIMEOUT_SECS = 300

# Spending ceiling for a single actor run, enforced by Apify itself. Pay-per-
# event actors stop charging at this amount; it is the backstop for an actor
# that ignores the item limit in its own input.
MAX_CHARGE_USD_PER_RUN = Decimal(os.environ.get("APIFY_MAX_CHARGE_USD_PER_RUN", "0.50"))


class ApifyBaseScraper(ABC):
    def __init__(self, timeout_secs: int = DEFAULT_TIMEOUT_SECS):
        self.token = os.environ.get("APIFY_API_TOKEN", "")
        self.timeout_secs = timeout_secs
        if not self.token:
            logger.warning("APIFY_API_TOKEN is not set — scraper will return empty results")

    def _run_actor(self, actor_id: str, run_input: dict, max_items: int) -> list[dict]:
        """Run an actor and return at most `max_items` of its results.

        Each actor names its own result limit differently (LinkedIn's is
        `jobs_entries`, and it silently ignores `limit`), so the scraper's
        input is not trusted alone. Apify enforces two ceilings of its own:
        `max_items` stops a pay-per-result actor charging past that many
        results, and `max_total_charge_usd` caps a pay-per-event one."""
        if not self.token:
            return []
        client = ApifyClient(self.token)
        logger.info(f"[Apify] Starting actor {actor_id} (max {max_items} items)")
        run = client.actor(actor_id).call(
            run_input=run_input,
            max_items=max_items,
            max_total_charge_usd=MAX_CHARGE_USD_PER_RUN,
            wait_duration=timedelta(seconds=self.timeout_secs),
            # The client otherwise streams the actor's own log into ours on a
            # background thread, which times out on long runs and crashes
            # with a misleading traceback. Our logs report each run's result.
            logger=None,
        )
        if not run:
            logger.warning(f"[Apify] Actor {actor_id} returned no run object")
            return []
        items = client.dataset(run.default_dataset_id).list_items(limit=max_items).items
        logger.info(f"[Apify] Actor {actor_id} returned {len(items)} items")
        metering.record("apify", f"actor:{actor_id}", len(items or []),
                        metering.usd_to_cents(getattr(run, "usage_total_usd", None)))
        return items or []

    @abstractmethod
    def scrape(self) -> list[dict]:
        ...

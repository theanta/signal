"""Base class for Apify-backed scrapers."""

import logging
import os
from abc import ABC, abstractmethod
from datetime import timedelta

from apify_client import ApifyClient

logger = logging.getLogger(__name__)

# Generous timeout — actor runs include browser startup + scraping time
DEFAULT_TIMEOUT_SECS = 180


class ApifyBaseScraper(ABC):
    def __init__(self, timeout_secs: int = DEFAULT_TIMEOUT_SECS):
        self.token = os.environ.get("APIFY_API_TOKEN", "")
        self.timeout_secs = timeout_secs
        if not self.token:
            logger.warning("APIFY_API_TOKEN is not set — scraper will return empty results")

    def _run_actor(self, actor_id: str, run_input: dict) -> list[dict]:
        if not self.token:
            return []
        client = ApifyClient(self.token)
        logger.info(f"[Apify] Starting actor {actor_id}")
        run = client.actor(actor_id).call(
            run_input=run_input,
            wait_duration=timedelta(seconds=self.timeout_secs),
        )
        if not run:
            logger.warning(f"[Apify] Actor {actor_id} returned no run object")
            return []
        items = client.dataset(run.default_dataset_id).list_items().items
        logger.info(f"[Apify] Actor {actor_id} returned {len(items)} items")
        return items or []

    @abstractmethod
    def scrape(self) -> list[dict]:
        ...

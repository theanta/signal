"""Base scraper with rate limiting and retry logic."""

import time
import random
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

import requests
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


class BaseScraper(ABC):
    def __init__(self, delay_ms: int = 1500, max_retries: int = 3):
        self.delay_ms = delay_ms
        self.max_retries = max_retries
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)

    def _sleep(self):
        jitter = random.uniform(0.5, 1.5)
        time.sleep((self.delay_ms / 1000) * jitter)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def _get(self, url: str, params: Optional[dict] = None) -> Optional[requests.Response]:
        self._sleep()
        resp = self.session.get(url, params=params, timeout=15)
        resp.raise_for_status()
        return resp

    def _parse(self, html: str) -> BeautifulSoup:
        return BeautifulSoup(html, "lxml")

    def _now(self) -> str:
        return datetime.utcnow().isoformat()

    @abstractmethod
    def scrape(self) -> list[dict]:
        """Scrape leads and return list of raw lead dicts."""
        ...

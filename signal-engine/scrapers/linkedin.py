"""LinkedIn Jobs scraper - replaces Wellfound, uses Apify to handle JS rendering."""

import logging
from .apify_base import ApifyBaseScraper

logger = logging.getLogger(__name__)

LINKEDIN_ACTOR = "bebity/linkedin-jobs-scraper"

# Roles that signal either operational pain or active tech build
TARGET_ROLES = [
    "software engineer",
    "frontend developer",
    "react developer",
    "full stack developer",
    "operations manager",
    "operations coordinator",
    "backend engineer",
]


class LinkedInJobsScraper(ApifyBaseScraper):
    """
    Pulls LinkedIn job postings via Apify.
    Replaces the broken Wellfound HTML scraper.
    Location-filtered to Michigan and date-filtered to last 24 hours.
    """

    def __init__(self, target_locations: list[str] | None = None, **kwargs):
        super().__init__(**kwargs)
        locs = target_locations or ["Michigan, United States"]
        # LinkedIn location strings need to be "City, State, Country" format
        self.location = locs[0]

    def scrape(self) -> list[dict]:
        queries = [
            {"keyword": role, "location": self.location, "dateSincePosted": "past 24 hours"}
            for role in TARGET_ROLES[:5]
        ]

        items = []
        try:
            items = self._run_actor(LINKEDIN_ACTOR, {
                "searchQueries": queries,
                "maxResults": 25,
            })
        except Exception as e:
            logger.warning(f"[LinkedIn] Actor run failed: {e}")

        leads = []
        for item in items:
            lead = self._map_item(item)
            if lead:
                leads.append(lead)

        logger.info(f"[LinkedIn] {len(leads)} leads from {len(items)} raw items")
        return self._deduplicate(leads)

    def _map_item(self, item: dict) -> dict | None:
        company = item.get("companyName") or item.get("company") or ""
        if not company:
            return None

        job_title = item.get("title") or item.get("positionName") or ""
        location = item.get("location") or item.get("jobLocation") or ""
        source_url = item.get("url") or item.get("jobUrl") or ""
        description = (item.get("description") or "")[:500]

        is_operational = any(
            kw in job_title.lower()
            for kw in ["coordinator", "operations", "ops", "data entry", "analyst"]
        )
        signal = (
            f"Hiring {job_title} on LinkedIn — likely scaling operations manually"
            if is_operational
            else f"Hiring {job_title} on LinkedIn — actively building tech team"
        )

        return {
            "company_name": company,
            "website": item.get("companyUrl") or None,
            "location": location,
            "job_title": job_title,
            "hiring_signal": signal,
            "source_url": source_url,
            "source": "linkedin",
            "description": description,
        }

    def _deduplicate(self, leads: list[dict]) -> list[dict]:
        seen: set[str] = set()
        unique = []
        for lead in leads:
            key = lead.get("company_name", "").lower().strip()
            if key and key not in seen:
                seen.add(key)
                unique.append(lead)
        return unique

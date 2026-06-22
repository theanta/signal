"""LinkedIn Jobs scraper - uses Apify worldunboxer actor (free tier)."""

import logging
from .apify_base import ApifyBaseScraper

logger = logging.getLogger(__name__)

# bebity/linkedin-jobs-scraper required a $15/month rental; worldunboxer is free
LINKEDIN_ACTOR = "worldunboxer/rapid-linkedin-scraper"

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
    Location-filtered to Michigan and date-filtered to last 24 hours.
    """

    def __init__(self, target_locations: list[str] | None = None, **kwargs):
        super().__init__(**kwargs)
        locs = target_locations or ["Michigan, United States"]
        self.location = locs[0]

    def scrape(self) -> list[dict]:
        items = []
        try:
            items = self._run_actor(LINKEDIN_ACTOR, {
                "keywords": TARGET_ROLES,
                "location": self.location,
                # r86400 = LinkedIn's native filter code for "past 24 hours"
                "datePosted": "r86400",
                "limit": 50,
            })
        except Exception as e:
            logger.error(f"[LinkedIn] Actor run failed: {e}")

        leads = []
        for item in items:
            lead = self._map_item(item)
            if lead:
                leads.append(lead)

        logger.info(f"[LinkedIn] {len(leads)} leads from {len(items)} raw items")
        return self._deduplicate(leads)

    def _map_item(self, item: dict) -> dict | None:
        # Guard against different field naming conventions across actor versions
        company = (
            item.get("company_name") or item.get("companyName") or
            item.get("company") or item.get("Company") or ""
        )
        if not company:
            return None

        job_title = (
            item.get("job_title") or item.get("jobTitle") or
            item.get("title") or item.get("positionName") or ""
        )
        location = item.get("location") or item.get("jobLocation") or ""
        source_url = item.get("job_url") or item.get("jobUrl") or item.get("url") or ""
        description = (item.get("job_description") or item.get("description") or "")[:500]

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
            "website": item.get("company_url") or item.get("companyUrl") or None,
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

"""LinkedIn Jobs scraper - uses Apify worldunboxer actor (free tier)."""

import logging
from .apify_base import ApifyBaseScraper
from .targeting import hiring_roles, search_locations

logger = logging.getLogger(__name__)

# bebity/linkedin-jobs-scraper required a $15/month rental; worldunboxer is free
LINKEDIN_ACTOR = "worldunboxer/rapid-linkedin-scraper"

class LinkedInJobsScraper(ApifyBaseScraper):
    """
    Pulls LinkedIn job postings via Apify for the tenant's hiring roles, in
    up to two of its target locations, posted in the last 24 hours.
    """

    # Split across the locations searched, so the Apify cost of a run does not
    # grow with the number of locations.
    TOTAL_LIMIT = 50

    def __init__(self, target_locations: list[str] | None = None,
                 target_roles: list[str] | None = None, **kwargs):
        super().__init__(**kwargs)
        self.locations = search_locations(target_locations)
        self.roles = hiring_roles(target_roles, limit=7)

    def scrape(self) -> list[dict]:
        if not self.locations:
            raise RuntimeError("No target locations configured — set them in Settings")
        per_location = max(1, self.TOTAL_LIMIT // len(self.locations))
        # Let actor failures propagate — the caller (main.py) records them as a
        # real "failed" status instead of us silently reporting "0 leads found".
        items = []
        for location in self.locations:
            items.extend(self._run_actor(LINKEDIN_ACTOR, {
                "keywords": self.roles,
                "location": location,
                # r86400 = LinkedIn's native filter code for "past 24 hours"
                "datePosted": "r86400",
                "limit": per_location,
            }))

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
            # The actor's company_url is the LinkedIn company page, NOT the
            # company's own site — storing it as website poisons every
            # downstream enrichment step (verify, tech stack, contact search).
            "website": None,
            "linkedin_url": item.get("company_url") or item.get("companyUrl") or None,
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

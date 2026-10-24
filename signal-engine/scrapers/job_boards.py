"""Job board scraper - uses Apify's Indeed actor for operational hiring signals."""

import logging
from .apify_base import ApifyBaseScraper
from .targeting import hiring_roles, search_locations

logger = logging.getLogger(__name__)

INDEED_ACTOR = "misceres/indeed-scraper"

# The country Indeed searches in. Locations are the tenant's own.
INDEED_COUNTRY = "US"
INDEED_MAX_ITEMS = 20  # per role


class JobBoardScraper(ApifyBaseScraper):
    """
    Pulls job postings from Indeed via Apify for the tenant's hiring roles,
    spread across up to two of its target locations. Operational hiring
    suggests manual-process pain; other hiring suggests a growing team.
    """

    def __init__(
        self,
        target_locations: list[str] | None = None,
        target_roles: list[str] | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.locations = search_locations(target_locations)
        self.roles = hiring_roles(target_roles)

    def scrape(self) -> list[dict]:
        if not self.locations:
            raise RuntimeError("No target locations configured — set them in Settings")
        leads = []
        errors: list[str] = []

        # One Indeed run per role (the actor takes one position per run),
        # rotating through the locations so the run count stays at len(roles).
        for i, role in enumerate(self.roles):
            location = self.locations[i % len(self.locations)]
            try:
                batch = self._scrape_role(role, location)
                leads.extend(batch)
                logger.info(f"[JobBoard] {len(batch)} leads for '{role}' in {location}")
            except Exception as e:
                errors.append(str(e))
                logger.warning(f"[JobBoard] Failed for '{role}': {e}")

        # If every role query errored out, this is a real failure — surface it
        # instead of silently reporting "0 leads found".
        if errors and len(errors) == len(self.roles):
            raise RuntimeError(f"All {len(self.roles)} Indeed queries failed: {errors[0]}")

        return self._deduplicate(leads)

    def _scrape_role(self, role: str, location: str) -> list[dict]:
        items = self._run_actor(INDEED_ACTOR, {
            "position": role,
            "location": location,
            "country": INDEED_COUNTRY,
            "maxItems": INDEED_MAX_ITEMS,
            "saveOnlyUniqueItems": True,
        }, max_items=INDEED_MAX_ITEMS)
        leads = []
        for item in items:
            lead = self._map_item(item, role)
            if lead:
                leads.append(lead)
        return leads

    def _map_item(self, item: dict, role: str) -> dict | None:
        company = item.get("company") or item.get("companyName") or ""
        if not company:
            return None

        job_title = item.get("positionName") or item.get("title") or role.title()
        location = item.get("location") or item.get("jobLocation") or ""
        source_url = item.get("url") or item.get("externalApplyLink") or ""
        description = (item.get("description") or "")[:500]

        is_operational = any(
            kw in role.lower()
            for kw in ["coordinator", "data entry", "analyst", "spreadsheet", "process"]
        )
        signal = (
            f"Hiring {job_title} — likely running manual processes"
            if is_operational
            else f"Hiring {job_title} — growing the team"
        )

        return {
            "company_name": company,
            "location": location,
            "job_title": job_title,
            "hiring_signal": signal,
            "source_url": source_url,
            "source": "job_board",
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

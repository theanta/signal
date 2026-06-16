"""Crunchbase scraper - replaces Product Hunt, targets funded Michigan startups."""

import logging
from .apify_base import ApifyBaseScraper

logger = logging.getLogger(__name__)

CRUNCHBASE_ACTOR = "epctex/crunchbase-scraper"

# Search terms for recently-funded Michigan companies across target industries
SEARCH_QUERIES = [
    "Michigan software startup funded",
    "Detroit tech startup",
    "Michigan SaaS company",
    "Ann Arbor startup funding",
    "Michigan logistics technology",
]

MAX_ITEMS_PER_QUERY = 10


class CrunchbaseScraper(ApifyBaseScraper):
    """
    Pulls recently funded Michigan startups from Crunchbase via Apify.
    Replaces the ProductHunt scraper which was global and JS-blocked.
    Funded + Michigan = high-intent prospect actively investing in growth.
    """

    def scrape(self) -> list[dict]:
        leads = []
        for query in SEARCH_QUERIES:
            try:
                items = self._run_actor(CRUNCHBASE_ACTOR, {
                    "search": query,
                    "maxItems": MAX_ITEMS_PER_QUERY,
                })
                for item in items:
                    lead = self._map_item(item)
                    if lead:
                        leads.append(lead)
                logger.info(f"[Crunchbase] {len(items)} items for '{query}'")
            except Exception as e:
                logger.warning(f"[Crunchbase] Failed for '{query}': {e}")

        logger.info(f"[Crunchbase] {len(leads)} total leads before dedup")
        return self._deduplicate(leads)

    def _map_item(self, item: dict) -> dict | None:
        company = item.get("name") or item.get("title") or ""
        if not company:
            return None

        description = (
            item.get("shortDescription")
            or item.get("description")
            or ""
        )[:500]

        location = (
            item.get("location")
            or item.get("headquartersLocation")
            or item.get("city")
            or ""
        )

        website = item.get("website") or item.get("websiteUrl") or None
        source_url = item.get("url") or item.get("crunchbaseUrl") or ""

        funding = item.get("fundingTotal") or item.get("totalFunding") or ""
        last_funded = item.get("lastFundingDate") or item.get("lastFundingAt") or ""
        employees = item.get("employeeCount") or item.get("numEmployeesEnum") or ""

        funding_note = f" | Funding: {funding}" if funding else ""
        signal = f"Recently funded Michigan startup on Crunchbase{funding_note}"

        return {
            "company_name": company,
            "website": website,
            "location": location,
            "job_title": "Founder / Leadership",
            "hiring_signal": signal,
            "source_url": source_url,
            "source": "crunchbase",
            "description": description,
            "company_size": employees or None,
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

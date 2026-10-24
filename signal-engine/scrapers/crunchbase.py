"""Crunchbase scraper - recently funded companies in the tenant's target market."""

import logging
from .apify_base import ApifyBaseScraper
from .targeting import search_locations

logger = logging.getLogger(__name__)

CRUNCHBASE_ACTOR = "epctex/crunchbase-scraper"

MAX_ITEMS_PER_QUERY = 10
MAX_QUERIES = 5  # cap Apify actor runs


def build_queries(target_locations: list[str] | None,
                  target_industries: list[str] | None) -> list[str]:
    """`<industry> <location>` for the tenant's industries and locations, or
    funded-startup searches per location when it has listed no industries."""
    locations = search_locations(target_locations)
    industries = [i.strip() for i in (target_industries or []) if i and i.strip()]
    if industries:
        queries = [f"{ind} {loc}" for loc in locations for ind in industries[:3]]
    else:
        queries = [q for loc in locations for q in (f"{loc} startup funded", f"{loc} growing company")]
    return queries[:MAX_QUERIES]


class CrunchbaseScraper(ApifyBaseScraper):
    """
    Pulls recently funded companies from Crunchbase via Apify, searched by the
    tenant's industries and locations. Funded + in-market = a prospect
    actively investing in growth.
    """

    def __init__(self, target_locations: list[str] | None = None,
                 target_industries: list[str] | None = None, **kwargs):
        super().__init__(**kwargs)
        self.queries = build_queries(target_locations, target_industries)

    def scrape(self) -> list[dict]:
        if not self.queries:
            raise RuntimeError("No target locations configured — set them in Settings")
        leads = []
        errors: list[str] = []
        for query in self.queries:
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
                errors.append(str(e))
                logger.warning(f"[Crunchbase] Failed for '{query}': {e}")

        # If every query errored out, this is a real failure (e.g. actor unrentable,
        # auth broken) — surface it instead of silently reporting "0 leads found".
        if errors and len(errors) == len(self.queries):
            raise RuntimeError(f"All {len(self.queries)} Crunchbase queries failed: {errors[0]}")

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
        where = f" in {location}" if location else ""
        signal = f"Recently funded company{where} on Crunchbase{funding_note}"

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

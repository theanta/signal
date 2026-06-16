"""Local business scraper - uses Apify's Google Maps actor with configurable location + industry."""

import logging
from .apify_base import ApifyBaseScraper

logger = logging.getLogger(__name__)

GOOGLE_MAPS_ACTOR = "compass/crawler-google-places"

# Used when no target_industries are configured
DEFAULT_INDUSTRY_TERMS = [
    "software company",
    "tech startup",
    "manufacturing company",
    "logistics company",
]

MAX_PLACES_PER_QUERY = 15
MAX_QUERIES = 8  # cap Apify actor runs


class LocalBusinessScraper(ApifyBaseScraper):
    """
    Finds local businesses via Google Maps using Apify.
    Location and industry terms are driven entirely by PlatformConfig — no hardcoded geography.
    """

    def __init__(
        self,
        target_locations: list[str] | None = None,
        target_industries: list[str] | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.locations = self._pick_locations(target_locations or [])
        self.industry_terms = self._build_industry_terms(target_industries or [])

    def _pick_locations(self, locations: list[str]) -> list[str]:
        # Drop abbreviations (≤3 chars like "MI", "IL") — Google Maps needs real place names
        meaningful = [loc for loc in locations if len(loc) > 3]
        return meaningful[:3] if meaningful else ["United States"]

    def _build_industry_terms(self, industries: list[str]) -> list[str]:
        if industries:
            return [f"{ind.lower()} company" for ind in industries[:4]]
        return DEFAULT_INDUSTRY_TERMS

    def scrape(self) -> list[dict]:
        queries = [
            f"{industry} {location}"
            for location in self.locations
            for industry in self.industry_terms
        ][:MAX_QUERIES]

        logger.info(f"[LocalBusiness] Running {len(queries)} Google Maps queries across {self.locations}")

        leads = []
        try:
            items = self._run_actor(GOOGLE_MAPS_ACTOR, {
                "searchStringsArray": queries,
                "maxCrawledPlacesPerSearch": MAX_PLACES_PER_QUERY,
                "language": "en",
                "maxReviews": 0,
            })
            for item in items:
                lead = self._map_item(item)
                if lead:
                    leads.append(lead)
            logger.info(f"[LocalBusiness] {len(leads)} leads from Google Maps")
        except Exception as e:
            logger.warning(f"[LocalBusiness] Error: {e}")

        return self._deduplicate(leads)

    def _map_item(self, item: dict) -> dict | None:
        company_name = item.get("title") or ""
        if not company_name:
            return None

        city = item.get("city") or ""
        state = item.get("state") or ""
        address = item.get("address") or ""
        location = f"{city}, {state}".strip(", ") if city or state else address or ""

        category = item.get("categoryName") or item.get("category") or "Business"
        website = item.get("website") or None
        source_url = item.get("url") or ""
        description = (item.get("description") or category)[:500]

        return {
            "company_name": company_name,
            "website": website,
            "location": location,
            "source_url": source_url,
            "source": "local_business",
            "description": description,
            "hiring_signal": f"Active {category} found via Google Maps",
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

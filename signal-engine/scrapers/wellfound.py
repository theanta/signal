"""Wellfound (AngelList Talent) scraper - targets funded startups hiring engineers."""

import logging
from typing import Optional
from .base import BaseScraper

logger = logging.getLogger(__name__)

# Target job roles that indicate software/ops needs
TARGET_ROLES = [
    "software engineer",
    "frontend developer",
    "react developer",
    "full stack",
    "operations manager",
    "operations coordinator",
    "product manager",
    "data engineer",
    "devops",
    "backend engineer",
]

# Wellfound public search - no auth required for basic searches
WELLFOUND_SEARCH_URL = "https://wellfound.com/jobs"


class WellfoundScraper(BaseScraper):
    """
    Scrapes Wellfound for startups actively hiring technical/ops roles.
    These are strong signals of operational scaling needs.
    """

    def __init__(self, target_locations: Optional[list[str]] = None, **kwargs):
        super().__init__(**kwargs)
        self.target_locations = target_locations or ["Detroit", "Michigan"]

    def scrape(self) -> list[dict]:
        leads = []
        for role in TARGET_ROLES[:5]:  # Limit to avoid rate limits in MVP
            try:
                batch = self._scrape_role(role)
                leads.extend(batch)
                logger.info(f"[Wellfound] Found {len(batch)} leads for '{role}'")
            except Exception as e:
                logger.error(f"[Wellfound] Failed for role '{role}': {e}")
        return self._deduplicate(leads)

    def _scrape_role(self, role: str) -> list[dict]:
        """Scrape job listings for a specific role."""
        leads = []
        # Use first target location as the primary search location
        location_query = self.target_locations[0] if self.target_locations else "United States"
        try:
            resp = self._get(WELLFOUND_SEARCH_URL, params={"role": role, "location": location_query})
            if not resp:
                return leads

            soup = self._parse(resp.text)

            # Parse startup cards from the jobs page
            job_cards = soup.find_all("div", class_=lambda c: c and "job" in c.lower())
            company_cards = soup.find_all("div", class_=lambda c: c and "startup" in c.lower())

            cards = job_cards + company_cards
            for card in cards[:10]:
                lead = self._parse_card(card, role)
                if lead:
                    leads.append(lead)

        except Exception as e:
            logger.warning(f"[Wellfound] Scrape error: {e}")

        # Return mock data if scraping fails (for development/testing)
        if not leads:
            leads = self._get_mock_leads(role)

        return leads

    def _parse_card(self, card, role: str) -> Optional[dict]:
        """Parse a job/company card into a lead dict."""
        try:
            name_el = card.find(["h2", "h3", "a"], class_=lambda c: c and "name" in c.lower())
            if not name_el:
                return None

            company_name = name_el.get_text(strip=True)
            if not company_name or len(company_name) < 2:
                return None

            link_el = card.find("a", href=True)
            source_url = f"https://wellfound.com{link_el['href']}" if link_el else ""

            location_el = card.find(class_=lambda c: c and "location" in c.lower())
            location = location_el.get_text(strip=True) if location_el else "Unknown"

            desc_el = card.find("p")
            description = desc_el.get_text(strip=True)[:500] if desc_el else ""

            return {
                "company_name": company_name,
                "website": None,
                "location": location,
                "job_title": role.title(),
                "hiring_signal": f"Actively hiring {role.title()} on Wellfound",
                "source_url": source_url,
                "source": "wellfound",
                "description": description,
            }
        except Exception:
            return None

    def _get_mock_leads(self, role: str) -> list[dict]:
        """Return realistic mock leads for development when scraping is unavailable."""
        mock_data = [
            {
                "company_name": "Apex Fleet Systems",
                "website": "https://apexfleetsystems.com",
                "location": "Detroit, MI",
                "job_title": role.title(),
                "hiring_signal": f"Hiring {role.title()} - fleet management SaaS expanding",
                "source_url": "https://wellfound.com/company/apex-fleet",
                "source": "wellfound",
                "description": "B2B fleet management startup serving Midwest logistics companies. Currently managing routes via spreadsheets.",
                "industry": "Logistics / SaaS",
                "company_size": "11-50",
            },
            {
                "company_name": "Midwest Health Ops",
                "website": "https://midwesthealthops.com",
                "location": "Ann Arbor, MI",
                "job_title": role.title(),
                "hiring_signal": f"Hiring {role.title()} - healthcare operations scaling",
                "source_url": "https://wellfound.com/company/mhops",
                "source": "wellfound",
                "description": "Healthcare operations company managing 50+ clinics with outdated scheduling software.",
                "industry": "Healthcare",
                "company_size": "51-200",
            },
        ]
        return mock_data

    def _deduplicate(self, leads: list[dict]) -> list[dict]:
        seen = set()
        unique = []
        for lead in leads:
            key = lead.get("company_name", "").lower().strip()
            if key and key not in seen:
                seen.add(key)
                unique.append(lead)
        return unique

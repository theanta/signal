"""Job board scraper - searches Indeed/SimplyHired for operational hiring signals."""

import logging
import re
from .base import BaseScraper

logger = logging.getLogger(__name__)

# Strong operational pain signals
OPERATIONAL_ROLES = [
    "operations coordinator",
    "data entry specialist",
    "excel analyst",
    "process improvement",
    "workflow coordinator",
    "operations manager",
    "spreadsheet analyst",
    "manual data entry",
    "reporting analyst",
]

TECH_ROLES = [
    "react developer",
    "frontend developer",
    "full stack developer",
    "software engineer",
    "next.js developer",
    "web developer",
]

INDEED_URL = "https://www.indeed.com/jobs"


class JobBoardScraper(BaseScraper):
    """
    Scrapes job boards for companies hiring in ways that signal agency opportunities.
    Operational hiring = process pain. Tech hiring = build partner.
    """

    def __init__(self, target_locations: list[str] | None = None, **kwargs):
        super().__init__(**kwargs)
        locs = target_locations or ["Michigan", "Detroit, MI"]
        # Use first two distinct locations for broad + narrow searches
        self.broad_location = locs[0]
        self.narrow_location = locs[1] if len(locs) > 1 else locs[0]

    def scrape(self) -> list[dict]:
        leads = []

        # Scrape operational signals
        for role in OPERATIONAL_ROLES[:3]:
            try:
                batch = self._scrape_indeed(role, location=self.broad_location)
                leads.extend(batch)
            except Exception as e:
                logger.warning(f"[JobBoard] Failed for '{role}': {e}")

        # Scrape tech hiring signals
        for role in TECH_ROLES[:2]:
            try:
                batch = self._scrape_indeed(role, location=self.narrow_location)
                leads.extend(batch)
            except Exception as e:
                logger.warning(f"[JobBoard] Failed for '{role}': {e}")

        if not leads:
            leads = self._get_mock_leads()

        return self._deduplicate(leads)

    def _scrape_indeed(self, role: str, location: str) -> list[dict]:
        leads = []
        try:
            resp = self._get(INDEED_URL, params={"q": role, "l": location, "fromage": "7"})
            if not resp:
                return leads

            soup = self._parse(resp.text)
            job_cards = soup.find_all("div", class_=lambda c: c and ("job_seen_beacon" in (c or "") or "tapItem" in (c or "")))

            for card in job_cards[:8]:
                lead = self._parse_indeed_card(card, role)
                if lead:
                    leads.append(lead)
        except Exception as e:
            logger.debug(f"[Indeed] {e}")

        return leads

    def _parse_indeed_card(self, card, role: str) -> dict | None:
        try:
            company_el = card.find(class_=lambda c: c and "company" in c.lower())
            if not company_el:
                return None
            company_name = company_el.get_text(strip=True)

            location_el = card.find(class_=lambda c: c and "location" in c.lower())
            location = location_el.get_text(strip=True) if location_el else "Michigan"

            job_el = card.find(["h2", "a"], class_=lambda c: c and "title" in c.lower())
            job_title = job_el.get_text(strip=True) if job_el else role.title()

            link_el = card.find("a", href=lambda h: h and "/rc/clk" in h)
            source_url = f"https://indeed.com{link_el['href']}" if link_el else ""

            is_operational = any(r in role.lower() for r in ["coordinator", "data entry", "analyst", "spreadsheet"])
            signal = (
                f"Hiring {job_title} — likely running manual processes"
                if is_operational
                else f"Hiring {job_title} — scaling tech team"
            )

            return {
                "company_name": company_name,
                "location": location,
                "job_title": job_title,
                "hiring_signal": signal,
                "source_url": source_url,
                "source": "job_board",
            }
        except Exception:
            return None

    def _get_mock_leads(self) -> list[dict]:
        return [
            {
                "company_name": "Great Lakes Distribution Co.",
                "website": "https://greatlakesdist.com",
                "location": "Detroit, MI",
                "job_title": "Operations Coordinator",
                "hiring_signal": "Hiring Operations Coordinator — likely managing logistics manually",
                "source_url": "https://indeed.com/job/great-lakes-ops",
                "source": "job_board",
                "description": "Regional distribution company hiring ops coordinator to manage spreadsheet-based inventory.",
                "industry": "Logistics / Distribution",
                "company_size": "51-200",
            },
            {
                "company_name": "Precision Auto Parts Inc.",
                "website": "https://precisionautoparts.com",
                "location": "Dearborn, MI",
                "job_title": "Data Entry Specialist",
                "hiring_signal": "Hiring Data Entry Specialist — strong signal of manual data workflows",
                "source_url": "https://indeed.com/job/precision-auto-data",
                "source": "job_board",
                "description": "Auto parts supplier still managing purchase orders and inventory in Excel.",
                "industry": "Manufacturing / Automotive",
                "company_size": "51-200",
            },
            {
                "company_name": "Catalyst Staffing Group",
                "website": "https://catalyststaffing.com",
                "location": "Troy, MI",
                "job_title": "React Developer",
                "hiring_signal": "Hiring React Developer — building new internal tools",
                "source_url": "https://indeed.com/job/catalyst-react",
                "source": "job_board",
                "description": "Mid-size staffing firm building internal CRM and reporting dashboards.",
                "industry": "Staffing / HR Tech",
                "company_size": "51-200",
            },
            {
                "company_name": "Vantage Freight Solutions",
                "website": "https://vantagefreight.com",
                "location": "Livonia, MI",
                "job_title": "Full Stack Developer",
                "hiring_signal": "Hiring Full Stack Developer — digitizing freight operations",
                "source_url": "https://indeed.com/job/vantage-fullstack",
                "source": "job_board",
                "description": "Freight broker scaling rapidly, building customer portal and shipment tracking system.",
                "industry": "Logistics / Freight",
                "company_size": "11-50",
            },
        ]

    def _deduplicate(self, leads: list[dict]) -> list[dict]:
        seen = set()
        unique = []
        for lead in leads:
            key = lead.get("company_name", "").lower().strip()
            if key and key not in seen:
                seen.add(key)
                unique.append(lead)
        return unique

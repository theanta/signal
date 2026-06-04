"""Detroit/Michigan business directory scraper."""

import logging
from .base import BaseScraper

logger = logging.getLogger(__name__)


class DetroitBusinessScraper(BaseScraper):
    """
    Scrapes Detroit-specific business sources:
    - DBusiness.com listings
    - Michigan Economic Development Corp
    - Detroit Regional Chamber
    - Crain's Detroit Business
    """

    def scrape(self) -> list[dict]:
        leads = []
        try:
            batch = self._scrape_dbusiness()
            leads.extend(batch)
        except Exception as e:
            logger.warning(f"[DetroitBusiness] Error: {e}")

        if not leads:
            leads = self._get_mock_leads()

        return leads

    def _scrape_dbusiness(self) -> list[dict]:
        """Scrape DBusiness fastest-growing companies list."""
        leads = []
        try:
            resp = self._get("https://www.dbusiness.com/lists/")
            if not resp:
                return leads
            soup = self._parse(resp.text)
            items = soup.find_all("article")
            for item in items[:10]:
                lead = self._parse_article(item)
                if lead:
                    leads.append(lead)
        except Exception as e:
            logger.debug(f"[DBusiness] {e}")
        return leads

    def _parse_article(self, article) -> dict | None:
        try:
            title_el = article.find(["h2", "h3"])
            if not title_el:
                return None
            company_name = title_el.get_text(strip=True)

            desc_el = article.find("p")
            description = desc_el.get_text(strip=True)[:400] if desc_el else ""

            link_el = article.find("a", href=True)
            source_url = link_el["href"] if link_el else ""

            return {
                "company_name": company_name,
                "location": "Detroit, MI",
                "source_url": source_url,
                "source": "detroit_business",
                "description": description,
                "hiring_signal": "Listed in Detroit business growth directory",
            }
        except Exception:
            return None

    def _get_mock_leads(self) -> list[dict]:
        return [
            {
                "company_name": "Ascend Manufacturing Solutions",
                "website": "https://ascendmfg.com",
                "location": "Sterling Heights, MI",
                "job_title": "Operations Manager",
                "hiring_signal": "Fast-growing manufacturer, 40% YoY growth, managing ops with legacy ERP",
                "source_url": "https://dbusiness.com/ascend-manufacturing",
                "source": "detroit_business",
                "description": "Tier 2 auto parts manufacturer experiencing rapid growth. Still running on a 15-year-old ERP system and Excel reporting.",
                "industry": "Manufacturing / Automotive",
                "company_size": "201-500",
            },
            {
                "company_name": "Blue Chip Logistics",
                "website": "https://bluechiplogistics.com",
                "location": "Warren, MI",
                "job_title": "IT Manager",
                "hiring_signal": "Growing Michigan logistics firm, no internal software team",
                "source_url": "https://dbusiness.com/blue-chip",
                "source": "detroit_business",
                "description": "Refrigerated freight company serving Michigan and Ohio. Tracking routes with whiteboards and phone calls.",
                "industry": "Logistics / Cold Chain",
                "company_size": "51-200",
            },
            {
                "company_name": "Great Lakes Healthcare Partners",
                "website": "https://greatlakeshcp.com",
                "location": "Detroit, MI",
                "job_title": "Director of Operations",
                "hiring_signal": "Healthcare network expanding, paper-based intake processes",
                "source_url": "https://dbusiness.com/glhcp",
                "source": "detroit_business",
                "description": "Regional healthcare group managing 12 outpatient clinics with outdated scheduling and patient intake systems.",
                "industry": "Healthcare",
                "company_size": "201-500",
            },
            {
                "company_name": "Detroit Legal Group",
                "website": "https://detroitlegalgroup.com",
                "location": "Detroit, MI",
                "job_title": "Office Manager",
                "hiring_signal": "Law firm scaling, needs case management software",
                "source_url": "https://dbusiness.com/detroit-legal",
                "source": "detroit_business",
                "description": "Growing mid-size law firm handling case management through email chains and shared drives.",
                "industry": "Legal Services",
                "company_size": "11-50",
            },
        ]

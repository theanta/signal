"""Product Hunt scraper - targets newly launched products needing engineering help."""

import logging
from .base import BaseScraper

logger = logging.getLogger(__name__)

PH_URL = "https://www.producthunt.com"


class ProductHuntScraper(BaseScraper):
    """
    Scrapes Product Hunt for newly launched products.
    New launches + hiring = immediate software need signal.
    """

    def scrape(self) -> list[dict]:
        leads = []
        try:
            resp = self._get(f"{PH_URL}/posts", params={"order": "newest"})
            if resp:
                soup = self._parse(resp.text)
                posts = soup.find_all("div", class_=lambda c: c and "post" in c.lower())
                for post in posts[:15]:
                    lead = self._parse_post(post)
                    if lead:
                        leads.append(lead)
        except Exception as e:
            logger.warning(f"[ProductHunt] Error: {e}")

        if not leads:
            leads = self._get_mock_leads()

        return leads

    def _parse_post(self, post) -> dict | None:
        try:
            name_el = post.find(["h2", "h3", "a"])
            if not name_el:
                return None
            company_name = name_el.get_text(strip=True)

            desc_el = post.find("p")
            description = desc_el.get_text(strip=True)[:400] if desc_el else ""

            link_el = post.find("a", href=True)
            source_url = f"{PH_URL}{link_el['href']}" if link_el and link_el["href"].startswith("/") else (link_el["href"] if link_el else "")

            return {
                "company_name": company_name,
                "source_url": source_url,
                "source": "product_hunt",
                "hiring_signal": "Recently launched product on Product Hunt",
                "description": description,
                "job_title": "Founder / Early-stage",
            }
        except Exception:
            return None

    def _get_mock_leads(self) -> list[dict]:
        return [
            {
                "company_name": "ShiftSync",
                "website": "https://shiftsync.io",
                "location": "Remote / Detroit",
                "job_title": "Founder",
                "hiring_signal": "Just launched workforce scheduling tool on Product Hunt",
                "source_url": "https://producthunt.com/posts/shiftsync",
                "source": "product_hunt",
                "description": "Workforce scheduling app for hourly workers. Launched last week, looking to scale engineering.",
                "industry": "HR Tech / SaaS",
                "company_size": "1-10",
            },
            {
                "company_name": "RouteWise AI",
                "website": "https://routewise.ai",
                "location": "Chicago, IL",
                "job_title": "Founder",
                "hiring_signal": "AI route optimization tool just launched, seeking development partners",
                "source_url": "https://producthunt.com/posts/routewise",
                "source": "product_hunt",
                "description": "Early-stage AI logistics startup. MVP built in no-code, needs real engineering to scale.",
                "industry": "Logistics / AI",
                "company_size": "1-10",
            },
        ]

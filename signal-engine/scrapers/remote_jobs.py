"""Remote job openings scraper - uses Apify's Indeed actor filtered to remote-only postings.

Two disqualifiers apply that don't exist on the other job scrapers:
  - freshness: posting must be <= MAX_POSTING_AGE_DAYS old (Indeed has no native
    "last 3 days" filter, so we parse the actor's relative postedAt string ourselves)
  - citizenship/residency restriction: a "remote" posting that's actually gated to
    citizens/residents of one country isn't a fit for a global remote-candidate engine
"""

import logging
import re
from .apify_base import ApifyBaseScraper

logger = logging.getLogger(__name__)

INDEED_ACTOR = "misceres/indeed-scraper"

MAX_POSTING_AGE_DAYS = 3

DEFAULT_ROLES = [
    "software engineer",
    "full stack developer",
    "product designer",
]

# Indeed's "country" input wants an ISO2 code — map the common region names
# surfaced in settings to a code, defaulting to a broad US search.
_REGION_TO_COUNTRY = {
    "united states": "US", "us": "US", "usa": "US",
    "united kingdom": "GB", "uk": "GB",
    "canada": "CA",
    "australia": "AU",
    "india": "IN",
    "europe": "DE",
    "worldwide": "US",
}

# Restrictive residency/citizenship phrasing — deliberately narrow (country/demonym +
# citizen|resident + a restrictive qualifier) to avoid false-positiving on generic
# "must be authorized to work in the US" boilerplate, which doesn't bar remote applicants.
_RESTRICTION_RE = re.compile(
    r"("
    r"(u\.?s\.?|usa|united states|uk|u\.?k\.?|united kingdom|canada|canadian|australia|australian)"
    r"\s*(citizens?|residents?)\s*only"
    r"|must\s+be\s+a\s+(u\.?s\.?|uk|u\.?k\.?|united states|united kingdom|canadian|australian)\s*(citizen|resident)"
    r"|open\s+only\s+to\s+(u\.?s\.?|uk|u\.?k\.?|united states|united kingdom|canadian|australian)\s*(citizens?|residents?)"
    r"|restricted\s+to\s+(u\.?s\.?|uk|u\.?k\.?|united states|united kingdom|canadian|australian)\s*(citizens?|residents?)"
    r"|must\s+(reside|be\s+located|be\s+based)\s+in\s+the\s+(u\.?s\.?|united states|uk|united kingdom)\s*(only)?"
    r")",
    re.IGNORECASE,
)

_AGE_RE = re.compile(r"(\d+)\s*\+?\s*(hour|day|week|month|year)", re.IGNORECASE)


def _is_recent_enough(posted_at: str, max_days: int = MAX_POSTING_AGE_DAYS) -> bool:
    """Parse Indeed's relative postedAt string. Unparseable strings are kept
    (not silently dropped) so an unexpected actor field format doesn't zero
    out an entire scrape run."""
    if not posted_at:
        return True

    s = posted_at.strip().lower()
    if any(kw in s for kw in ("today", "just posted", "just now", "new")):
        return True

    match = _AGE_RE.search(s)
    if not match:
        return True

    amount, unit = int(match.group(1)), match.group(2)
    days = {
        "hour": 0,
        "day": amount,
        "week": amount * 7,
        "month": amount * 30,
        "year": amount * 365,
    }[unit]

    return days <= max_days


def _is_citizen_restricted(text: str) -> bool:
    return bool(_RESTRICTION_RE.search(text or ""))


class RemoteJobsScraper(ApifyBaseScraper):
    """
    Pulls remote-only job postings from Indeed via Apify.
    Filters to postings <= 3 days old and excludes ones gated to a single
    country's citizens/residents — this source is for globally-open remote roles.
    """

    def __init__(
        self,
        job_roles: list[str] | None = None,
        experience_level: str | None = None,
        technologies: list[str] | None = None,
        regions: list[str] | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.job_roles = job_roles or DEFAULT_ROLES
        self.experience_level = experience_level or ""
        self.technologies = technologies or []
        regions = regions or ["United States"]
        self.country = _REGION_TO_COUNTRY.get(regions[0].strip().lower(), "US")

    def _build_queries(self) -> list[str]:
        tech = self.technologies[0] if self.technologies else ""
        queries = []
        for role in self.job_roles[:3]:
            parts = ["remote", self.experience_level, tech, role]
            queries.append(" ".join(p for p in parts if p).strip())
        return queries

    def scrape(self) -> list[dict]:
        leads = []
        errors: list[str] = []
        queries = self._build_queries()

        for query in queries:
            try:
                items = self._run_actor(INDEED_ACTOR, {
                    "position": query,
                    "location": "Remote",
                    "country": self.country,
                    "maxItems": 20,
                    "saveOnlyUniqueItems": True,
                })
                batch = [lead for item in items if (lead := self._map_item(item, query))]
                leads.extend(batch)
                logger.info(f"[RemoteJobs] {len(batch)} leads for '{query}' ({len(items)} raw)")
            except Exception as e:
                errors.append(str(e))
                logger.warning(f"[RemoteJobs] Failed for '{query}': {e}")

        if errors and len(errors) == len(queries):
            raise RuntimeError(f"All {len(queries)} remote job queries failed: {errors[0]}")

        return self._deduplicate(leads)

    def _map_item(self, item: dict, query: str) -> dict | None:
        company = item.get("company") or item.get("companyName") or ""
        if not company:
            return None

        job_title = item.get("positionName") or item.get("title") or query.title()
        location = item.get("location") or item.get("jobLocation") or "Remote"
        source_url = item.get("url") or item.get("externalApplyLink") or ""
        description = item.get("description") or ""
        posted_at = item.get("postedAt") or item.get("date") or ""

        if not _is_recent_enough(posted_at):
            return None

        if _is_citizen_restricted(f"{job_title} {description}"):
            logger.info(f"[RemoteJobs] Disqualified '{job_title}' at {company} — residency/citizenship restricted")
            return None

        return {
            "company_name": company,
            "location": location,
            "job_title": job_title,
            "hiring_signal": f"Hiring {job_title} (remote) — actively growing distributed team",
            "source_url": source_url,
            "source": "remote_jobs",
            "description": description[:500],
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

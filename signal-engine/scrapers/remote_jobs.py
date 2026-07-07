"""Remote job openings scraper - pulls remote-only postings from four sources:
Indeed and LinkedIn (via Apify actors) plus RemoteOK and Remotive (free public
JSON APIs, no token needed).

Two disqualifiers apply that don't exist on the other job scrapers:
  - freshness: posting must be <= MAX_POSTING_AGE_DAYS old. None of the four
    sources expose a native "last 3 days" filter, so we parse whatever date
    shape each one returns ourselves (relative string, ISO 8601, or epoch).
  - citizenship/residency restriction: a "remote" posting that's actually gated
    to citizens/residents of one country isn't a fit for a global remote-candidate engine
"""

import logging
import re
from datetime import datetime, timezone

import requests

from .apify_base import ApifyBaseScraper

logger = logging.getLogger(__name__)

INDEED_ACTOR = "misceres/indeed-scraper"
LINKEDIN_ACTOR = "worldunboxer/rapid-linkedin-scraper"

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


def _is_recent_enough(posted_at, max_days: int = MAX_POSTING_AGE_DAYS) -> bool:
    """Parse a posting's date, whatever shape the source gave it — Indeed/LinkedIn's
    relative strings ("3 days ago"), Remotive's ISO 8601 timestamps, or RemoteOK's
    unix-epoch seconds. Unparseable/missing values are kept (not silently dropped)
    so an unexpected field format doesn't zero out an entire scrape run."""
    if posted_at is None or posted_at == "":
        return True

    if isinstance(posted_at, (int, float)):
        try:
            posted = datetime.fromtimestamp(posted_at, tz=timezone.utc)
        except (ValueError, OSError, OverflowError):
            return True
        return (datetime.now(timezone.utc) - posted).days <= max_days

    s = str(posted_at).strip()

    try:
        posted = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if posted.tzinfo is None:
            posted = posted.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - posted).days <= max_days
    except ValueError:
        pass

    s_lower = s.lower()
    if any(kw in s_lower for kw in ("today", "just posted", "just now", "new")):
        return True

    match = _AGE_RE.search(s_lower)
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
    Pulls remote-only job postings from Indeed, LinkedIn, RemoteOK, and Remotive.
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
        """Returns one dict per job posting (see the per-source `_map_*` methods)
        — these are written directly to the `jobs` table, not merged into the
        `leads` pipeline."""
        postings: list[dict] = []
        errors: list[str] = []
        providers = [
            ("indeed", self._scrape_indeed),
            ("linkedin", self._scrape_linkedin),
            ("remoteok", self._scrape_remoteok),
            ("remotive", self._scrape_remotive),
        ]

        for name, fn in providers:
            try:
                batch = fn()
                postings.extend(batch)
                logger.info(f"[RemoteJobs] {len(batch)} postings from {name}")
            except Exception as e:
                errors.append(str(e))
                logger.warning(f"[RemoteJobs] {name} failed: {e}")

        if errors and len(errors) == len(providers):
            raise RuntimeError(f"All {len(providers)} remote job sources failed: {errors[0]}")

        return self._deduplicate(postings)

    # ---- Indeed (Apify) ----

    def _scrape_indeed(self) -> list[dict]:
        postings = []
        for query in self._build_queries():
            items = self._run_actor(INDEED_ACTOR, {
                "position": query,
                "location": "Remote",
                "country": self.country,
                "maxItems": 20,
                "saveOnlyUniqueItems": True,
            })
            postings.extend(p for item in items if (p := self._map_indeed_item(item, query)))
        return postings

    def _map_indeed_item(self, item: dict, query: str) -> dict | None:
        company = item.get("company") or item.get("companyName") or ""
        if not company:
            return None

        job_title = item.get("positionName") or item.get("title") or query.title()
        description = item.get("description") or ""
        posted_at = item.get("postedAt") or item.get("date") or ""

        if not _is_recent_enough(posted_at):
            return None
        if _is_citizen_restricted(f"{job_title} {description}"):
            logger.info(f"[RemoteJobs] Disqualified '{job_title}' at {company} — residency/citizenship restricted")
            return None

        job_type = item.get("jobType") or []
        return {
            "external_id": item.get("id") or item.get("positionId") or None,
            "company_name": company,
            "location": item.get("location") or item.get("jobLocation") or "Remote",
            "job_title": job_title,
            "employment_type": ", ".join(job_type) if isinstance(job_type, list) else (job_type or None),
            "salary_text": item.get("salary") or None,
            "posted_at_raw": posted_at or None,
            "technologies": [t for t in self.technologies if t],
            "source_url": item.get("url") or item.get("externalApplyLink") or "",
            "description": description,
            "source": "indeed",
        }

    # ---- LinkedIn (Apify) ----

    def _scrape_linkedin(self) -> list[dict]:
        items = self._run_actor(LINKEDIN_ACTOR, {
            "keywords": self.job_roles[:3],
            "location": "Remote",
            # r604800 = LinkedIn's native "past week" filter code — its date filter
            # only supports discrete windows (24h/week/month), none of which is an
            # exact 3-day cutoff, so we take the closest broader one and let
            # _is_recent_enough() trim it down to MAX_POSTING_AGE_DAYS below.
            "datePosted": "r604800",
            "limit": 30,
        })
        return [p for item in items if (p := self._map_linkedin_item(item))]

    def _map_linkedin_item(self, item: dict) -> dict | None:
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
        description = item.get("job_description") or item.get("description") or ""
        posted_at = (
            item.get("postedAt") or item.get("listedAt") or
            item.get("postedDate") or item.get("date") or ""
        )

        if not _is_recent_enough(posted_at):
            return None
        if _is_citizen_restricted(f"{job_title} {description}"):
            logger.info(f"[RemoteJobs] Disqualified '{job_title}' at {company} — residency/citizenship restricted")
            return None

        external_id = item.get("id") or item.get("jobId")
        return {
            "external_id": f"linkedin:{external_id}" if external_id else None,
            "company_name": company,
            "location": item.get("location") or item.get("jobLocation") or "Remote",
            "job_title": job_title,
            "employment_type": item.get("employment_type") or item.get("employmentType") or None,
            "salary_text": item.get("salary") or None,
            "posted_at_raw": posted_at or None,
            "technologies": [t for t in self.technologies if t],
            "source_url": item.get("job_url") or item.get("jobUrl") or item.get("url") or "",
            "description": description,
            "source": "linkedin",
        }

    # ---- RemoteOK (free public API, no key) ----

    def _scrape_remoteok(self) -> list[dict]:
        resp = requests.get(
            "https://remoteok.com/api",
            headers={"User-Agent": "Mozilla/5.0 (compatible; SignalBot/1.0)"},
            timeout=15,
        )
        resp.raise_for_status()
        items = resp.json()

        # RemoteOK's /api has no search param — it's the full firehose — so filter
        # client-side against our target roles/technologies.
        postings = []
        for item in items:
            # The feed's first element is a legal notice, not a job — it has no "id".
            if not isinstance(item, dict) or not item.get("id"):
                continue
            if not self._matches_target_roles(item.get("position", ""), item.get("tags") or []):
                continue
            posting = self._map_remoteok_item(item)
            if posting:
                postings.append(posting)
        return postings

    def _matches_target_roles(self, title: str, tags: list[str]) -> bool:
        """RemoteOK has no search param and Remotive's `search` param is a loose
        full-text match (a "react developer" query surfaces copywriters and sales
        roles) — both need this client-side keyword filter against our configured
        roles/technologies to stay relevant."""
        keywords = [r.lower() for r in self.job_roles] + [t.lower() for t in self.technologies if t]
        if not keywords:
            return True
        haystack = f"{title} {' '.join(tags)}".lower()
        return any(k in haystack for k in keywords)

    def _map_remoteok_item(self, item: dict) -> dict | None:
        company = item.get("company") or ""
        if not company:
            return None

        job_title = item.get("position") or ""
        description = item.get("description") or ""

        if not _is_recent_enough(item.get("epoch")):
            return None
        if _is_citizen_restricted(f"{job_title} {description}"):
            logger.info(f"[RemoteJobs] Disqualified '{job_title}' at {company} — residency/citizenship restricted")
            return None

        salary_min, salary_max = item.get("salary_min"), item.get("salary_max")
        salary_text = f"${salary_min:,}–${salary_max:,}" if salary_min and salary_max else None

        return {
            "external_id": f"remoteok:{item['id']}",
            "company_name": company,
            "location": item.get("location") or "Remote",
            "job_title": job_title,
            "employment_type": None,
            "salary_text": salary_text,
            "posted_at_raw": item.get("date") or None,
            "technologies": [t for t in (item.get("tags") or []) if t],
            "source_url": item.get("url") or "",
            "description": description,
            "source": "remoteok",
        }

    # ---- Remotive (free public API, no key) ----

    def _scrape_remotive(self) -> list[dict]:
        postings = []
        for query in self._build_queries():
            resp = requests.get(
                "https://remotive.com/api/remote-jobs",
                params={"search": query},
                timeout=15,
            )
            resp.raise_for_status()
            items = (resp.json() or {}).get("jobs") or []
            relevant = (item for item in items if self._matches_target_roles(item.get("title", ""), item.get("tags") or []))
            postings.extend(p for item in relevant if (p := self._map_remotive_item(item)))
        return postings

    def _map_remotive_item(self, item: dict) -> dict | None:
        company = item.get("company_name") or ""
        if not company:
            return None

        job_title = item.get("title") or ""
        description = item.get("description") or ""
        location = item.get("candidate_required_location") or "Remote"

        if not _is_recent_enough(item.get("publication_date")):
            return None
        if _is_citizen_restricted(f"{job_title} {location} {description}"):
            logger.info(f"[RemoteJobs] Disqualified '{job_title}' at {company} — residency/citizenship restricted")
            return None

        external_id = item.get("id")
        return {
            "external_id": f"remotive:{external_id}" if external_id else None,
            "company_name": company,
            "location": location,
            "job_title": job_title,
            "employment_type": item.get("job_type") or None,
            "salary_text": item.get("salary") or None,
            "posted_at_raw": item.get("publication_date") or None,
            "technologies": [t for t in (item.get("tags") or []) if t],
            "source_url": item.get("url") or "",
            "description": description,
            "source": "remotive",
        }

    def _deduplicate(self, postings: list[dict]) -> list[dict]:
        """Dedup within a single scrape run only — cross-run upsert dedup
        (by external_id/source_url) happens where postings are persisted."""
        seen: set[str] = set()
        unique = []
        for posting in postings:
            key = posting.get("external_id") or posting.get("source_url") or ""
            if key and key not in seen:
                seen.add(key)
                unique.append(posting)
        return unique

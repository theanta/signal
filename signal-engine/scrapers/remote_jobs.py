"""Remote job openings scraper - pulls remote-only postings from four sources:
Indeed and LinkedIn (via Apify actors) plus RemoteOK and Remotive (free public
JSON APIs, no token needed).

Postings are NOT filtered here beyond having a company name and being at most
MAX_POSTING_AGE_DAYS old — content triage (citizenship gating, no-agency
clauses, etc.) happens at persist time via analyzers.job_qualifier, so
disqualified postings stay visible with a 'skip' verdict instead of silently
disappearing. Stale postings are the exception: past a week the role is
usually filled or ghosted, so they're dropped at scrape time.
"""

import logging
from datetime import datetime, timedelta, timezone

import requests

from analyzers.job_qualifier import parse_posted_at

from .apify_base import ApifyBaseScraper

logger = logging.getLogger(__name__)

INDEED_ACTOR = "misceres/indeed-scraper"
LINKEDIN_ACTOR = "worldunboxer/rapid-linkedin-scraper"

MAX_POSTING_AGE_DAYS = 7

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


class RemoteJobsScraper(ApifyBaseScraper):
    """
    Pulls remote-only job postings from Indeed, LinkedIn, RemoteOK, and Remotive.
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

    def _is_fresh(self, posted_at_raw: str | None) -> bool:
        """True when the posting is at most MAX_POSTING_AGE_DAYS old. Undated
        postings are kept — the qualifier surfaces missing dates downstream
        rather than us guessing here. LinkedIn skips this check: its actor is
        already scoped server-side via the datePosted filter."""
        parsed = parse_posted_at(posted_at_raw)
        if not parsed:
            return True
        posted = datetime.fromisoformat(parsed)
        if posted.tzinfo is None:  # Remotive dates come through naive; treat as UTC
            posted = posted.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - posted <= timedelta(days=MAX_POSTING_AGE_DAYS)

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
            postings.extend(
                p for item in items
                if (p := self._map_indeed_item(item, query)) and self._is_fresh(p["posted_at_raw"])
            )
        return postings

    def _map_indeed_item(self, item: dict, query: str) -> dict | None:
        company = item.get("company") or item.get("companyName") or ""
        if not company:
            return None

        job_title = item.get("positionName") or item.get("title") or query.title()
        description = item.get("description") or ""
        posted_at = item.get("postedAt") or item.get("date") or ""

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
            # r604800 = LinkedIn's native "past week" filter code — scope the actor
            # to recent postings so we don't pull LinkedIn's full backlog.
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
            if posting and self._is_fresh(posting["posted_at_raw"]):
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
            postings.extend(
                p for item in relevant
                if (p := self._map_remotive_item(item)) and self._is_fresh(p["posted_at_raw"])
            )
        return postings

    def _map_remotive_item(self, item: dict) -> dict | None:
        company = item.get("company_name") or ""
        if not company:
            return None

        job_title = item.get("title") or ""
        description = item.get("description") or ""
        location = item.get("candidate_required_location") or "Remote"

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

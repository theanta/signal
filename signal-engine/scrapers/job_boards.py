"""Job board scraper - uses Apify's Indeed actor for operational hiring signals."""

import logging
from .apify_base import ApifyBaseScraper

logger = logging.getLogger(__name__)

INDEED_ACTOR = "misceres/indeed-scraper"

# Operational roles signal manual-process pain → automation/ops opportunity
OPERATIONAL_ROLES = [
    "operations coordinator",
    "data entry specialist",
    "process improvement manager",
    "operations manager",
    "reporting analyst",
]

# Tech roles signal active build work → dev agency opportunity
TECH_ROLES = [
    "react developer",
    "full stack developer",
    "software engineer",
]


class JobBoardScraper(ApifyBaseScraper):
    """
    Pulls job postings from Indeed via Apify.
    Operational hiring = manual process pain. Tech hiring = build partner.
    """

    def __init__(
        self,
        target_locations: list[str] | None = None,
        agency_location: str | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)

        if not target_locations and not agency_location:
            self.broad_location = "Michigan, USA"
            self.narrow_location = "Detroit, MI"
            return

        locs = target_locations or []
        # target_locations are plain city/state names (e.g. "Detroit", "MI") with no
        # "City, State" formatting — derive the state from agency_location (e.g.
        # "Detroit, Michigan") to build proper broad/narrow search strings.
        state = agency_location.split(",")[-1].strip() if agency_location and "," in agency_location else None

        # Operational-role search: state-wide — casts a wide net for manual-process pain
        self.broad_location = f"{state}, USA" if state else (locs[0] if locs else "Michigan, USA")

        # Tech-role search: one specific city — Indeed's location filter returns better
        # matches with a "City, State" string than a bare state name
        city = next((l for l in locs if len(l) > 3 and l != state), None)
        if city and state:
            self.narrow_location = f"{city}, {state}"
        elif city:
            self.narrow_location = city
        else:
            self.narrow_location = self.broad_location

    def scrape(self) -> list[dict]:
        leads = []
        errors: list[str] = []
        attempts = 0

        for role in OPERATIONAL_ROLES[:3]:
            attempts += 1
            try:
                batch = self._scrape_role(role, self.broad_location)
                leads.extend(batch)
                logger.info(f"[JobBoard] {len(batch)} leads for '{role}'")
            except Exception as e:
                errors.append(str(e))
                logger.warning(f"[JobBoard] Failed for '{role}': {e}")

        for role in TECH_ROLES[:2]:
            attempts += 1
            try:
                batch = self._scrape_role(role, self.narrow_location)
                leads.extend(batch)
                logger.info(f"[JobBoard] {len(batch)} leads for '{role}'")
            except Exception as e:
                errors.append(str(e))
                logger.warning(f"[JobBoard] Failed for '{role}': {e}")

        # If every role query errored out, this is a real failure — surface it
        # instead of silently reporting "0 leads found".
        if errors and len(errors) == attempts:
            raise RuntimeError(f"All {attempts} Indeed queries failed: {errors[0]}")

        return self._deduplicate(leads)

    def _scrape_role(self, role: str, location: str) -> list[dict]:
        items = self._run_actor(INDEED_ACTOR, {
            "position": role,
            "location": location,
            "country": "US",
            "maxItems": 20,
            "saveOnlyUniqueItems": True,
        })
        leads = []
        for item in items:
            lead = self._map_item(item, role)
            if lead:
                leads.append(lead)
        return leads

    def _map_item(self, item: dict, role: str) -> dict | None:
        company = item.get("company") or item.get("companyName") or ""
        if not company:
            return None

        job_title = item.get("positionName") or item.get("title") or role.title()
        location = item.get("location") or item.get("jobLocation") or ""
        source_url = item.get("url") or item.get("externalApplyLink") or ""
        description = (item.get("description") or "")[:500]

        is_operational = any(
            kw in role.lower()
            for kw in ["coordinator", "data entry", "analyst", "spreadsheet", "process"]
        )
        signal = (
            f"Hiring {job_title} — likely running manual processes"
            if is_operational
            else f"Hiring {job_title} — scaling tech team"
        )

        return {
            "company_name": company,
            "location": location,
            "job_title": job_title,
            "hiring_signal": signal,
            "source_url": source_url,
            "source": "job_board",
            "description": description,
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

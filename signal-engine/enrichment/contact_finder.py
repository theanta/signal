"""Find a decision-maker contact using Apollo.io with website email scraping as fallback."""

import os
import re
import requests
from urllib.parse import urljoin, urlparse

APOLLO_API_KEY = os.getenv("APOLLO_API_KEY", "")

_DECISION_MAKER_TITLES = [
    "CEO", "Founder", "Co-Founder", "Owner", "President",
    "COO", "CTO", "VP Operations", "Director of Operations",
    "VP Engineering", "Head of Engineering", "Managing Director",
    "General Manager",
]

_APOLLO_HEADERS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
}

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; ANTALeadRadar/1.0)"})

# Contact/about pages that commonly expose real email addresses
_CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/about-us", "/team", "/our-team", "/people"]

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
# Generic/role addresses to skip — they're not decision-maker inboxes
_GENERIC_PREFIXES = {"info", "hello", "hi", "support", "help", "contact", "sales",
                     "admin", "noreply", "no-reply", "team", "press", "media",
                     "jobs", "careers", "billing", "accounts", "privacy", "legal"}


def _extract_domain(url: str | None) -> str | None:
    if not url:
        return None
    match = re.search(r"(?:https?://)?(?:www\.)?([^/\s]+)", url)
    return match.group(1) if match else None


# ============================================================
# Stage 1 — Apollo: search for a decision-maker by title
# ============================================================

def _apollo_search(company_name: str, domain: str | None) -> dict | None:
    """
    Search Apollo's people index for a decision-maker at this company.
    Returns the raw Apollo person dict or None.
    """
    if not APOLLO_API_KEY:
        return None

    headers = {**_APOLLO_HEADERS, "X-Api-Key": APOLLO_API_KEY}

    # Resolve domain from company name when we have no website
    if not domain and company_name:
        try:
            r = requests.post(
                "https://api.apollo.io/api/v1/organizations/enrich",
                headers=headers,
                json={"name": company_name, "domain": None},
                timeout=10,
            )
            if r.status_code == 200:
                org = r.json().get("organization", {})
                domain = org.get("primary_domain") or domain
        except Exception:
            pass

    if not domain and not company_name:
        return None

    try:
        payload: dict = {
            "page": 1,
            "per_page": 5,
            "person_titles": _DECISION_MAKER_TITLES,
        }
        if domain:
            payload["organization_domains"] = [domain]
        else:
            payload["q_organization_name"] = company_name

        r = requests.post(
            "https://api.apollo.io/api/v1/mixed_people/search",
            headers=headers,
            json=payload,
            timeout=12,
        )
        if r.status_code != 200:
            return None

        people = r.json().get("people", [])
        if not people:
            return None

        # Prefer verified non-catch-all email; fall back to first result with any data
        return next(
            (p for p in people if p.get("email") and "catch_all" not in p.get("email_status", "")),
            people[0],
        )
    except Exception:
        return None


# ============================================================
# Stage 2 — Apollo: targeted email lookup for a named person
# ============================================================

def _apollo_match_email(first_name: str, last_name: str, domain: str) -> tuple[str | None, str]:
    """
    Apollo people/match — finds a verified email for a specific named person.
    More precise than the general search; hits Apollo's dedicated email-finder endpoint.
    Returns (email, confidence_label).
    """
    if not APOLLO_API_KEY or not first_name or not last_name or not domain:
        return None, "unknown"
    try:
        r = requests.post(
            "https://api.apollo.io/api/v1/people/match",
            headers={**_APOLLO_HEADERS, "X-Api-Key": APOLLO_API_KEY},
            json={
                "first_name": first_name,
                "last_name": last_name,
                "organization_name": domain,
                "domain": domain,
                "reveal_personal_emails": False,
            },
            timeout=12,
        )
        if r.status_code != 200:
            return None, "unknown"

        person = r.json().get("person", {})
        email = person.get("email", "")
        status = person.get("email_status", "")

        if not email:
            return None, "unknown"

        if status == "verified":
            return email, "verified"
        if "catch_all" in status:
            return email, "catch_all"
        return email, "unknown"
    except Exception:
        return None, "unknown"


# ============================================================
# Stage 3 — Website scraping: extract emails from contact pages
# ============================================================

def _scrape_site_emails(website: str) -> list[tuple[str, str]]:
    """
    Fetch the company's contact/about/team pages and extract real email addresses.
    Returns a list of (email, page_path) tuples, personal addresses ranked first.
    """
    if not website:
        return []

    base = website.rstrip("/")
    parsed = urlparse(base if base.startswith("http") else "https://" + base)
    domain_host = parsed.netloc or parsed.path

    found: dict[str, str] = {}  # email → path where found

    for path in _CONTACT_PATHS:
        url = f"https://{domain_host}{path}"
        try:
            resp = _SESSION.get(url, timeout=8, allow_redirects=True)
            if resp.status_code >= 400:
                continue
            emails = _EMAIL_RE.findall(resp.text)
            for email in emails:
                email_lower = email.lower()
                # Skip if already found or if it's a third-party domain (tracking pixels etc.)
                if email_lower in found:
                    continue
                email_domain = email_lower.split("@")[-1]
                if email_domain != domain_host and not domain_host.endswith(email_domain):
                    continue
                found[email_lower] = path
        except Exception:
            continue

    if not found:
        return []

    def _rank(item: tuple[str, str]) -> int:
        prefix = item[0].split("@")[0]
        return 1 if prefix in _GENERIC_PREFIXES else 0  # 0 = personal (sorted first)

    return sorted(found.items(), key=_rank)


def _pick_best_site_email(emails: list[tuple[str, str]]) -> tuple[str | None, str]:
    """
    From website-scraped emails, return the best candidate and its confidence.
    Personal addresses get "verified" (they're literally on the site); generics get "catch_all".
    """
    for email, _ in emails:
        prefix = email.split("@")[0]
        if prefix not in _GENERIC_PREFIXES:
            return email, "verified"
    # Only generic addresses found
    if emails:
        return emails[0][0], "catch_all"
    return None, "unknown"


# ============================================================
# Public API
# ============================================================

def find_contact(
    company_name: str,
    website: str | None,
    location: str | None,
) -> dict | None:
    """
    Returns a contact dict or None.

    Keys:
      name             — full name
      title            — job title
      email            — best email found
      linkedin_url     — LinkedIn profile URL
      email_confidence — one of:
          "verified"         confirmed deliverable (Apollo verified or found on company site)
          "pattern_inferred" Apollo match returned an email but status is unconfirmed
          "catch_all"        domain accepts all mail, or only generic addresses found on site
          "unknown"          email present but verification status unavailable
    """
    domain = _extract_domain(website)

    # ---- Stage 1: Apollo people search ----
    person = _apollo_search(company_name, domain)

    first_name = ""
    last_name = ""
    name = ""
    title = ""
    linkedin_url = ""
    email = ""
    email_status = ""

    if person:
        first_name = person.get("first_name", "")
        last_name = person.get("last_name", "")
        name = person.get("name") or f"{first_name} {last_name}".strip()
        title = person.get("title", "")
        linkedin_url = person.get("linkedin_url", "")
        email = person.get("email", "") or ""
        email_status = person.get("email_status", "")

    # Classify what Apollo gave us
    apollo_verified = bool(email) and email_status == "verified"
    apollo_catch_all = bool(email) and "catch_all" in email_status

    email_confidence = "unknown"
    if apollo_verified:
        email_confidence = "verified"
    elif apollo_catch_all:
        email_confidence = "catch_all"

    # ---- Stage 2: Apollo people/match for a named person when email is missing/unverified ----
    if not apollo_verified and first_name and last_name and domain:
        matched_email, matched_conf = _apollo_match_email(first_name, last_name, domain)
        if matched_email and matched_conf in ("verified", "pattern_inferred"):
            email = matched_email
            email_confidence = matched_conf

    # ---- Stage 3: Scrape company website contact/about pages ----
    if not email or email_confidence not in ("verified", "pattern_inferred"):
        site_emails = _scrape_site_emails(website or "")
        if site_emails:
            scraped_email, scraped_conf = _pick_best_site_email(site_emails)
            if scraped_email:
                # Website-scraped personal email is as trustworthy as Apollo verified
                email = scraped_email
                email_confidence = scraped_conf

    if not name and not email and not linkedin_url:
        return None

    return {
        "name": name,
        "title": title,
        "email": email,
        "linkedin_url": linkedin_url,
        "email_confidence": email_confidence,
    }

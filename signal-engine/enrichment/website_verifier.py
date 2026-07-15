"""Verify a company website URL is alive; fall back to Serper search if not."""

import os
import re
import requests
from urllib.parse import urlparse

from .url_utils import clean_company_website

SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; ANTALeadRadar/1.0)"})

_STOPWORDS = {"the", "and", "of", "inc", "llc", "corp", "co", "ltd", "plc", "group",
              "company", "corporation", "incorporated", "limited"}


def _name_tokens(company_name: str) -> list[str]:
    """Meaningful words from the company name, used to check search-result relevance."""
    words = re.findall(r"[a-z0-9]+", company_name.lower())
    return [w for w in words if len(w) > 2 and w not in _STOPWORDS]


def _is_relevant(company_name: str, link: str, title: str) -> bool:
    """
    Guard against Serper returning an unrelated top result (e.g. a generic/garbage
    company name matching some random business). Require at least half of the
    company name's meaningful tokens to appear in the result's domain or title.
    """
    tokens = _name_tokens(company_name)
    if not tokens:
        return False
    domain = (urlparse(link).netloc or "").lower().removeprefix("www.")
    haystack = f"{domain} {title.lower()}"
    hits = sum(1 for t in tokens if re.search(rf"\b{re.escape(t)}\b", haystack))
    return hits >= max(1, (len(tokens) + 1) // 2)


def _is_alive(url: str) -> bool:
    """Return True if the URL responds with a non-5xx status within 6 seconds."""
    if not url:
        return False
    try:
        if not url.startswith("http"):
            url = "https://" + url
        r = _SESSION.head(url, allow_redirects=True, timeout=6)
        return r.status_code < 500
    except Exception:
        return False


def _serper_search(company_name: str, location: str) -> str | None:
    """Use Serper (Google Search API) to find the company's canonical website."""
    if not SERPER_API_KEY:
        return None
    query = f"{company_name} {location} official website"
    try:
        r = requests.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"},
            json={"q": query, "num": 5},
            timeout=8,
        )
        data = r.json()
        for result in data.get("organic", []):
            link = result.get("link", "")
            # Skip social media / aggregator sites
            if any(skip in link for skip in ["linkedin.com", "facebook.com", "yelp.com",
                                              "yellowpages", "bbb.org", "indeed.com"]):
                continue
            # Skip results that don't plausibly refer to this company at all
            if not _is_relevant(company_name, link, result.get("title", "")):
                continue
            return link
    except Exception:
        pass
    return None


def verify_website(website: str | None, company_name: str, location: str) -> str | None:
    """
    Returns a verified website URL or None.
    1. If the existing URL is alive → return it (normalized).
    2. If dead/missing → try Serper search → return found URL.
    3. If nothing found → return None.
    """
    # Social/aggregator pages (LinkedIn company profiles etc.) are alive but
    # are never the company's own site — treat them as "no website" so the
    # Serper fallback runs and a bad URL is never echoed back to the caller.
    website = clean_company_website(website)

    if website:
        url = website if website.startswith("http") else "https://" + website
        if _is_alive(url):
            return url

    # Fallback: search for the real URL
    found = _serper_search(company_name, location or "")
    if found and _is_alive(found):
        return found

    # Return original even if we can't verify (better than nothing)
    return website or None

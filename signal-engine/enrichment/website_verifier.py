"""Verify a company website URL is alive; fall back to Serper search if not."""

import os
import re
import requests

SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; ANTALeadRadar/1.0)"})


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
            json={"q": query, "num": 3},
            timeout=8,
        )
        data = r.json()
        for result in data.get("organic", []):
            link = result.get("link", "")
            # Skip social media / aggregator sites
            if any(skip in link for skip in ["linkedin.com", "facebook.com", "yelp.com",
                                              "yellowpages", "bbb.org", "indeed.com"]):
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

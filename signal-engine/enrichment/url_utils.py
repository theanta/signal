"""Shared URL hygiene: reject social/aggregator pages masquerading as company websites."""

from urllib.parse import urlparse

# Domains that scrapers sometimes emit in the website field (e.g. a LinkedIn
# company page) but which are never a company's own site. Enrichment against
# them is wasted or actively wrong (Apollo searching linkedin.com employees).
SOCIAL_DOMAINS = frozenset({
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "yelp.com",
    "indeed.com",
    "glassdoor.com",
    "crunchbase.com",
    "yellowpages.com",
    "bbb.org",
})


def is_social_url(url: str | None) -> bool:
    if not url:
        return False
    try:
        parsed = urlparse(url if "://" in url else "https://" + url)
        host = parsed.netloc.lower().removeprefix("www.")
    except Exception:
        return False
    return any(host == d or host.endswith("." + d) for d in SOCIAL_DOMAINS)


def clean_company_website(url: str | None) -> str | None:
    """Return the URL if it can plausibly be a company's own website, else None."""
    if not url or is_social_url(url):
        return None
    return url

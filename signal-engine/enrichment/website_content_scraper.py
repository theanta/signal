"""Scrape readable text from a company's key pages for LLM analysis."""

import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; ANTALeadRadar/1.0)"})

_PAGES = ["/", "/about", "/about-us", "/services", "/what-we-do", "/careers", "/jobs", "/team"]
_MAX_CHARS = 2500
_NOISE_TAGS = ["script", "style", "nav", "footer", "header", "meta", "link", "noscript", "svg"]


def scrape_website_content(url: str) -> str:
    """
    Fetch key pages from the company website and return concatenated readable text.
    Returns empty string if the site is unreachable or no URL is provided.
    """
    if not url:
        return ""

    base = url.rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base

    parsed = urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    collected: list[str] = []
    total_chars = 0
    seen_texts: set[str] = set()

    for path in _PAGES:
        if total_chars >= _MAX_CHARS:
            break
        try:
            resp = _SESSION.get(origin + path, timeout=5, allow_redirects=True)
            if resp.status_code >= 400:
                continue
            soup = BeautifulSoup(resp.text, "lxml")
            for tag in soup(_NOISE_TAGS):
                tag.decompose()
            text = soup.get_text(separator=" ", strip=True)
            text = re.sub(r"\s+", " ", text).strip()
            if not text or text in seen_texts:
                continue
            seen_texts.add(text)
            budget = _MAX_CHARS - total_chars
            snippet = text[:budget]
            collected.append(f"[{path}]: {snippet}")
            total_chars += len(snippet)
        except Exception:
            continue

    return "\n".join(collected)

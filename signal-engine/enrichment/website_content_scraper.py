"""Scrape readable page content from a company's key pages for LLM analysis, via Crawl4AI."""

import asyncio
import logging
from urllib.parse import urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

logger = logging.getLogger(__name__)

_PAGES = ["/", "/about", "/about-us", "/services", "/what-we-do", "/careers", "/jobs", "/team"]
_MAX_CHARS = 2500

_BROWSER_CONFIG = BrowserConfig(headless=True, verbose=False)
_RUN_CONFIG = CrawlerRunConfig(
    cache_mode=CacheMode.BYPASS,
    # Strips boilerplate (nav chrome, repeated CTAs) so the LLM prompt gets signal, not noise.
    markdown_generator=DefaultMarkdownGenerator(
        content_filter=PruningContentFilter(threshold=0.45, threshold_type="dynamic"),
    ),
    excluded_tags=["script", "style", "nav", "footer", "header", "svg", "form"],
    page_timeout=6000,
    word_count_threshold=10,
    verbose=False,
)


async def scrape_website_content(url: str) -> str:
    """
    Fetch key pages from the company website concurrently and return concatenated,
    LLM-ready markdown. Returns empty string if the site is unreachable or no URL is given.
    """
    if not url:
        return ""

    base = url.rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    parsed = urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    urls = [origin + path for path in _PAGES]

    try:
        async with AsyncWebCrawler(config=_BROWSER_CONFIG) as crawler:
            results = await asyncio.gather(
                *[crawler.arun(url=u, config=_RUN_CONFIG) for u in urls],
                return_exceptions=True,
            )
    except Exception as e:
        logger.warning(f"[website_content] Crawl4AI failed to start for {origin}: {e}")
        return ""

    collected: list[str] = []
    total_chars = 0
    seen_texts: set[str] = set()

    for path, result in zip(_PAGES, results):
        if total_chars >= _MAX_CHARS:
            break
        if isinstance(result, Exception) or not result.success or (result.status_code or 200) >= 400:
            continue
        text = (result.markdown.fit_markdown or result.markdown.raw_markdown or "").strip()
        if not text or text in seen_texts:
            continue
        seen_texts.add(text)
        budget = _MAX_CHARS - total_chars
        snippet = text[:budget]
        collected.append(f"[{path}]: {snippet}")
        total_chars += len(snippet)

    return "\n".join(collected)

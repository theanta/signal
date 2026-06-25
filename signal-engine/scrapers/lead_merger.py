"""
Cross-source lead merger.

When the same company appears in multiple scrapers (LinkedIn, Indeed, Crunchbase,
Google Maps), merge them into one lead with combined signals rather than inserting
duplicate rows. The merged lead's `source` field becomes a comma-separated list
(e.g. "linkedin, job_board"), which the scorer uses to apply a multi-source bonus.
"""

import re
from urllib.parse import urlparse

_SUFFIX_RE = re.compile(
    r'\s*(inc\.?|llc\.?|corp\.?|co\.?|ltd\.?|plc\.?|group|company|corporation|incorporated|limited)\s*$',
    re.IGNORECASE,
)
_NON_ALPHA = re.compile(r'[^a-z0-9\s]')

# Highest-priority source wins for canonical name, website, source_url
_SOURCE_PRIORITY = ["linkedin", "crunchbase", "job_board", "local_business"]


def _source_rank(source: str) -> int:
    try:
        return _SOURCE_PRIORITY.index(source.strip())
    except ValueError:
        return len(_SOURCE_PRIORITY)


def _normalize_name(name: str) -> str:
    name = _SUFFIX_RE.sub("", name.lower()).strip()
    name = _NON_ALPHA.sub("", name)
    return " ".join(name.split())


def _extract_domain(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url if "://" in url else "https://" + url)
        host = parsed.netloc.lower().removeprefix("www.")
        return host or None
    except Exception:
        return None


def merge_leads(leads: list[dict]) -> list[dict]:
    """
    Group leads from all scrapers by company identity, merge their fields,
    and return one deduplicated lead per company.

    Each merged lead gains:
    - `source`: comma-separated list of contributing sources (e.g. "linkedin, job_board")
    - `_all_source_urls`: list of all source URLs from the group (used for DB dedup, stripped before insert)
    """
    # groups keyed by normalized company name; secondary index by domain
    groups: dict[str, list[dict]] = {}
    domain_to_key: dict[str, str] = {}

    for lead in leads:
        name_key = _normalize_name(lead.get("company_name", ""))
        if not name_key:
            continue

        domain = _extract_domain(lead.get("website"))

        # Look for an existing group: first by name, then by shared domain
        matched_key: str | None = None
        if name_key in groups:
            matched_key = name_key
        elif domain and domain in domain_to_key:
            matched_key = domain_to_key[domain]

        if matched_key:
            groups[matched_key].append(lead)
            if domain and domain not in domain_to_key:
                domain_to_key[domain] = matched_key
        else:
            groups[name_key] = [lead]
            if domain:
                domain_to_key[domain] = name_key

    merged = []
    for group_leads in groups.values():
        merged.append(_merge_group(group_leads))
    return merged


def _merge_group(leads: list[dict]) -> dict:
    # Sort so the highest-priority source provides canonical base fields
    sorted_leads = sorted(leads, key=lambda l: _source_rank(l.get("source", "")))
    base = dict(sorted_leads[0])

    # Collect unique sources in priority order
    seen_sources: set[str] = set()
    sources: list[str] = []
    for l in sorted_leads:
        src = (l.get("source") or "").strip()
        if src and src not in seen_sources:
            sources.append(src)
            seen_sources.add(src)

    # Combine hiring signals (unique, pipe-separated)
    seen_sigs: set[str] = set()
    signals: list[str] = []
    for l in sorted_leads:
        sig = (l.get("hiring_signal") or "").strip()
        if sig and sig not in seen_sigs:
            signals.append(sig)
            seen_sigs.add(sig)

    # Best description = longest non-empty
    best_description = max(
        (l.get("description") or "" for l in sorted_leads),
        key=len,
        default="",
    )

    # Best location = prefer entries containing a comma (city, state format)
    best_location = base.get("location") or ""
    for l in sorted_leads:
        loc = l.get("location") or ""
        if "," in loc and "," not in best_location:
            best_location = loc
            break

    # Fill in missing scalar fields from lower-priority sources
    for l in sorted_leads[1:]:
        if not base.get("website") and l.get("website"):
            base["website"] = l["website"]
        if not base.get("company_size") and l.get("company_size"):
            base["company_size"] = l["company_size"]
        if not base.get("industry") and l.get("industry"):
            base["industry"] = l["industry"]

    base["source"] = ", ".join(sources)
    base["hiring_signal"] = " | ".join(signals)
    base["description"] = best_description
    base["location"] = best_location

    # Collect all source_urls for DB dedup (stripped before insert)
    all_urls = list({l.get("source_url", "") for l in leads if l.get("source_url")})
    base["_all_source_urls"] = all_urls

    return base

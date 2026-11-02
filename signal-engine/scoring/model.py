"""Fit and Intent scores: transparent, rule-based, 0-100 each.

Every rule that contributes is returned as a factor ({label, points, max}),
so the lead page can show exactly where a score came from. A rule whose input
is unknown (no company size, no website scan) is left out of the maximum
rather than given default points: "unknown" is reported as unknown, not as a
middling score.

The AI judgment comes from the pain-point analysis; engagement is computed by
the backend from outreach history. `blend` combines whichever are present.
"""

import math
import re
from typing import Optional

from scrapers.targeting import DEFAULT_HIRING_ROLES
from scoring.lead_scorer import DIGITAL_PAIN_SIGNALS, GROWTH_SIGNALS

# Company-size bands in order, so "next to a target band" can be judged.
SIZE_BANDS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"]

DEFAULT_WEIGHTS = {"fit": 30, "intent": 30, "ai": 25, "engagement": 15}


def _round(x: float) -> int:
    """Round half up, as the backend's Math.round does. Python's round() goes
    to the nearest even number, so 82.5 would be 82 here and 83 there."""
    return math.floor(x + 0.5)


def _factor(label: str, points: int, max_points: int, detail: str = "") -> dict:
    return {"label": label, "points": points, "max": max_points, "detail": detail}


def _result(factors: list[dict], unknown: list[str]) -> dict:
    max_total = sum(f["max"] for f in factors)
    earned = sum(f["points"] for f in factors)
    score = _round(100 * earned / max_total) if max_total else None
    return {"score": score, "factors": factors, "unknown": unknown}


def _matches(needle: str, haystack: str) -> bool:
    n, h = needle.lower().strip(), haystack.lower()
    return bool(n) and re.search(r"(?<![a-z])" + re.escape(n) + r"(?![a-z])", h) is not None


def fit_score(
    *,
    company_size: Optional[str],
    industry: Optional[str],
    location: Optional[str],
    tech_stack: list[str],
    tech_gaps: list[str],
    target_company_sizes: list[str],
    target_industries: list[str],
    target_locations: list[str],
) -> dict:
    """Is this company the agency's kind of client?"""
    factors: list[dict] = []
    unknown: list[str] = []

    # Company size — 35
    size = (company_size or "").strip().lower()
    if size in SIZE_BANDS and target_company_sizes:
        targets = [s for s in target_company_sizes if s in SIZE_BANDS]
        if size in targets:
            factors.append(_factor("Company size", 35, 35, f"{size} is a target size"))
        elif any(abs(SIZE_BANDS.index(size) - SIZE_BANDS.index(t)) == 1 for t in targets):
            factors.append(_factor("Company size", 15, 35, f"{size} is next to a target size"))
        else:
            factors.append(_factor("Company size", 0, 35, f"{size} is outside the target sizes"))
    else:
        unknown.append("Company size")

    # Industry — 25
    if not target_industries:
        unknown.append("Industry (no target industries in Settings)")
    elif not industry or industry == "General Business":
        unknown.append("Industry")
    else:
        hit = next((t for t in target_industries if _matches(t, industry) or _matches(industry, t)), None)
        factors.append(_factor("Industry", 25 if hit else 0, 25,
                               f"{industry} matches {hit}" if hit else f"{industry} is not a target industry"))

    # Location — 25
    if not location:
        unknown.append("Location")
    elif target_locations:
        hit = next((t for t in target_locations if _matches(t, location)), None)
        factors.append(_factor("Location", 25 if hit else 0, 25,
                               f"in {hit}" if hit else f"{location} is outside the target locations"))
    else:
        unknown.append("Location (no target locations in Settings)")

    # Tech gaps — 15 (an empty scan means the site could not be fingerprinted)
    if tech_stack:
        n = len(tech_gaps)
        factors.append(_factor("Tech gaps", min(n * 5, 15), 15,
                               f"{n} gap(s) found on the website" if n else "no gaps found on the website"))
    else:
        unknown.append("Tech gaps (website could not be scanned)")

    return _result(factors, unknown)


def intent_score(
    *,
    job_title: Optional[str],
    hiring_signal: Optional[str],
    description: Optional[str],
    source_count: int,
    target_roles: list[str],
) -> dict:
    """Is there evidence of need or timing right now?"""
    text = f"{hiring_signal or ''} {job_title or ''} {description or ''}"
    factors: list[dict] = []
    roles = [r for r in (target_roles or DEFAULT_HIRING_ROLES) if r.strip()]

    # Hiring — 35
    role_hit = next((r for r in roles if _matches(r, f"{job_title or ''} {hiring_signal or ''}")), None)
    if role_hit:
        factors.append(_factor("Hiring", 35, 35, f"hiring a {role_hit}"))
    elif job_title or hiring_signal:
        factors.append(_factor("Hiring", 15, 35, "hiring, but not one of the target roles"))
    else:
        factors.append(_factor("Hiring", 0, 35, "no hiring signal"))

    # Pain signals — 30
    pains = [m.group(0) for p in DIGITAL_PAIN_SIGNALS if (m := re.search(p, text, re.IGNORECASE))]
    factors.append(_factor("Operational pain", min(len(pains) * 10, 30), 30,
                           ", ".join(dict.fromkeys(pains)) or "none mentioned"))

    # Growth signals — 20
    growth = [m.group(0) for p in GROWTH_SIGNALS if (m := re.search(p, text, re.IGNORECASE))]
    factors.append(_factor("Growth", min(len(growth) * 10, 20), 20,
                           ", ".join(dict.fromkeys(growth)) or "none mentioned"))

    # Corroboration — 15
    points = 15 if source_count >= 3 else 10 if source_count == 2 else 0
    factors.append(_factor("Seen on several sources", points, 15, f"{source_count} source(s)"))

    return _result(factors, [])


def normalize_weights(weights: Optional[dict]) -> dict:
    """The agency's weights, falling back per key to the defaults; negatives
    are treated as zero."""
    out = {}
    for k, default in DEFAULT_WEIGHTS.items():
        try:
            out[k] = max(0.0, float((weights or {}).get(k, default)))
        except (TypeError, ValueError):
            out[k] = float(default)
    return out


def blend(weights: Optional[dict], parts: dict) -> int:
    """Weighted average of the parts that are present (not None). A missing
    part — engagement before any outreach, the AI score when Groq is down —
    is left out and the remaining weights share its share."""
    w = normalize_weights(weights)
    present = {k: v for k, v in parts.items() if v is not None and w.get(k, 0) > 0}
    total = sum(w[k] for k in present)
    if not total:
        return 0
    return max(0, min(100, _round(sum(w[k] * present[k] for k in present) / total)))

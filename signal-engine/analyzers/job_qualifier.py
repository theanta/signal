"""Rule-based apply-worthiness triage for remote job postings.

Runs at ingest (no LLM, no network) so every row in the `jobs` table lands
with a verdict the list view can sort and filter on:

  - skip:    a hard blocker for an offshore agency submitting candidates —
             citizenship/residency gating, no-agency/C2C clauses, security
             clearance, or an onsite/hybrid requirement hiding in a "remote" posting
  - caution: worth a human look — mandatory US/EU working-hours overlap
             (translated to IST) or ghost-job markers
  - apply:   nothing tripped

Also parses `posted_at_raw` (relative strings and ISO dates) into a real
timestamp for freshness sorting.
"""

import html
import re
from datetime import datetime, timedelta, timezone

# ---- Skip: citizenship/residency gating ----
# Deliberately narrow (country/demonym + citizen|resident + a restrictive
# qualifier) to avoid false-positiving on generic "must be authorized to work
# in the US" boilerplate, which doesn't bar remote applicants.
RESTRICTION_RE = re.compile(
    r"("
    r"(u\.?s\.?|usa|united states|uk|u\.?k\.?|united kingdom|canada|canadian|australia|australian)"
    r"\s*(citizens?|residents?)\s*only"
    r"|must\s+be\s+a\s+(u\.?s\.?|uk|u\.?k\.?|united states|united kingdom|canadian|australian)\s*(citizen|resident)"
    r"|open\s+only\s+to\s+(u\.?s\.?|uk|u\.?k\.?|united states|united kingdom|canadian|australian)\s*(citizens?|residents?)"
    r"|restricted\s+to\s+(u\.?s\.?|uk|u\.?k\.?|united states|united kingdom|canadian|australian)\s*(citizens?|residents?)"
    r"|must\s+(reside|be\s+located|be\s+based)\s+in\s+the\s+(u\.?s\.?|united states|uk|united kingdom)\s*(only)?"
    r")",
    re.IGNORECASE,
)

# ---- Skip: agency-hostile clauses ----
_NO_AGENCY_RE = re.compile(
    r"("
    r"no\s+(staffing\s+|recruitment\s+|recruiting\s+)?agencies"
    r"|no\s+(third[\s-]?part(?:y|ies)|3rd[\s-]?part(?:y|ies))(\s+(agencies|recruiters|vendors|submissions))?"
    r"|no\s+c2c|no\s+corp[\s-]?to[\s-]?corp"
    r"|w-?2\s+only|only\s+w-?2"
    r"|direct\s+(applicants?|hires?|candidates?)\s+only"
    r"|no\s+recruiters?"
    r"|not\s+accepting\s+(unsolicited\s+)?(agency|recruiter|vendor|third[\s-]?party)"
    r")",
    re.IGNORECASE,
)

# ---- Skip: clearance requirements ----
_CLEARANCE_RE = re.compile(
    r"("
    r"(active\s+)?(security\s+clearance|secret\s+clearance|top\s+secret|ts/sci|public\s+trust)"
    r"\s*(is\s+)?(required|needed|mandatory)?"
    r")",
    re.IGNORECASE,
)
# Only trip when the clearance phrasing is a requirement, not a passing mention.
_CLEARANCE_REQUIRED_RE = re.compile(
    r"(security\s+clearance|secret\s+clearance|top\s+secret|ts/sci|public\s+trust)"
    r".{0,40}(required|needed|mandatory|must)"
    r"|(required|must\s+(hold|have|possess)).{0,40}(security\s+clearance|secret\s+clearance|top\s+secret|ts/sci)",
    re.IGNORECASE | re.DOTALL,
)

# ---- Skip: onsite/hybrid hiding in a "remote" posting ----
_ONSITE_RE = re.compile(
    r"("
    r"hybrid\s+(work\s+)?(model|schedule|role|position|arrangement|environment)"
    r"|\d+\s+days?\s+(a|per)\s+week\s+(in|at)\s+(the\s+)?office"
    r"|on[\s-]?site\s+(presence\s+)?(is\s+)?(required|expected|mandatory)"
    r"|must\s+be\s+willing\s+to\s+(relocate|commute|come\s+in(to)?\s+the\s+office)"
    r"|in[\s-]?office\s+(presence\s+)?(is\s+)?(required|expected)"
    r")",
    re.IGNORECASE,
)

# ---- Caution: mandatory working-hours overlap ----
# Standard-time offsets from UTC in hours. IST is UTC+5.5.
_TZ_OFFSETS = {
    "est": -5, "edt": -4, "et": -5,
    "cst": -6, "cdt": -5, "ct": -6,
    "mst": -7, "mdt": -6, "mt": -7,
    "pst": -8, "pdt": -7, "pt": -8,
    "gmt": 0, "utc": 0, "bst": 1,
    "cet": 1, "cest": 2,
    "aest": 10,
}
_IST_OFFSET = 5.5

_TZ_WINDOW_RE = re.compile(
    r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(?\b(est|edt|cst|cdt|mst|mdt|pst|pdt|gmt|utc|bst|cet|cest|aest)\b",
    re.IGNORECASE,
)
_TZ_OVERLAP_RE = re.compile(
    r"("
    r"overlap(ping)?\s+(of\s+)?(\d+\+?\s+hours?\s+)?(with\s+)?[^.\n]{0,40}?\b(est|edt|cst|cdt|mst|mdt|pst|pdt|gmt|utc|bst|cet|cest|aest|eastern|pacific|central\s+(time|standard))\b"
    r"|\b(est|edt|cst|cdt|mst|mdt|pst|pdt|cet|cest|aest)\b\s+(business|working|core|office)\s+hours"
    r"|(work|available|online)\s+(during|in)\s+(us|u\.s\.|uk|european?|pacific|eastern|central|mountain)\s+(business|working|core)\s+hours"
    r"|core\s+hours\s+(of\s+|in\s+|are\s+)?[^.\n]{0,30}\b(est|edt|cst|cdt|mst|mdt|pst|pdt|gmt|utc|cet)\b"
    r")",
    re.IGNORECASE,
)
_TZ_NAME_TO_ABBR = {"eastern": "est", "pacific": "pst", "central time": "cst", "central standard": "cst"}

# ---- Caution: ghost-job markers ----
_GHOST_RE = re.compile(
    r"("
    r"always\s+(accepting|hiring|looking\s+for)"
    r"|evergreen\s+(requisition|posting|role)"
    r"|talent\s+(pool|community|network|pipeline)"
    r"|future\s+(openings?|opportunities|roles?)"
    r"|this\s+is\s+a\s+pipeline\s+(req|requisition|posting)"
    r")",
    re.IGNORECASE,
)

_HTML_TAG_RE = re.compile(r"<[^>]+>")

_RELATIVE_AGE_RE = re.compile(
    r"(\d+)\s*\+?\s*(minute|min|hour|hr|day|d\b|week|w\b|month|mo)s?\s*(ago)?",
    re.IGNORECASE,
)
_AGE_UNIT_MINUTES = {
    "minute": 1, "min": 1,
    "hour": 60, "hr": 60,
    "day": 1440, "d": 1440,
    "week": 10080, "w": 10080,
    "month": 43200, "mo": 43200,
}


def _clean_text(posting: dict) -> str:
    raw = " ".join(filter(None, [
        posting.get("job_title", ""),
        posting.get("location", ""),
        posting.get("description", ""),
    ]))
    return html.unescape(_HTML_TAG_RE.sub(" ", raw))


def _fmt_ist(hour: float) -> str:
    hour = hour % 24
    minutes = round((hour % 1) * 60)
    h24 = int(hour)
    suffix = "AM" if h24 < 12 else "PM"
    h12 = h24 % 12 or 12
    return f"{h12}:{minutes:02d} {suffix}" if minutes else f"{h12} {suffix}"


def _to_24h(hour: int, minute: str | None, ampm: str | None) -> float:
    h = hour % 12 + (12 if (ampm or "").lower() == "pm" else 0) if ampm else hour
    return h + (int(minute) / 60 if minute else 0)


def _timezone_reason(text: str) -> str | None:
    """Return an IST-translated description of a working-hours requirement, if any."""
    window = _TZ_WINDOW_RE.search(text)
    if window:
        h1, m1, ap1, h2, m2, ap2, tz = window.groups()
        offset = _TZ_OFFSETS.get(tz.lower())
        if offset is not None:
            # "9-5 EST" style windows often omit am/pm on the first time
            start = _to_24h(int(h1), m1, ap1 or ap2)
            end = _to_24h(int(h2), m2, ap2)
            diff = _IST_OFFSET - offset
            return (
                f"Working hours {window.group(0).strip()} ≈ "
                f"{_fmt_ist(start + diff)}–{_fmt_ist(end + diff)} IST"
            )

    overlap = _TZ_OVERLAP_RE.search(text)
    if overlap:
        snippet = overlap.group(0).strip()
        tz_match = re.search(r"\b(est|edt|cst|cdt|mst|mdt|pst|pdt|gmt|utc|bst|cet|cest|aest)\b", snippet, re.IGNORECASE)
        abbr = tz_match.group(1).lower() if tz_match else None
        if not abbr:
            for name, mapped in _TZ_NAME_TO_ABBR.items():
                if name in snippet.lower():
                    abbr = mapped
                    break
        if abbr and abbr in _TZ_OFFSETS:
            diff = _IST_OFFSET - _TZ_OFFSETS[abbr]
            direction = "behind" if diff > 0 else "ahead of"
            return f"Timezone overlap required (“{snippet[:80]}”) — {abbr.upper()} is {abs(diff):g}h {direction} IST"
        return f"Timezone overlap required: “{snippet[:80]}”"

    return None


def parse_posted_at(raw: str | None, anchor: datetime | None = None) -> str | None:
    """Parse posted_at_raw — ISO dates (RemoteOK/Remotive) or relative strings
    like '3 days ago' / '30+ days ago' / 'Just posted' (Indeed/LinkedIn) —
    into an ISO timestamp. Relative strings resolve against `anchor` (the
    scrape time; defaults to now, which is correct at ingest but not when
    backfilling old rows). Returns None when unparseable."""
    if not raw:
        return None
    text = raw.strip()

    # ISO-ish dates first (e.g. "2026-07-01T12:00:00+00:00", "2026-07-01")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
    except ValueError:
        pass

    now = anchor or datetime.now(timezone.utc)
    lowered = text.lower()
    if re.search(r"just\s+posted|today|just\s+now", lowered):
        return now.isoformat()
    if "yesterday" in lowered:
        return (now - timedelta(days=1)).isoformat()

    match = _RELATIVE_AGE_RE.search(lowered)
    if match:
        count, unit = int(match.group(1)), match.group(2).lower().rstrip()
        minutes = _AGE_UNIT_MINUTES.get(unit)
        if minutes:
            return (now - timedelta(minutes=count * minutes)).isoformat()

    return None


def qualify_job(posting: dict, posted_anchor: datetime | None = None) -> dict:
    """Compute triage fields for a job posting dict. Returns a partial row:
    {verdict, verdict_reasons, posted_at} — merge into the posting before upsert.
    `posted_anchor` resolves relative posted_at_raw strings (see parse_posted_at)."""
    text = _clean_text(posting)
    skip_reasons: list[str] = []
    caution_reasons: list[str] = []

    restriction = RESTRICTION_RE.search(text)
    if restriction:
        skip_reasons.append(f"Residency/citizenship restricted: “{restriction.group(0).strip()[:80]}”")

    no_agency = _NO_AGENCY_RE.search(text)
    if no_agency:
        skip_reasons.append(f"Agency-hostile clause: “{no_agency.group(0).strip()[:80]}”")

    if _CLEARANCE_REQUIRED_RE.search(text) or _CLEARANCE_RE.search(posting.get("job_title") or ""):
        skip_reasons.append("Security clearance required")

    onsite = _ONSITE_RE.search(text)
    if onsite:
        skip_reasons.append(f"Onsite/hybrid requirement in a “remote” posting: “{onsite.group(0).strip()[:80]}”")

    tz_reason = _timezone_reason(text)
    if tz_reason:
        caution_reasons.append(tz_reason)

    ghost = _GHOST_RE.search(text)
    if ghost:
        caution_reasons.append(f"Possible evergreen/ghost posting: “{ghost.group(0).strip()[:60]}”")
    elif len(text.strip()) < 200:
        caution_reasons.append("Very thin description — verify the posting is real before investing time")

    verdict = "skip" if skip_reasons else ("caution" if caution_reasons else "apply")
    return {
        "verdict": verdict,
        "verdict_reasons": skip_reasons + caution_reasons,
        "posted_at": parse_posted_at(posting.get("posted_at_raw"), posted_anchor),
    }

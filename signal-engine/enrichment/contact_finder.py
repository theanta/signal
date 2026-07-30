"""Find a decision-maker contact via LinkedIn SERP lookup, website scraping, and email pattern verification."""

import json
import os
import re
import requests
from urllib.parse import urlparse

from .url_utils import clean_company_website

SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
# Optional — enables verification of pattern-generated emails (millionverifier.com).
# Without it, pattern candidates are never returned: an unverified guess is spam risk.
MILLIONVERIFIER_API_KEY = os.getenv("MILLIONVERIFIER_API_KEY", "")

# Ordered by outreach priority — earlier titles win when several people match
_DECISION_TITLE_KEYWORDS = [
    "ceo", "chief executive", "founder", "co-founder", "owner", "president",
    "coo", "chief operating", "managing director", "general manager",
    "cto", "chief technology", "vp operations", "director of operations",
    "vp engineering", "head of engineering",
]

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; ANTALeadRadar/1.0)"})

# Contact/about pages that commonly expose real email addresses and team info
_CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/about-us", "/team", "/our-team", "/people"]

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_JSONLD_RE = re.compile(r"<script[^>]*ld\+json[^>]*>(.*?)</script>", re.S | re.I)
# Generic/role addresses — never a decision-maker inbox
_GENERIC_PREFIXES = {"info", "hello", "hi", "support", "help", "contact", "sales",
                     "admin", "noreply", "no-reply", "team", "press", "media",
                     "jobs", "careers", "billing", "accounts", "privacy", "legal",
                     "parts", "service", "services", "office", "orders", "marketing",
                     "hr", "purchasing", "quotes", "inquiries", "enquiries",
                     "reception", "webmaster", "postmaster", "mail", "general",
                     "customerservice", "customercare", "feedback", "rentals"}

# Legal/structural suffixes that don't help identify the company in search results
_COMPANY_SUFFIXES = {"llc", "inc", "inc.", "corp", "corp.", "corporation", "co", "co.",
                     "ltd", "ltd.", "group", "company", "companies", "the", "-"}


def _extract_domain(url: str | None) -> str | None:
    if not url:
        return None
    match = re.search(r"(?:https?://)?(?:www\.)?([^/\s]+)", url)
    return match.group(1) if match else None


def _company_tokens(company_name: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9&]+", company_name.lower())
            if t and t not in _COMPANY_SUFFIXES]


def _title_rank(title: str) -> int | None:
    """Index into _DECISION_TITLE_KEYWORDS of the best keyword in title, or None."""
    low = title.lower()
    # "Executive Assistant to the President" is not the president
    if re.search(r"\b(assistant|advisor|adviser|secretary|chief of staff)\b|\bto the\b", low):
        return None
    # Normalize so "Vice President" can't satisfy the "president" keyword
    low = re.sub(r"\bvice[\s-]president\b", "vp", low)
    for i, kw in enumerate(_DECISION_TITLE_KEYWORDS):
        # Word boundaries matter: "director" contains "cto", "cooperative" contains
        # "coo". The lookahead rejects possessives ("President's Club").
        if re.search(r"\b" + re.escape(kw) + r"\b(?!['’])", low):
            return i
    return None


def _clean_text(text: str) -> str:
    """Strip zero-width/bidi formatting chars that LinkedIn titles sometimes carry."""
    return re.sub("[\\u200b-\\u200f\\u202a-\\u202e\\ufeff]", "", text).strip()


def _split_name(full_name: str) -> tuple[str, str]:
    parts = full_name.strip().split()
    if len(parts) < 2:
        return full_name.strip(), ""
    return parts[0], parts[-1]


# ============================================================
# Stage 1 — SERP: find a decision-maker's LinkedIn profile
# ============================================================

def _snippet_title(snippet: str, company_tokens: list[str]) -> str | None:
    """
    LinkedIn SERP titles often read "Name - Company" instead of "Name - Headline";
    the job title then only appears in the snippet's experience text, e.g.
    "Experience. <Company> Graphic. Owner. <Company>. Aug 2018 - Present …".
    Return the title tied to THIS company, or None. Adjacency to the company
    is required — "Owner" of some unrelated business also shows up in snippets.
    """
    if not company_tokens:
        return None
    segments = [s.strip() for s in re.split(r"[.·|]\s+", snippet) if s.strip()]
    for i, seg in enumerate(segments):
        # A real title segment is short; long ones are prose that happens to
        # contain a keyword ("…worked for West Michigan general contractors…").
        if len(seg) > 60:
            continue
        if re.match(r"^\s*(former|ex[-\s]|past|retired)", seg, flags=re.I):
            continue
        # Same-segment form: "Owner at <Company>"
        m = re.match(r"(.+?)\s+at\s+(.+)$", seg, flags=re.I)
        if m and all(t in m.group(2).lower() for t in company_tokens):
            if _title_rank(m.group(1).split(",")[0]) is not None:
                return m.group(1).strip()
            continue
        # Adjacent-segment form: "Owner. <Company>."
        if i + 1 < len(segments) and _title_rank(seg.split(",")[0]) is not None \
                and all(t in segments[i + 1].lower() for t in company_tokens):
            return seg
    return None


def _serp_find_person(company_name: str, location: str | None = None) -> dict | None:
    """
    Google (via Serper) for LinkedIn profiles of decision-makers at this company.
    Result titles look like "Erik VanAllen - President & CEO"; snippets carry the
    employer, which we require to avoid past-role false positives.
    Returns {"name", "title", "linkedin_url"} or None.
    """
    if not SERPER_API_KEY or not company_name:
        return None

    titles_clause = " OR ".join(f'"{t}"' for t in
                                ["CEO", "Founder", "Owner", "President", "COO", "General Manager"])
    # Location disambiguates short/generic company names (many companies share
    # a name like "Accelera"). Unquoted city only — a quoted "City, ST" phrase
    # would hard-filter out profiles whose snippet words it differently.
    city = location.split(",")[0].strip() if location else ""
    loc_clause = f" {city}" if city else ""
    try:
        r = _SESSION.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"},
            json={"q": f'site:linkedin.com/in "{company_name}"{loc_clause} {titles_clause}', "num": 10},
            timeout=8,
        )
        if r.status_code != 200:
            return None
        organic = r.json().get("organic", [])
    except Exception:
        return None

    tokens = _company_tokens(company_name)
    best: tuple[int, int, dict] | None = None  # (title_rank, result_index, person)

    for idx, res in enumerate(organic):
        link = res.get("link", "")
        if "linkedin.com/in/" not in link:
            continue

        raw_title = re.sub(r"\s*\|\s*LinkedIn\s*$", "", res.get("title", ""))
        parts = re.split(r"\s+[-–—]\s+", raw_title, maxsplit=1)
        if len(parts) != 2:
            continue
        name, person_title = _clean_text(parts[0]), _clean_text(parts[1])
        # "CEO at Getman Corporation" → "CEO"; drop secondary clauses after |, //, ·
        person_title = re.sub(r"\s+at\s+.*$", "", person_title, flags=re.I)
        person_title = re.split(r"\s*(?:\||//|·)\s*", person_title)[0].strip()

        # Past-role profiles surface for these queries too ("Former CEO at …")
        if re.match(r"^\s*(former|ex[-\s]|past|retired)", person_title, flags=re.I):
            continue

        # Rank on the first comma-clause: "Director of X, President's Council"
        # must not pass on the strength of its second clause.
        rank = _title_rank(person_title.split(",")[0])
        if rank is None:
            # The dash segment may be the company name rather than a headline —
            # recover the actual title from the snippet before giving up.
            recovered = _snippet_title(res.get("snippet", ""), tokens)
            if recovered is None:
                continue
            person_title = recovered
            rank = _title_rank(person_title.split(",")[0])
            if rank is None:
                continue

        # The company must appear in the result — otherwise this is someone whose
        # profile merely mentions it (past role, competitor comparison, etc.)
        haystack = f"{raw_title} {res.get('snippet', '')}".lower()
        if tokens and not all(t in haystack for t in tokens):
            continue

        candidate = (rank, idx, {"name": name, "title": person_title, "linkedin_url": link})
        if best is None or candidate[:2] < best[:2]:
            best = candidate

    return best[2] if best else None


# ============================================================
# Stage 2 — Website scraping: emails + team names from key pages
# ============================================================

def _jsonld_people(html: str) -> list[dict]:
    """Extract Person entries (name + jobTitle) from JSON-LD blocks."""
    people = []

    def _walk(node):
        if isinstance(node, dict):
            if node.get("@type") == "Person" and node.get("name"):
                people.append({"name": str(node["name"]).strip(),
                               "title": str(node.get("jobTitle", "")).strip()})
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    for m in _JSONLD_RE.finditer(html):
        try:
            _walk(json.loads(m.group(1)))
        except Exception:
            continue
    return people


def _scrape_site(website: str) -> tuple[dict[str, str], list[dict]]:
    """
    Fetch contact/about/team pages. Returns (emails, people):
      emails — {email: page_path} for addresses on the company's own domain
      people — [{"name", "title"}] from JSON-LD Person markup
    """
    if not website:
        return {}, []

    base = website.rstrip("/")
    parsed = urlparse(base if base.startswith("http") else "https://" + base)
    domain_host = parsed.netloc or parsed.path

    emails: dict[str, str] = {}
    people: list[dict] = []

    for path in _CONTACT_PATHS:
        url = f"https://{domain_host}{path}"
        try:
            resp = _SESSION.get(url, timeout=3, allow_redirects=True)
            if resp.status_code >= 400:
                continue
            for email in _EMAIL_RE.findall(resp.text):
                email_lower = email.lower()
                if email_lower in emails:
                    continue
                email_domain = email_lower.split("@")[-1]
                # Skip third-party domains (tracking pixels, agency credits etc.)
                if email_domain != domain_host and not domain_host.endswith(email_domain):
                    continue
                emails[email_lower] = path
            people.extend(_jsonld_people(resp.text))
        except Exception:
            continue
        # A personal address is the best this stage can produce — stop early
        # instead of burning the remaining paths' timeout budget.
        if any(e.split("@")[0] not in _GENERIC_PREFIXES for e in emails):
            break

    return emails, people


# ============================================================
# Stage 3 — Email pattern generation + verification
# ============================================================

def _email_candidates(first: str, last: str, domain: str) -> list[str]:
    first = re.sub(r"[^a-z]", "", first.lower())
    last = re.sub(r"[^a-z]", "", last.lower())
    if not first or not domain:
        return []
    if not last:
        return [f"{first}@{domain}"]
    return [
        f"{first}.{last}@{domain}",
        f"{first}@{domain}",
        f"{first[0]}{last}@{domain}",
        f"{first}{last}@{domain}",
    ]


def _verify_email(email: str) -> str:
    """
    Check deliverability via MillionVerifier. Returns "ok", "catch_all", "bad",
    or "unknown" (no API key / verifier unreachable).
    """
    if not MILLIONVERIFIER_API_KEY:
        return "unknown"
    try:
        r = _SESSION.get(
            "https://api.millionverifier.com/api/v3/",
            params={"api": MILLIONVERIFIER_API_KEY, "email": email, "timeout": 10},
            timeout=12,
        )
        if r.status_code != 200:
            return "unknown"
        result = r.json().get("result", "")
        if result == "ok":
            return "ok"
        if result == "catch_all":
            return "catch_all"
        if result in ("invalid", "disposable"):
            return "bad"
        return "unknown"
    except Exception:
        return "unknown"


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
      name                   — full name
      title                  — job title
      email                  — best PERSONAL email found (never info@/hello@ style)
      linkedin_url           — LinkedIn profile URL
      fallback_generic_email — generic inbox (info@ etc.) if that's all the site has
      email_confidence — one of:
          "verified"   found on the company site, or pattern verified deliverable
          "catch_all"  pattern matched but the domain accepts all mail
          "unknown"    no personal email could be established
    """
    # A social URL here would make site scraping hit blocked pages —
    # clean it so we only ever fetch the real company domain.
    website = clean_company_website(website)
    domain = _extract_domain(website)

    # ---- Stage 1: LinkedIn SERP lookup ----
    # City narrows ambiguous company names but also shrinks recall (profiles
    # rarely mention it) — fall back to a name-only query when it finds nobody.
    person = _serp_find_person(company_name, location)
    if not person and location:
        person = _serp_find_person(company_name, None)

    # ---- Stage 2: scrape company site for emails and team markup ----
    emails, site_people = _scrape_site(website or "")

    if not person and site_people:
        ranked = [(r, i, p) for i, p in enumerate(site_people)
                  if (r := _title_rank(p.get("title", ""))) is not None]
        if ranked:
            person = min(ranked)[2]

    name = person.get("name", "") if person else ""
    title = person.get("title", "") if person else ""
    linkedin_url = person.get("linkedin_url", "") if person else ""

    personal_emails = [e for e in emails if e.split("@")[0] not in _GENERIC_PREFIXES]
    generic_emails = [e for e in emails if e.split("@")[0] in _GENERIC_PREFIXES]

    email = ""
    email_confidence = "unknown"

    # ---- Stage 3a: a site email that matches the named person ----
    if name:
        first, last = _split_name(name)
        for cand in personal_emails:
            prefix = cand.split("@")[0]
            if (len(first) >= 3 and first.lower() in prefix) or \
               (len(last) >= 3 and last.lower() in prefix):
                email, email_confidence = cand, "verified"
                break

    # ---- Stage 3b: nameless contact — a personal site email is still a real
    # person's inbox. Only when we found no name: pairing someone else's
    # address with the named person would corrupt outreach.
    if not email and not name and personal_emails:
        email, email_confidence = personal_emails[0], "verified"

    # ---- Stage 3c: pattern candidates, only if we can verify them ----
    if not email and name and domain:
        first, last = _split_name(name)
        for cand in _email_candidates(first, last, domain):
            status = _verify_email(cand)
            if status == "ok":
                email, email_confidence = cand, "verified"
                break
            if status == "catch_all":
                email, email_confidence = cand, "catch_all"
                break
            if status == "unknown":
                break  # no verifier available — never return a blind guess

    fallback_generic_email = generic_emails[0] if generic_emails else ""

    if not name and not email and not linkedin_url and not fallback_generic_email:
        return None

    return {
        "name": name,
        "title": title,
        "email": email,
        "linkedin_url": linkedin_url,
        "fallback_generic_email": fallback_generic_email,
        "email_confidence": email_confidence,
    }

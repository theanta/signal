"""
Analyze operational pain points and map to ANTA services.
Uses Groq (Llama 3.3-70B) to synthesize evidence from scraped company data.
Falls back to rule-based analysis when Groq is unavailable or rate-limited.
"""

import json
import logging
import os
import re
from typing import Tuple

from pydantic import BaseModel, field_validator, ValidationError

logger = logging.getLogger(__name__)

ANTA_SERVICES = [
    "AI Automation Systems",
    "SaaS Development",
    "Operational Dashboard",
    "Workflow Automation",
    "Custom Internal Tools",
    "CRM System",
    "Startup MVP Development",
    "React/Next.js Frontend Modernization",
]

ANTA_PARTNERSHIP_SERVICES = [
    "Development Partnership",
    "Project Outsourcing",
    "White-label Development",
    "AI Feature Subcontracting",
]

_GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
_MODEL = "llama-3.3-70b-versatile"


class _PainPointResponse(BaseModel):
    pain_points: list[str]
    recommended_service: str
    outreach_angle: str

    @field_validator("pain_points", mode="before")
    @classmethod
    def _coerce_pain_points(cls, v: object) -> list[str]:
        if not isinstance(v, list):
            return []
        return [p for p in v if isinstance(p, str) and p.strip()][:4]

    @field_validator("recommended_service", "outreach_angle")
    @classmethod
    def _require_non_empty(cls, v: object) -> str:
        s = str(v).strip() if v else ""
        if not s:
            raise ValueError("field is required and cannot be empty")
        return s


def _build_prompt(
    company_name: str,
    industry: str,
    location: str,
    hiring_signal: str,
    job_title: str,
    description: str,
    tech_stack: list[str],
    website_content: str,
) -> str:
    stack_str = ", ".join(tech_stack) if tech_stack else "none detected"
    content_str = website_content.strip() if website_content else "not available"

    services_list = "\n".join(f"- {s}" for s in ANTA_SERVICES)

    return f"""You are a B2B analyst for ANTA, a Detroit-based software agency that builds custom operational software for SMBs.

ANTA services (pick exactly one as recommended_service):
{services_list}

Evidence observed about this lead:
- Company: {company_name}
- Location: {location or "unknown"}
- Industry: {industry or "unknown"}
- Description: {description or "not provided"}
- Hiring signal: {hiring_signal or "none"}
- Job posting title: {job_title or "none"}
- Tech stack detected via website fingerprinting: {stack_str}
- Website text scraped from their pages:
{content_str}

CRITICAL RULES — read carefully before answering:

1. A pain point is something the company is STRUGGLING WITH or LACKING — an operational gap, a manual process, a missing tool, an inefficiency. It is NOT something they advertise, sell, or claim to be good at. If a statement describes the company's own capabilities or value proposition, it is MARKETING COPY — not a pain point.

2. Grounding rule: each pain point must cite a specific observed signal (a tool absence, a phrase from the job posting indicating manual work, a technology gap). Do not infer pain points from marketing language or taglines.

3. If evidence is thin or ambiguous, return fewer pain points — do not pad with generic ones.

4. Write a 2-3 sentence outreach_angle referencing specific observed signals (job posting language, tech stack gaps, website copy about their operations). No generic phrases like "we noticed you're growing."

Return only a valid JSON object with exactly these keys: pain_points (array of strings), recommended_service (string), outreach_angle (string). No markdown, no explanation."""


def _build_partnership_prompt(
    company_name: str,
    industry: str,
    location: str,
    hiring_signal: str,
    job_title: str,
    description: str,
    tech_stack: list[str],
    website_content: str,
) -> str:
    stack_str = ", ".join(tech_stack) if tech_stack else "none detected"
    content_str = website_content.strip() if website_content else "not available"
    partnership_services = "\n".join(f"- {s}" for s in ANTA_PARTNERSHIP_SERVICES)

    return f"""You are a B2B analyst for ANTA, a Detroit-based software agency specialising in React/Next.js, AI automation, and custom operational tools.

ANTA is evaluating {company_name} as a potential PARTNER or OUTSOURCING client — NOT as a software buyer. This company is in {industry}, meaning they build or sell technology themselves. ANTA is looking for opportunities to collaborate: subcontracting overflow work, white-label development, or joint delivery on client projects.

Partnership engagement types ANTA can offer (pick the best fit as recommended_service):
{partnership_services}

Evidence observed:
- Company: {company_name}
- Location: {location or "unknown"}
- Industry: {industry}
- Description: {description or "not provided"}
- Hiring signal: {hiring_signal or "none"}
- Job posting title: {job_title or "none"}
- Tech stack detected on website: {stack_str}
- Website content:
{content_str}

Your task:
1. Identify up to 3 partnership opportunity signals — specific observations that suggest this company has overflow dev work, capability gaps ANTA can fill, or project outsourcing needs. Ground each in the evidence (e.g. hiring contractors = variable load, specific tech in job posting ANTA specialises in, service areas that require dev partners).
2. Pick the single best partnership engagement type from the list above.
3. Write a 2-3 sentence outreach angle framed as a partnership pitch — reference specific signals observed. The tone should be peer-to-peer ("collaborate", "partner", "support your pipeline"), NOT a sales pitch.

Return only a valid JSON object with exactly these keys: pain_points (array of strings — these are partnership signals, not operational gaps), recommended_service (string), outreach_angle (string). No markdown, no explanation."""


def _call_groq(prompt: str) -> dict | None:
    """Call Groq and validate the response. Retries up to 3 times on JSON/validation failures."""
    from groq import Groq
    client = Groq(api_key=_GROQ_API_KEY)

    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=_MODEL,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=600,
            )
            raw = resp.choices[0].message.content
            validated = _PainPointResponse.model_validate(json.loads(raw))
            return validated.model_dump()
        except json.JSONDecodeError as e:
            logger.warning("[PainPointAnalyzer] JSON decode failed (attempt %d/3): %s", attempt + 1, e)
        except ValidationError as e:
            logger.warning("[PainPointAnalyzer] Response validation failed (attempt %d/3): %s", attempt + 1, e)
        except Exception as e:
            # API-level errors (auth, rate limit, network) — no point retrying immediately
            logger.warning("[PainPointAnalyzer] Groq API error: %s", e)
            return None

    logger.warning("[PainPointAnalyzer] All 3 attempts failed — falling back to rule-based analysis")
    return None


# ============================================================
# Rule-based fallback — used when Groq is unavailable
# ============================================================

_INDUSTRY_FALLBACK: dict[str, dict] = {
    "manufacturing": {
        "pain_points": [
            "Manual production tracking in spreadsheets",
            "No real-time inventory visibility",
            "Disconnected ERP from shop floor data",
        ],
        "service": "Operational Dashboard",
        "angle": "ANTA builds operational dashboards that give manufacturing teams real-time visibility into production and inventory.",
    },
    "logistics": {
        "pain_points": [
            "Manual route planning and dispatch",
            "No real-time shipment tracking",
            "Paper-based proof of delivery",
        ],
        "service": "Operational Dashboard",
        "angle": "ANTA builds logistics ops platforms — route optimization, shipment tracking, driver portals.",
    },
    "healthcare": {
        "pain_points": [
            "Paper-based patient intake",
            "Manual scheduling across locations",
            "Disconnected billing and care workflows",
        ],
        "service": "Workflow Automation",
        "angle": "ANTA builds healthcare ops tools that reduce administrative burden through digital intake and scheduling.",
    },
    "legal": {
        "pain_points": [
            "Case management via email chains",
            "Manual document tracking",
            "No client portal",
        ],
        "service": "Custom Internal Tools",
        "angle": "ANTA builds legal ops tools — case management, client portals, document workflows.",
    },
    "staffing": {
        "pain_points": [
            "Candidate tracking in spreadsheets",
            "No internal ATS",
            "Manual client reporting",
        ],
        "service": "CRM System",
        "angle": "ANTA builds staffing CRMs that automate candidate tracking and placement coordination.",
    },
    "saas": {
        "pain_points": [
            "MVP needs full engineering support",
            "Frontend needs professional rebuild",
            "Needs AI feature integration",
        ],
        "service": "SaaS Development",
        "angle": "ANTA helps SaaS founders move fast — from MVP to scalable product architecture.",
    },
}

_JOB_SIGNAL_FALLBACK = [
    (r"data entry|spreadsheet|excel analyst", "Manual data workflows consuming staff time", "Workflow Automation"),
    (r"operations coordinator|ops manager", "Operational scaling without software support", "Operational Dashboard"),
    (r"react|frontend|next\.?js", "Frontend modernization or new product build", "React/Next.js Frontend Modernization"),
    (r"full.?stack|software engineer|web developer", "Building new internal tools or SaaS product", "SaaS Development"),
    (r"crm|sales ops|salesforce", "No centralized CRM or sales ops system", "CRM System"),
    (r"ai|machine learning|automation", "Wants AI but lacks engineering to implement", "AI Automation Systems"),
]

_DEFAULT_FALLBACK = {
    "pain_points": [
        "Manual operational processes",
        "No centralized data visibility",
        "Scaling without software infrastructure",
    ],
    "service": "Workflow Automation",
    "angle": "ANTA builds the operational software layer your business needs to scale.",
}


def _fallback_analyze(
    industry: str,
    hiring_signal: str,
    job_title: str,
    location: str,
) -> tuple[list[str], str, str]:
    text = f"{hiring_signal} {job_title}".lower()
    industry_lower = industry.lower()

    data = next(
        (v for k, v in _INDUSTRY_FALLBACK.items() if k in industry_lower),
        _DEFAULT_FALLBACK,
    )

    pain_points = list(data["pain_points"])
    service = data["service"]
    angle = data["angle"]

    for pattern, pain, svc in _JOB_SIGNAL_FALLBACK:
        if re.search(pattern, text, re.IGNORECASE):
            if pain not in pain_points:
                pain_points.insert(0, pain)
            service = svc
            break

    if any(loc in location.lower() for loc in ["detroit", "michigan", "dearborn", "warren"]):
        angle = f"As Detroit-based engineers, ANTA understands Michigan business operations. {angle}"

    return pain_points[:4], service, angle


# ============================================================
# Public API
# ============================================================

class PainPointAnalyzer:
    def analyze(
        self,
        industry: str,
        hiring_signal: str,
        job_title: str,
        description: str,
        location: str,
        tech_stack: list[str] | None = None,
        tech_gaps: list[str] | None = None,
        website_content: str = "",
        company_name: str = "",
        is_vendor_company: bool = False,
    ) -> Tuple[list[str], str, str]:
        tech_stack = tech_stack or []

        if _GROQ_API_KEY:
            prompt = (
                _build_partnership_prompt if is_vendor_company else _build_prompt
            )(
                company_name=company_name,
                industry=industry,
                location=location,
                hiring_signal=hiring_signal,
                job_title=job_title,
                description=description,
                tech_stack=tech_stack,
                website_content=website_content,
            )
            result = _call_groq(prompt)
            if result:
                logger.info(
                    "[PainPointAnalyzer] Groq %s analysis succeeded",
                    "partnership" if is_vendor_company else "SMB",
                )
                return result["pain_points"], result["recommended_service"], result["outreach_angle"]

        if is_vendor_company:
            return (
                ["Hiring contract developers signals variable project load"],
                "Development Partnership",
                "ANTA specialises in React/Next.js and AI — we can support your client delivery pipeline as a development partner.",
            )

        logger.info("[PainPointAnalyzer] Using rule-based fallback")
        return _fallback_analyze(industry, hiring_signal, job_title, location)

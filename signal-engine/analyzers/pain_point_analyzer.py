"""
Analyze a lead's operational pain points and map them to the services of the
agency doing the prospecting. The agency is the tenant: its name, location,
tagline and services come from its platform_config, never from this file.

Uses Groq (Llama 3.3-70B) to synthesize evidence from scraped company data.
Falls back to rule-based analysis when Groq is unavailable or rate-limited.
"""

import json
import logging

import metering
import os
import re
from dataclasses import dataclass
from typing import Optional, Tuple

from pydantic import BaseModel, field_validator, ValidationError

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class AgencyProfile:
    """The tenant doing the prospecting, as its Settings describe it."""
    name: str
    location: str = ""
    tagline: str = ""
    services: tuple[str, ...] = ()


# Ways a vendor-type lead (one that itself sells technology) can work with the
# agency. Generic on purpose: the agency's own services are listed separately.
PARTNERSHIP_ENGAGEMENTS = [
    "Delivery Partnership",
    "Project Outsourcing",
    "White-label Delivery",
    "Subcontracting",
]


def _agency_intro(agency: AgencyProfile) -> str:
    where = f", based in {agency.location}" if agency.location else ""
    what = f" ({agency.tagline})" if agency.tagline else ""
    return f"You are a B2B analyst for {agency.name}{where}{what}."


def _services_block(agency: AgencyProfile) -> str:
    if agency.services:
        services_list = "\n".join(f"- {s}" for s in agency.services)
        return f"{agency.name} services (pick exactly one as recommended_service):\n{services_list}"
    return (f"{agency.name} has not listed its services. For recommended_service, name in a few "
            f"words the single service {agency.name} could most credibly offer this company.")

_GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
_MODEL = "llama-3.3-70b-versatile"


class _PainPointResponse(BaseModel):
    pain_points: list[str]
    recommended_service: str
    outreach_angle: str
    # The AI judgment of fit, asked for in the same call. Optional: a response
    # without it still yields pain points, and the lead's AI score is then
    # reported as unknown rather than invented.
    fit_score: Optional[int] = None
    fit_reason: Optional[str] = None

    @field_validator("fit_score", mode="before")
    @classmethod
    def _clamp_fit(cls, v: object) -> Optional[int]:
        try:
            return max(0, min(100, int(round(float(v)))))
        except (TypeError, ValueError):
            return None

    @field_validator("fit_reason", mode="before")
    @classmethod
    def _trim_reason(cls, v: object) -> Optional[str]:
        s = str(v).strip() if v else ""
        return s[:300] or None

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
    agency: AgencyProfile,
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

    return f"""{_agency_intro(agency)}

{_services_block(agency)}

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

Return only a valid JSON object with exactly these keys: pain_points (array of strings), recommended_service (string), outreach_angle (string), fit_score (integer), fit_reason (string). No markdown, no explanation.

Also judge the deal: fit_score is an integer 0-100 for how likely {agency.name} is to win work from this company given its services and the evidence above (0 = clearly not a client, 50 = plausible but unproven, 85+ = strong, specific match), and fit_reason is one sentence naming the evidence that decided it. Be skeptical: thin evidence means a middling score, not a high one."""


def _build_partnership_prompt(
    agency: AgencyProfile,
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
    engagements = "\n".join(f"- {s}" for s in PARTNERSHIP_ENGAGEMENTS)
    services = ", ".join(agency.services) if agency.services else "not listed"

    return f"""{_agency_intro(agency)} {agency.name}'s services: {services}.

{agency.name} is evaluating {company_name} as a potential PARTNER or OUTSOURCING client — NOT as a buyer. This company is in {industry}, meaning they build or sell technology themselves. {agency.name} is looking for opportunities to collaborate: subcontracting overflow work, white-label delivery, or joint delivery on client projects.

Partnership engagement types {agency.name} can offer (pick the best fit as recommended_service):
{engagements}

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
1. Identify up to 3 partnership opportunity signals — specific observations that suggest this company has overflow dev work, capability gaps {agency.name} can fill, or project outsourcing needs. Ground each in the evidence (e.g. hiring contractors = variable load, specific needs in the job posting that match {agency.name}'s services, service areas that require dev partners).
2. Pick the single best partnership engagement type from the list above.
3. Write a 2-3 sentence outreach angle framed as a partnership pitch — reference specific signals observed. The tone should be peer-to-peer ("collaborate", "partner", "support your pipeline"), NOT a sales pitch.

Return only a valid JSON object with exactly these keys: pain_points (array of strings — these are partnership signals, not operational gaps), recommended_service (string), outreach_angle (string), fit_score (integer), fit_reason (string). No markdown, no explanation.

Also judge the deal: fit_score is an integer 0-100 for how likely {agency.name} is to win work from this company given its services and the evidence above (0 = clearly not a client, 50 = plausible but unproven, 85+ = strong, specific match), and fit_reason is one sentence naming the evidence that decided it. Be skeptical: thin evidence means a middling score, not a high one."""


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
                max_tokens=700,
            )
            usage = getattr(resp, "usage", None)
            metering.record("groq", "pain_points", getattr(usage, "total_tokens", 0) or 0)
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
    },
    "logistics": {
        "pain_points": [
            "Manual route planning and dispatch",
            "No real-time shipment tracking",
            "Paper-based proof of delivery",
        ],
        "service": "Operational Dashboard",
    },
    "healthcare": {
        "pain_points": [
            "Paper-based patient intake",
            "Manual scheduling across locations",
            "Disconnected billing and care workflows",
        ],
        "service": "Workflow Automation",
    },
    "legal": {
        "pain_points": [
            "Case management via email chains",
            "Manual document tracking",
            "No client portal",
        ],
        "service": "Custom Internal Tools",
    },
    "staffing": {
        "pain_points": [
            "Candidate tracking in spreadsheets",
            "No internal ATS",
            "Manual client reporting",
        ],
        "service": "CRM System",
    },
    "saas": {
        "pain_points": [
            "MVP needs full engineering support",
            "Frontend needs professional rebuild",
            "Needs AI feature integration",
        ],
        "service": "SaaS Development",
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
}


def _same_area(agency_location: str, lead_location: str) -> bool:
    """True when the lead is in the agency's own city or state/region."""
    lead = lead_location.lower()
    parts = [p.strip().lower() for p in agency_location.split(",") if len(p.strip()) > 2]
    return bool(lead) and any(part in lead for part in parts)


def _fallback_analyze(
    agency: AgencyProfile,
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

    for pattern, pain, svc in _JOB_SIGNAL_FALLBACK:
        if re.search(pattern, text, re.IGNORECASE):
            if pain not in pain_points:
                pain_points.insert(0, pain)
            service = svc
            break

    # Recommend only what this agency sells: the generic suggestion when it is
    # on the agency's list, otherwise the agency's first listed service.
    if agency.services and service not in agency.services:
        service = agency.services[0]

    angle = (f"{pain_points[0]} is a common gap for {industry or 'growing'} teams, "
             f"and {service} from {agency.name} is built to close it.")
    if agency.location and _same_area(agency.location, location):
        angle = f"As a {agency.location}-based team, {agency.name} knows the local market. {angle}"

    return pain_points[:4], service, angle


# ============================================================
# Public API
# ============================================================

class PainPointAnalyzer:
    def __init__(self, agency: AgencyProfile):
        self.agency = agency

    def analyze(self, *args, **kwargs) -> Tuple[list[str], str, str]:
        """Pain points, recommended service and outreach angle."""
        r = self.analyze_with_judgment(*args, **kwargs)
        return r["pain_points"], r["recommended_service"], r["outreach_angle"]

    def analyze_with_judgment(
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
    ) -> dict:
        """analyze() plus the AI fit judgment: {pain_points, recommended_service,
        outreach_angle, fit_score, fit_reason}. fit_score is None whenever the
        answer did not come from the model (no key, API error, fallback)."""
        tech_stack = tech_stack or []

        if _GROQ_API_KEY:
            prompt = (
                _build_partnership_prompt if is_vendor_company else _build_prompt
            )(
                agency=self.agency,
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
                return result

        if is_vendor_company:
            pains, service, angle = (
                ["Hiring contract developers signals variable project load"],
                "Delivery Partnership",
                f"{self.agency.name} can support your delivery pipeline as a partner when demand outruns your team.",
            )
        else:
            logger.info("[PainPointAnalyzer] Using rule-based fallback")
            pains, service, angle = _fallback_analyze(self.agency, industry, hiring_signal, job_title, location)
        return {"pain_points": pains, "recommended_service": service, "outreach_angle": angle,
                "fit_score": None, "fit_reason": None}

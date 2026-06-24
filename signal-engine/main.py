"""ANTA Lead Radar - Signal Engine (FastAPI)"""

import asyncio
import logging
import re
import uuid
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from scrapers.linkedin import LinkedInJobsScraper
from scrapers.crunchbase import CrunchbaseScraper
from scrapers.job_boards import JobBoardScraper
from scrapers.local_business import LocalBusinessScraper
from analyzers.signal_detector import SignalDetector
from scoring.lead_scorer import LeadScorer
from analyzers.pain_point_analyzer import PainPointAnalyzer
from classifiers.industry_classifier import IndustryClassifier
from enrichment.website_verifier import verify_website
from enrichment.tech_stack_detector import detect_tech_stack, infer_gaps
from enrichment.contact_finder import find_contact

# ============================================================
# ENTERPRISE DISQUALIFICATION
# Companies too large for ANTA's SMB target market.
# Matched after stripping common legal suffixes (Inc, LLC, Corp…).
# ============================================================

_CORP_SUFFIX_RE = re.compile(
    r'\s*(inc\.?|llc\.?|corp\.?|co\.?|ltd\.?|plc\.?|group|company|corporation|incorporated|limited)\s*$',
    re.IGNORECASE,
)

ENTERPRISE_BRANDS: frozenset[str] = frozenset([
    # Big tech
    "oracle", "microsoft", "google", "alphabet", "amazon", "apple", "meta", "facebook",
    "ibm", "intel", "cisco", "dell", "hp", "hewlett packard", "nvidia",
    "qualcomm", "broadcom", "amd", "texas instruments",
    "salesforce", "sap", "servicenow", "workday", "snowflake", "palantir",
    # Michigan auto
    "general motors", "ford", "stellantis", "chrysler", "fiat chrysler",
    "toyota", "honda", "hyundai", "kia", "bmw", "mercedes", "volkswagen",
    # Defense / industrial
    "boeing", "lockheed", "lockheed martin", "raytheon", "northrop grumman",
    "general electric", "l3harris", "bae systems",
    # Consulting / Big 4
    "deloitte", "accenture", "mckinsey", "pwc", "pricewaterhousecoopers",
    "kpmg", "ernst & young", "bain", "boston consulting group", "booz allen",
    # Finance
    "jpmorgan", "bank of america", "wells fargo", "citibank", "citigroup",
    "goldman sachs", "morgan stanley", "blackrock", "vanguard",
    "american express", "capital one",
    # Retail
    "walmart", "target", "home depot", "costco", "kroger", "meijer", "cvs", "walgreens",
    # Healthcare / pharma
    "pfizer", "johnson & johnson", "merck", "abbvie", "abbott",
    "unitedhealth", "united healthcare", "humana", "aetna", "cigna",
    "blue cross blue shield", "blue cross", "bcbs",
    # Telecom
    "at&t", "verizon", "comcast", "t-mobile", "charter",
    # Logistics
    "ups", "fedex", "dhl",
    # Enterprise SaaS (they are the vendors, not the buyers)
    "zendesk", "hubspot", "shopify", "stripe", "twilio", "atlassian",
])


def _is_enterprise_company(company_name: str, company_size: str | None) -> tuple[bool, str]:
    """Return (True, reason) when a lead should be disqualified as enterprise."""
    if (company_size or "").lower() == "1000+":
        return True, "company size is 1,000+ employees — outside ANTA's SMB target market"
    normalized = _CORP_SUFFIX_RE.sub("", company_name.lower()).strip()
    if normalized in ENTERPRISE_BRANDS:
        return True, f"{company_name} is a known enterprise company — outside ANTA's SMB target market"
    return False, ""


app = FastAPI(
    title="ANTA Lead Radar Signal Engine",
    description="Python signal detection and lead analysis microservice",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- In-memory job tracker (use Redis in production) ----
scrape_jobs: dict[str, dict] = {}


# ============================================================
# SCHEMAS
# ============================================================

class RawLead(BaseModel):
    company_name: str
    website: Optional[str] = None
    location: Optional[str] = None
    job_title: Optional[str] = None
    hiring_signal: Optional[str] = None
    source_url: str
    source: str
    scraped_at: str
    description: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None


class PlatformConfig(BaseModel):
    agency_name: str = "ANTA"
    agency_location: str = "Detroit, Michigan"
    services: list[str] = []
    outreach_tone: str = "intelligent, consultative, NOT salesy"
    cta_style: str = "15-min call"
    sign_off: str = "ANTA Team"
    target_locations: list[str] = ["Detroit", "Michigan", "MI", "Dearborn", "Warren", "Troy", "Ann Arbor", "Livonia", "Sterling Heights"]
    target_company_sizes: list[str] = ["11-50", "51-200", "201-500"]
    target_industries: list[str] = []
    active_sources: list[str] = ["linkedin", "crunchbase", "job_board", "local_business"]


class AnalysisRequest(BaseModel):
    lead: RawLead
    config: Optional[PlatformConfig] = None


class ScrapeRequest(BaseModel):
    sources: list[str] = ["linkedin", "crunchbase", "job_board", "local_business"]
    config: Optional[PlatformConfig] = None


# ============================================================
# HEALTH
# ============================================================

@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok", "service": "anta-signal-engine", "timestamp": datetime.utcnow().isoformat()}


# ============================================================
# ANALYZE LEAD
# ============================================================

@app.post("/analyze")
async def analyze_lead(request: AnalysisRequest):
    """Analyze a raw lead and return signals, score, pain points, tech stack, and contact."""
    lead = request.lead

    # ---- Enterprise disqualification (runs before any expensive enrichment) ----
    is_enterprise, disqualify_reason = _is_enterprise_company(lead.company_name, lead.company_size)
    if is_enterprise:
        return {
            "lead_score": 0,
            "disqualified": True,
            "disqualify_reason": disqualify_reason,
            "likely_pain_points": [],
            "recommended_anta_service": "N/A — Enterprise",
            "outreach_angle": "",
            "operational_maturity": "N/A — Enterprise company, not ANTA's target market",
            "growth_indicators": [],
            "digital_maturity_score": 10,
            "signal_type": "disqualified",
            "confidence_score": 1.0,
            "scoring_breakdown": {
                "company_size_score": 0,
                "hiring_urgency_score": 0,
                "complexity_score": 0,
                "digital_score": 0,
            },
            "scoring_rationale": f"Disqualified: {disqualify_reason}.",
            "tech_stack": [],
            "tech_gaps": [],
            "verified_website": lead.website,
            "contact": None,
        }

    target_locations = request.config.target_locations if request.config else None

    detector = SignalDetector(target_locations=target_locations)
    scorer = LeadScorer(target_locations=target_locations)
    pain_analyzer = PainPointAnalyzer()
    classifier = IndustryClassifier()

    # ---- Step 1: Enrichment (run in thread pool — all are blocking HTTP calls) ----
    # Each task is individually capped so a slow Apollo/scrape call can't block the whole pipeline.
    async def _with_timeout(coro, seconds):
        try:
            return await asyncio.wait_for(coro, timeout=seconds)
        except asyncio.TimeoutError as exc:
            return exc

    verified_website_res, raw_tech_stack, contact_res = await asyncio.gather(
        _with_timeout(asyncio.to_thread(verify_website, lead.website, lead.company_name, lead.location or ""), 15),
        _with_timeout(asyncio.to_thread(detect_tech_stack, lead.website or ""), 15),
        _with_timeout(asyncio.to_thread(find_contact, lead.company_name, lead.website, lead.location), 20),
        return_exceptions=True,
    )

    if isinstance(verified_website_res, Exception):
        logger.warning(f"[enrichment] verify_website failed: {verified_website_res}")
    if isinstance(raw_tech_stack, Exception):
        logger.warning(f"[enrichment] detect_tech_stack failed: {raw_tech_stack}")
    if isinstance(contact_res, Exception):
        logger.warning(f"[enrichment] find_contact failed: {contact_res}")

    verified_website = verified_website_res if isinstance(verified_website_res, str) else lead.website
    tech_stack: list[str] = raw_tech_stack if isinstance(raw_tech_stack, list) else []
    tech_gaps: list[str] = infer_gaps(tech_stack)
    contact: dict | None = contact_res if isinstance(contact_res, dict) else None

    # ---- Step 2: Signal detection ----
    signal_type, confidence = detector.detect(lead.model_dump())

    # ---- Step 3: Industry classification ----
    industry = lead.industry or classifier.classify(
        company_name=lead.company_name,
        description=lead.description or "",
        job_title=lead.job_title or "",
    )

    # ---- Step 4: Pain point analysis (now tech-aware) ----
    pain_points, recommended_service, outreach_angle = pain_analyzer.analyze(
        industry=industry,
        hiring_signal=lead.hiring_signal or "",
        job_title=lead.job_title or "",
        description=lead.description or "",
        location=lead.location or "",
        tech_stack=tech_stack,
        tech_gaps=tech_gaps,
    )

    # ---- Step 5: Lead scoring (now tech-aware) ----
    score_result = scorer.score(
        company_size=lead.company_size or "unknown",
        hiring_signal=lead.hiring_signal or "",
        job_title=lead.job_title or "",
        description=lead.description or "",
        location=lead.location or "",
        industry=industry,
        tech_stack=tech_stack,
        tech_gaps=tech_gaps,
    )

    return {
        "lead_score": score_result["overall_score"],
        "industry": industry,
        "likely_pain_points": pain_points,
        "recommended_anta_service": recommended_service,
        "outreach_angle": outreach_angle,
        "operational_maturity": score_result["operational_maturity"],
        "growth_indicators": score_result["growth_indicators"],
        "digital_maturity_score": score_result["digital_maturity_score"],
        "signal_type": signal_type,
        "confidence_score": confidence,
        "scoring_breakdown": {
            "company_size_score": score_result["company_size_score"],
            "hiring_urgency_score": score_result["hiring_urgency_score"],
            "complexity_score": score_result["complexity_score"],
            "digital_score": score_result["digital_score"],
        },
        "scoring_rationale": score_result["rationale"],
        # Enrichment results
        "tech_stack": tech_stack,
        "tech_gaps": tech_gaps,
        "verified_website": verified_website,
        "contact": contact,
    }


# ============================================================
# SCRAPING
# ============================================================

@app.post("/scrape")
async def trigger_scrape(request: ScrapeRequest, background_tasks: BackgroundTasks):
    """Trigger a scraping run in the background."""
    job_id = str(uuid.uuid4())
    scrape_jobs[job_id] = {"status": "running", "started_at": datetime.utcnow().isoformat(), "results": 0}

    # Config-driven sources override the legacy `sources` field
    cfg = request.config
    effective_sources = cfg.active_sources if cfg else request.sources

    background_tasks.add_task(run_scrape_job, job_id, effective_sources, cfg)

    return {"job_id": job_id, "status": "running"}


@app.get("/scrape/{job_id}")
async def get_scrape_job(job_id: str):
    """Get the status of a scraping job."""
    job = scrape_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, **job}


async def run_scrape_job(job_id: str, sources: list[str], cfg: Optional[PlatformConfig] = None):
    """Background task: runs all scrapers, saves leads, and writes scraping_logs rows."""
    from supabase import create_client
    import os

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    target_locations = cfg.target_locations if cfg else None
    target_industries = cfg.target_industries if cfg else None

    scrapers = {
        "linkedin": LinkedInJobsScraper(target_locations=target_locations),
        "crunchbase": CrunchbaseScraper(),
        "job_board": JobBoardScraper(target_locations=target_locations),
        "local_business": LocalBusinessScraper(
            target_locations=target_locations,
            target_industries=target_industries,
        ),
    }

    total_new = 0
    any_success = False

    try:
        for source in sources:
            scraper = scrapers.get(source)
            if not scraper:
                continue

            source_started = datetime.utcnow()
            leads_found = 0
            leads_new = 0
            log_status = "failed"
            error_msg = None

            try:
                leads = await asyncio.to_thread(scraper.scrape)
                leads_found = len(leads)

                failed_inserts = 0
                for lead_data in leads:
                    try:
                        existing = supabase.table("leads").select("id").eq(
                            "source_url", lead_data.get("source_url", "")
                        ).execute()
                        if existing.data:
                            continue
                        supabase.table("leads").insert({
                            **lead_data,
                            "status": "new",
                            "scraped_at": datetime.utcnow().isoformat(),
                            "created_at": datetime.utcnow().isoformat(),
                            "updated_at": datetime.utcnow().isoformat(),
                        }).execute()
                        leads_new += 1
                        total_new += 1
                    except Exception as e:
                        failed_inserts += 1
                        logger.error(f"[Scraper] Failed to save lead '{lead_data.get('company_name', '?')}' ({source}): {e}")

                if failed_inserts:
                    error_msg = f"{failed_inserts} of {leads_found} leads failed to insert"
                    logger.error(f"[Scraper] {source}: {error_msg}")
                    log_status = "partial" if leads_new > 0 else "failed"
                else:
                    log_status = "completed"
                any_success = True

            except Exception as e:
                error_msg = str(e)
                logger.error(f"[Scraper] {source} failed: {e}")

            # Write one scraping_logs row per source
            duration_ms = int((datetime.utcnow() - source_started).total_seconds() * 1000)
            try:
                supabase.table("scraping_logs").insert({
                    "source": source,
                    "status": log_status,
                    "leads_found": leads_found,
                    "leads_new": leads_new,
                    "leads_updated": 0,
                    "duration_ms": duration_ms,
                    "started_at": source_started.isoformat(),
                    "completed_at": datetime.utcnow().isoformat(),
                    "error_message": error_msg,
                    "created_at": datetime.utcnow().isoformat(),
                }).execute()
            except Exception as e:
                logger.error(f"[Scraper] Failed to write log for {source}: {e}")

        overall_status = "completed" if any_success else "failed"
        scrape_jobs[job_id].update({
            "status": overall_status,
            "completed_at": datetime.utcnow().isoformat(),
            "results": total_new,
        })

    except Exception as e:
        scrape_jobs[job_id]["status"] = "failed"
        scrape_jobs[job_id]["error"] = str(e)

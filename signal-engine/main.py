"""ANTA Lead Radar - Signal Engine (FastAPI)"""

import asyncio
import uuid
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from scrapers.wellfound import WellfoundScraper
from scrapers.product_hunt import ProductHuntScraper
from scrapers.job_boards import JobBoardScraper
from scrapers.detroit_business import DetroitBusinessScraper
from analyzers.signal_detector import SignalDetector
from scoring.lead_scorer import LeadScorer
from analyzers.pain_point_analyzer import PainPointAnalyzer
from classifiers.industry_classifier import IndustryClassifier

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
    active_sources: list[str] = ["wellfound", "product_hunt", "job_board", "detroit_business"]


class AnalysisRequest(BaseModel):
    lead: RawLead
    config: Optional[PlatformConfig] = None


class ScrapeRequest(BaseModel):
    sources: list[str] = ["wellfound", "product_hunt", "job_board", "detroit_business"]
    config: Optional[PlatformConfig] = None


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok", "service": "anta-signal-engine", "timestamp": datetime.utcnow().isoformat()}


# ============================================================
# ANALYZE LEAD
# ============================================================

@app.post("/analyze")
async def analyze_lead(request: AnalysisRequest):
    """Analyze a raw lead and return signals, score, and pain points."""
    lead = request.lead

    target_locations = request.config.target_locations if request.config else None

    detector = SignalDetector(target_locations=target_locations)
    scorer = LeadScorer(target_locations=target_locations)
    pain_analyzer = PainPointAnalyzer()
    classifier = IndustryClassifier()

    # Detect signals
    signal_type, confidence = detector.detect(lead.model_dump())

    # Classify industry if missing
    industry = lead.industry or classifier.classify(
        company_name=lead.company_name,
        description=lead.description or "",
        job_title=lead.job_title or "",
    )

    # Analyze pain points
    pain_points, recommended_service, outreach_angle = pain_analyzer.analyze(
        industry=industry,
        hiring_signal=lead.hiring_signal or "",
        job_title=lead.job_title or "",
        description=lead.description or "",
        location=lead.location or "",
    )

    # Score the lead
    score_result = scorer.score(
        company_size=lead.company_size or "unknown",
        hiring_signal=lead.hiring_signal or "",
        job_title=lead.job_title or "",
        description=lead.description or "",
        location=lead.location or "",
        industry=industry,
    )

    return {
        "lead_score": score_result["overall_score"],
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

    scrapers = {
        "wellfound": WellfoundScraper(target_locations=target_locations),
        "product_hunt": ProductHuntScraper(),
        "job_board": JobBoardScraper(target_locations=target_locations),
        "detroit_business": DetroitBusinessScraper(),
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
                        print(f"[Scraper] Failed to save lead: {e}")

                log_status = "completed"
                any_success = True

            except Exception as e:
                error_msg = str(e)
                print(f"[Scraper] {source} failed: {e}")

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
                print(f"[Scraper] Failed to write log for {source}: {e}")

        overall_status = "completed" if any_success else "failed"
        scrape_jobs[job_id].update({
            "status": overall_status,
            "completed_at": datetime.utcnow().isoformat(),
            "results": total_new,
        })

    except Exception as e:
        scrape_jobs[job_id]["status"] = "failed"
        scrape_jobs[job_id]["error"] = str(e)

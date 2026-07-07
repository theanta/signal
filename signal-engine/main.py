"""ANTA Lead Radar - Signal Engine (FastAPI)"""

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from typing import AsyncGenerator, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from scrapers.linkedin import LinkedInJobsScraper
from scrapers.crunchbase import CrunchbaseScraper
from scrapers.job_boards import JobBoardScraper
from scrapers.local_business import LocalBusinessScraper
from scrapers.remote_jobs import RemoteJobsScraper
from analyzers.signal_detector import SignalDetector
from scoring.lead_scorer import LeadScorer
from analyzers.pain_point_analyzer import PainPointAnalyzer
from classifiers.industry_classifier import IndustryClassifier
from enrichment.website_verifier import verify_website
from enrichment.tech_stack_detector import detect_tech_stack, infer_gaps
from enrichment.contact_finder import find_contact
from enrichment.website_content_scraper import scrape_website_content
from scrapers.lead_merger import merge_leads

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
# One condition per active job — lets the SSE generator wait for new events
# and replay everything already emitted to any (re)connecting client.
scrape_conditions: dict[str, asyncio.Condition] = {}


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
    # Number of independent scrapers that found this company (set by lead_merger.py
    # at scrape time, persisted on the lead row — see leads.source_count)
    source_count: int = 1
    # Cached enrichment from a prior analysis — skips expensive API calls on re-analysis
    cached_tech_stack: Optional[list[str]] = None
    cached_tech_gaps: Optional[list[str]] = None
    cached_contact: Optional[dict] = None
    cached_verified_website: Optional[str] = None


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
    active_sources: list[str] = ["linkedin", "crunchbase", "job_board", "local_business", "remote_jobs"]
    # Remote job scraping settings — independent of target_locations, since remote
    # postings are location-agnostic by definition
    remote_job_roles: list[str] = ["software engineer", "full stack developer", "product designer"]
    remote_experience_level: str = ""
    remote_technologies: list[str] = []
    remote_regions: list[str] = ["United States"]


class AnalysisRequest(BaseModel):
    lead: RawLead
    config: Optional[PlatformConfig] = None


class ScrapeRequest(BaseModel):
    sources: list[str] = ["linkedin", "crunchbase", "job_board", "local_business", "remote_jobs"]
    config: Optional[PlatformConfig] = None


# ============================================================
# HEALTH
# ============================================================

@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok", "service": "anta-signal-engine", "timestamp": datetime.utcnow().isoformat()}


# ============================================================
# ANALYZE LEAD — shared core logic
# ============================================================

async def _analyze_lead_core(
    lead: RawLead,
    config: Optional[PlatformConfig],
) -> AsyncGenerator[tuple[str, object], None]:
    """
    Core analysis logic expressed as an async generator.
    Yields (phase, payload) tuples:
      - ("enriching",   message_str)   — before parallel enrichment
      - ("classifying", message_str)   — before signal detection + industry classification
      - ("analyzing",   message_str)   — before pain-point analysis + scoring (run in parallel)
      - ("complete",    result_dict)   — final yield with the full analysis result
    """
    # ---- Enterprise disqualification ----
    is_enterprise, disqualify_reason = _is_enterprise_company(lead.company_name, lead.company_size)
    if is_enterprise:
        yield ("complete", {
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
        })
        return

    target_locations = config.target_locations if config else None
    detector = SignalDetector(target_locations=target_locations)
    scorer = LeadScorer(target_locations=target_locations)
    pain_analyzer = PainPointAnalyzer()
    classifier = IndustryClassifier()

    # ---- Step 1: Parallel enrichment ----
    yield ("enriching", "Verifying website and detecting tech stack…")

    async def _with_timeout(coro, seconds):
        try:
            return await asyncio.wait_for(coro, timeout=seconds)
        except asyncio.TimeoutError as exc:
            return exc

    async def _cached(value):
        return value

    use_cached_website = bool(lead.cached_verified_website)
    use_cached_tech    = lead.cached_tech_stack is not None
    use_cached_contact = bool(lead.cached_contact)

    if use_cached_website:
        logger.info("[enrichment] website: using cached value")
    if use_cached_tech:
        logger.info("[enrichment] tech_stack: using cached value")
    if use_cached_contact:
        logger.info("[enrichment] contact: using cached value")

    verified_website_res, raw_tech_stack, contact_res, website_content_res = await asyncio.gather(
        _cached(lead.cached_verified_website) if use_cached_website
            else _with_timeout(asyncio.to_thread(verify_website, lead.website, lead.company_name, lead.location or ""), 15),
        _cached(lead.cached_tech_stack) if use_cached_tech
            else _with_timeout(asyncio.to_thread(detect_tech_stack, lead.website or ""), 15),
        _cached(lead.cached_contact) if use_cached_contact
            else _with_timeout(asyncio.to_thread(find_contact, lead.company_name, lead.website, lead.location), 20),
        _with_timeout(scrape_website_content(lead.website or ""), 20),
        return_exceptions=True,
    )

    if isinstance(verified_website_res, Exception):
        logger.warning(f"[enrichment] verify_website failed: {verified_website_res}")
    if isinstance(raw_tech_stack, Exception):
        logger.warning(f"[enrichment] detect_tech_stack failed: {raw_tech_stack}")
    if isinstance(contact_res, Exception):
        logger.warning(f"[enrichment] find_contact failed: {contact_res}")
    if isinstance(website_content_res, Exception):
        logger.warning(f"[enrichment] scrape_website_content failed: {website_content_res}")

    verified_website = verified_website_res if isinstance(verified_website_res, str) else lead.website
    tech_stack: list[str] = raw_tech_stack if isinstance(raw_tech_stack, list) else []
    tech_gaps: list[str] = (
        lead.cached_tech_gaps if lead.cached_tech_gaps is not None else infer_gaps(tech_stack)
    )
    contact: dict | None = contact_res if isinstance(contact_res, dict) else None
    website_content: str = website_content_res if isinstance(website_content_res, str) else ""

    # ---- Steps 2+3: Signal detection + industry classification ----
    yield ("classifying", "Classifying industry and detecting signals…")

    signal_type, confidence = detector.detect(lead.model_dump())

    # Always re-classify using website content — never trust lead.industry from the scraper.
    # Scrapers often misclassify (e.g. "Fulltime/Contract" job title → "Legal Services" false positive).
    industry = classifier.classify(
        company_name=lead.company_name,
        description=lead.description or "",
        job_title=lead.job_title or "",
        website_content=website_content,
    )
    if industry == "General Business" and lead.industry:
        industry = lead.industry

    _VENDOR_INDUSTRIES = {"IT Consulting / Managed Services", "SaaS / Software", "AI / Machine Learning"}
    is_vendor_company = industry in _VENDOR_INDUSTRIES

    # ---- Steps 4+5: Pain point analysis + scoring in parallel ----
    # pain_analyzer calls Groq (I/O-bound); scorer is pure CPU — both are independent.
    yield ("analyzing", "Identifying pain points and scoring lead…")

    pain_result, score_result = await asyncio.gather(
        asyncio.to_thread(
            pain_analyzer.analyze,
            company_name=lead.company_name,
            industry=industry,
            hiring_signal=lead.hiring_signal or "",
            job_title=lead.job_title or "",
            description=lead.description or "",
            location=lead.location or "",
            tech_stack=tech_stack,
            tech_gaps=tech_gaps,
            website_content=website_content,
            is_vendor_company=is_vendor_company,
        ),
        asyncio.to_thread(
            scorer.score,
            company_size=lead.company_size or "unknown",
            hiring_signal=lead.hiring_signal or "",
            job_title=lead.job_title or "",
            description=lead.description or "",
            location=lead.location or "",
            industry=industry,
            tech_stack=tech_stack,
            tech_gaps=tech_gaps,
            source_count=lead.source_count,
        ),
    )
    pain_points, recommended_service, outreach_angle = pain_result

    yield ("complete", {
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
        "source_count": score_result["source_count"],
        "scoring_breakdown": {
            "company_size_score": score_result["company_size_score"],
            "hiring_urgency_score": score_result["hiring_urgency_score"],
            "complexity_score": score_result["complexity_score"],
            "digital_score": score_result["digital_score"],
        },
        "scoring_rationale": score_result["rationale"],
        "tech_stack": tech_stack,
        "tech_gaps": tech_gaps,
        "verified_website": verified_website,
        "contact": contact,
    })


@app.post("/analyze")
async def analyze_lead(request: AnalysisRequest):
    """Analyze a raw lead and return signals, score, pain points, tech stack, and contact."""
    result = None
    async for phase, payload in _analyze_lead_core(request.lead, request.config):
        if phase == "complete":
            result = payload
    return result


@app.post("/analyze/stream")
async def analyze_lead_stream(request: AnalysisRequest):
    """Same as /analyze but streams SSE progress events as each phase completes."""
    async def event_stream():
        async for phase, payload in _analyze_lead_core(request.lead, request.config):
            if phase == "complete":
                yield f"data: {json.dumps({'phase': 'complete', 'result': payload})}\n\n"
            else:
                yield f"data: {json.dumps({'phase': phase, 'message': payload})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ============================================================
# SCRAPING
# ============================================================

@app.post("/scrape")
async def trigger_scrape(request: ScrapeRequest, background_tasks: BackgroundTasks):
    """Trigger a scraping run in the background."""
    job_id = str(uuid.uuid4())

    # When a config is supplied, only run sources that are both requested for
    # this call (e.g. a cron job's cadence-specific list) AND currently toggled
    # on in Settings — so a per-cadence trigger can't run a source the user disabled.
    cfg = request.config
    effective_sources = (
        [s for s in request.sources if s in cfg.active_sources] if cfg else request.sources
    )

    scrape_jobs[job_id] = {
        "status": "running",
        "started_at": datetime.utcnow().isoformat(),
        "results": 0,
        "sources": {s: {"status": "pending"} for s in effective_sources},
        "events": [],
    }
    scrape_conditions[job_id] = asyncio.Condition()

    background_tasks.add_task(run_scrape_job, job_id, effective_sources, cfg)

    return {"job_id": job_id, "status": "running", "sources": effective_sources}


async def _emit_scrape_event(job_id: str, event: dict) -> None:
    """Append an event to the job's history and wake any listening SSE stream."""
    condition = scrape_conditions.get(job_id)
    if not condition:
        return
    async with condition:
        scrape_jobs[job_id]["events"].append(event)
        condition.notify_all()


@app.get("/scrape/{job_id}")
async def get_scrape_job(job_id: str):
    """Get the status of a scraping job."""
    job = scrape_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, **{k: v for k, v in job.items() if k != "events"}}


@app.get("/scrape/{job_id}/stream")
async def stream_scrape_job(job_id: str):
    """Server-sent events: per-source scrape progress, in real time."""
    job = scrape_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_stream() -> AsyncGenerator[str, None]:
        # Always lead with the full current state — covers reconnects and
        # clients that connect after some (or all) sources already finished.
        yield f"data: {json.dumps({'phase': 'snapshot', 'sources': job['sources'], 'overall_status': job['status']})}\n\n"

        if job["status"] != "running":
            return

        condition = scrape_conditions.get(job_id)
        if not condition:
            return

        sent = 0
        while True:
            async with condition:
                await condition.wait_for(lambda: len(job["events"]) > sent or job["status"] != "running")
                pending_events = job["events"][sent:]
                sent = len(job["events"])
            for event in pending_events:
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("phase") == "complete":
                    return
            if job["status"] != "running":
                return

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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
    agency_location = cfg.agency_location if cfg else None

    scrapers = {
        "linkedin": LinkedInJobsScraper(target_locations=target_locations),
        "crunchbase": CrunchbaseScraper(),
        "job_board": JobBoardScraper(target_locations=target_locations, agency_location=agency_location),
        "local_business": LocalBusinessScraper(
            target_locations=target_locations,
            target_industries=target_industries,
        ),
        "remote_jobs": RemoteJobsScraper(
            job_roles=cfg.remote_job_roles if cfg else None,
            experience_level=cfg.remote_experience_level if cfg else None,
            technologies=cfg.remote_technologies if cfg else None,
            regions=cfg.remote_regions if cfg else None,
        ),
    }

    any_success = False
    all_raw_leads: list[dict] = []
    source_log_ids: dict[str, int] = {}
    # Sources whose own scrape succeeded and are logged as 'finalizing' — Phase 4
    # promotes exactly these to 'completed' once their leads are actually persisted.
    # ('failed' sources are already final and shouldn't be touched in Phase 4.)
    finalizing_sources: set[str] = set()

    try:
        # ---- Phase 1: Run all scrapers; collect raw leads + write per-source logs ----
        for source in sources:
            scraper = scrapers.get(source)
            if not scraper:
                continue

            source_started = datetime.utcnow()
            leads_found = 0
            log_status = "failed"
            error_msg = None

            try:
                leads = await asyncio.to_thread(scraper.scrape)
                leads_found = len(leads)
                all_raw_leads.extend(leads)
                log_status = "completed"
                any_success = True
            except Exception as e:
                error_msg = str(e)
                logger.error(f"[Scraper] {source} failed: {e}")

            # Report per-source outcome immediately — don't wait on the DB
            # round-trip below — so the frontend sees it in real time. This is
            # purely "did the scraper itself finish" progress and is fine as
            # 'completed'/'failed' — the persisted log row below is different.
            scrape_jobs[job_id]["sources"][source] = {
                "status": log_status,
                "leads_found": leads_found,
                "error": error_msg,
            }
            await _emit_scrape_event(job_id, {
                "phase": "source",
                "source": source,
                "status": log_status,
                "leads_found": leads_found,
                "error": error_msg,
            })

            duration_ms = int((datetime.utcnow() - source_started).total_seconds() * 1000)
            # A successful scrape isn't 'completed' yet from the Activity Log's point of
            # view — the cross-source merge + lead persistence (Phase 2-4) hasn't run,
            # so leads_new/leads_updated aren't known. Log it as 'finalizing' and only
            # promote to 'completed' once Phase 4 has the real counts.
            persisted_status = "finalizing" if log_status == "completed" else log_status
            try:
                log_insert = supabase.table("scraping_logs").insert({
                    "job_id": job_id,
                    "source": source,
                    "status": persisted_status,
                    "leads_found": leads_found,
                    # leads_new/leads_updated are patched in after the cross-source merge below
                    "leads_new": 0,
                    "leads_updated": 0,
                    "duration_ms": duration_ms,
                    "started_at": source_started.isoformat(),
                    "completed_at": datetime.utcnow().isoformat(),
                    "error_message": error_msg,
                    "created_at": datetime.utcnow().isoformat(),
                }).execute()
                if log_insert.data:
                    source_log_ids[source] = log_insert.data[0]["id"]
                    if persisted_status == "finalizing":
                        finalizing_sources.add(source)
            except Exception as e:
                logger.error(f"[Scraper] Failed to write log for {source}: {e}")

        # ---- Phase 2: Cross-source merge ----
        merged_leads = merge_leads(all_raw_leads)
        multi_source = sum(1 for l in merged_leads if l.get("source_count", 1) >= 2)
        logger.info(
            f"[Merger] {len(all_raw_leads)} raw leads → {len(merged_leads)} merged "
            f"({multi_source} cross-source)"
        )

        # ---- Phase 3: Insert new leads / refresh existing ones ----
        # Previously this did one `select` + one `insert`/`update` round-trip per merged
        # lead, serially — for a few hundred merged leads that's 500-1000+ sequential
        # network calls, which is exactly why sources sat in a misleading 'finalizing'-
        # equivalent state for minutes. Now: one batched pre-fetch, chunked bulk inserts,
        # and bounded-concurrency updates.
        total_new = 0
        failed_inserts = 0
        per_source_new: dict[str, int] = {}
        per_source_updated: dict[str, int] = {}

        all_urls_flat = list({
            u
            for lead_data in merged_leads
            for u in (lead_data.get("_all_source_urls") or [lead_data.get("source_url", "")])
            if u
        })
        existing_by_url: dict[str, str] = {}
        URL_LOOKUP_CHUNK = 200  # keep each `.in_()` filter within a safe query-size bound
        for i in range(0, len(all_urls_flat), URL_LOOKUP_CHUNK):
            chunk = all_urls_flat[i:i + URL_LOOKUP_CHUNK]
            try:
                res = supabase.table("leads").select("id, source_url").in_("source_url", chunk).execute()
                for row in res.data or []:
                    existing_by_url[row["source_url"]] = row["id"]
            except Exception as e:
                logger.error(f"[Scraper] Existing-lead lookup failed for a chunk of {len(chunk)}: {e}")

        new_rows: list[dict] = []
        new_rows_sources: list[list[str]] = []
        update_jobs: list[tuple[str, dict, list[str]]] = []

        for lead_data in merged_leads:
            contributing_sources = lead_data.get("contributing_sources") or [lead_data.get("source", "")]
            all_urls = lead_data.pop("_all_source_urls", [lead_data.get("source_url", "")])
            existing_id = next((existing_by_url[u] for u in all_urls if u in existing_by_url), None)

            if existing_id:
                # Refresh raw-scrape-derived fields only. Analysis-owned fields
                # (status, lead_score, contact_*, industry, analyzed_at) belong to
                # the separate /analyze flow and must not be clobbered here.
                refresh = {
                    k: v for k, v in {
                        "hiring_signal": lead_data.get("hiring_signal"),
                        "description": lead_data.get("description"),
                        "location": lead_data.get("location"),
                        "job_title": lead_data.get("job_title"),
                        "company_size": lead_data.get("company_size"),
                    }.items() if v
                }
                refresh["source_count"] = lead_data.get("source_count", 1)
                refresh["contributing_sources"] = contributing_sources
                refresh["updated_at"] = datetime.utcnow().isoformat()
                update_jobs.append((existing_id, refresh, contributing_sources))
            else:
                new_rows.append({
                    **lead_data,
                    "status": "new",
                    "scraped_at": datetime.utcnow().isoformat(),
                    "created_at": datetime.utcnow().isoformat(),
                    "updated_at": datetime.utcnow().isoformat(),
                })
                new_rows_sources.append(contributing_sources)

        # Bulk-insert new leads in chunks — one round trip per chunk instead of per lead.
        # If a chunk fails (e.g. one bad row), fall back to inserting it row-by-row so a
        # single bad lead can't sink the whole chunk's worth of good ones.
        INSERT_CHUNK = 50
        for i in range(0, len(new_rows), INSERT_CHUNK):
            chunk = new_rows[i:i + INSERT_CHUNK]
            chunk_sources = new_rows_sources[i:i + INSERT_CHUNK]
            try:
                supabase.table("leads").insert(chunk).execute()
                total_new += len(chunk)
                for sources in chunk_sources:
                    for s in sources:
                        per_source_new[s] = per_source_new.get(s, 0) + 1
            except Exception as e:
                logger.warning(f"[Scraper] Bulk insert failed for a chunk of {len(chunk)}, retrying individually: {e}")
                for row, sources in zip(chunk, chunk_sources):
                    try:
                        supabase.table("leads").insert(row).execute()
                        total_new += 1
                        for s in sources:
                            per_source_new[s] = per_source_new.get(s, 0) + 1
                    except Exception as e2:
                        failed_inserts += 1
                        logger.error(f"[Scraper] Failed to insert '{row.get('company_name', '?')}': {e2}")

        # Refresh existing leads concurrently (bounded) instead of one-by-one serially —
        # each has a different payload so it can't collapse into a single bulk call.
        update_semaphore = asyncio.Semaphore(10)

        async def _apply_update(existing_id: str, refresh: dict) -> bool:
            async with update_semaphore:
                try:
                    await asyncio.to_thread(
                        lambda: supabase.table("leads").update(refresh).eq("id", existing_id).execute()
                    )
                    return True
                except Exception as e:
                    logger.error(f"[Scraper] Failed to update lead {existing_id}: {e}")
                    return False

        update_results = await asyncio.gather(*(
            _apply_update(existing_id, refresh) for existing_id, refresh, _ in update_jobs
        ))
        for (_, _, sources), ok in zip(update_jobs, update_results):
            if ok:
                for s in sources:
                    per_source_updated[s] = per_source_updated.get(s, 0) + 1
            else:
                failed_inserts += 1

        if failed_inserts:
            logger.error(f"[Scraper] {failed_inserts} merged lead(s) failed to insert/update")

        # ---- Phase 4: Patch per-source scraping_logs rows with real new/updated counts,
        # and promote 'finalizing' rows to 'completed' now that persistence is done ----
        for source, log_id in source_log_ids.items():
            update_payload: dict = {
                "leads_new": per_source_new.get(source, 0),
                "leads_updated": per_source_updated.get(source, 0),
            }
            if source in finalizing_sources:
                update_payload["status"] = "completed"
            try:
                supabase.table("scraping_logs").update(update_payload).eq("id", log_id).execute()
            except Exception as e:
                logger.error(f"[Scraper] Failed to patch log counts for {source}: {e}")

        overall_status = "completed" if any_success else "failed"
        scrape_jobs[job_id].update({
            "status": overall_status,
            "completed_at": datetime.utcnow().isoformat(),
            "results": total_new,
        })
        await _emit_scrape_event(job_id, {"phase": "complete", "status": overall_status, "results": total_new})

    except Exception as e:
        scrape_jobs[job_id]["status"] = "failed"
        scrape_jobs[job_id]["error"] = str(e)
        await _emit_scrape_event(job_id, {"phase": "complete", "status": "failed", "results": scrape_jobs[job_id].get("results", 0)})

    finally:
        scrape_conditions.pop(job_id, None)

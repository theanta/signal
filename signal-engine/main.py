"""ANTA Lead Radar - Signal Engine (FastAPI)"""

import asyncio
from contextlib import asynccontextmanager
import json
import logging
import re
from datetime import datetime, timedelta
from typing import AsyncGenerator, Optional
from uuid import UUID

from dotenv import load_dotenv
from fastapi import FastAPI, BackgroundTasks, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
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
from scoring.model import blend, fit_score, intent_score, normalize_weights
from analyzers.pain_point_analyzer import AgencyProfile, PainPointAnalyzer
from classifiers.industry_classifier import IndustryClassifier
from enrichment.website_verifier import verify_website
from enrichment.tech_stack_detector import detect_tech_stack, infer_gaps
from enrichment.contact_finder import find_contact
from enrichment.website_content_scraper import scrape_website_content
from enrichment.url_utils import clean_company_website
from scrapers.lead_merger import merge_leads
from auth import require_engine_key, verify_engine_key_configured
import metering
from jobstore import ActiveRunExists, ScrapeCapReached, TERMINAL_STATUSES, get_store

# ============================================================
# ENTERPRISE DISQUALIFICATION
# Companies too large to be a small or mid-sized agency's client.
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
    # Automotive
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
        return True, "company size is 1,000+ employees — outside the SMB target market"
    normalized = _CORP_SUFFIX_RE.sub("", company_name.lower()).strip()
    if normalized in ENTERPRISE_BRANDS:
        return True, f"{company_name} is a known enterprise company — outside the SMB target market"
    return False, ""


# A running scrape heartbeats this often; the reaper fails any active run
# whose heartbeat is older than STALE_AFTER, checking every REAP_INTERVAL.
# Without the reaper, a run killed by a deploy holds its org's one active-run
# slot (one_active_scrape_per_org) forever.
HEARTBEAT_SECONDS = 60
STALE_AFTER = timedelta(minutes=15)
REAP_INTERVAL_SECONDS = 300


async def _reaper_loop() -> None:
    while True:
        try:
            reaped = await asyncio.to_thread(get_store().reap_stale, STALE_AFTER)
            for run in reaped:
                logger.warning(f"[reaper] failed stale scrape run {run['id']} (org {run['org_id']})")
        except Exception as e:
            logger.error(f"[reaper] sweep failed: {e}")
        await asyncio.sleep(REAP_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Surface a missing shared secret on boot rather than on the first request.
    verify_engine_key_configured()
    reaper = asyncio.create_task(_reaper_loop())
    yield
    reaper.cancel()


app = FastAPI(
    title="ANTA Lead Radar Signal Engine",
    description="Python signal detection and lead analysis microservice",
    version="1.0.0",
    lifespan=lifespan,
)

# No CORSMiddleware. This service is called server-to-server by the Express
# backend only; the browser reaches its SSE stream proxied through Express.
# A browser-facing CORS policy would only widen the attack surface.

# Scrape runs live in Postgres (jobstore.py), so a restart does not lose them
# and any engine instance can report on any run.
# How often the SSE stream polls scrape_job_events for new rows.
STREAM_POLL_SECONDS = 1.0
# find_contact's own budget; see the enrichment step of _analyze_lead_core.
CONTACT_BUDGET_SECONDS = 40
STREAM_PING_SECONDS = 10.0


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
    """The tenant's settings, sent by the backend on every call. No field
    defaults to any one agency: an unset value is empty, not ANTA's."""
    agency_name: str
    agency_location: str = ""
    agency_tagline: str = ""
    services: list[str] = []
    outreach_tone: str = ""
    cta_style: str = ""
    sign_off: str = ""
    target_locations: list[str] = []
    target_company_sizes: list[str] = []
    target_industries: list[str] = []
    # Hiring roles that signal a need for the agency's services. Empty means
    # the generic defaults in scrapers/targeting.py.
    target_roles: list[str] = []
    active_sources: list[str] = ["linkedin", "local_business"]
    # How the overall score blends fit, intent, AI judgment and engagement.
    # Missing keys fall back to scoring.model.DEFAULT_WEIGHTS.
    scoring_weights: dict = {}

    def agency(self) -> AgencyProfile:
        return AgencyProfile(
            name=self.agency_name,
            location=self.agency_location,
            tagline=self.agency_tagline,
            services=tuple(self.services),
        )


class AnalysisRequest(BaseModel):
    lead: RawLead
    # Required: the analysis is written for this agency (its name, services
    # and target market), and there is no one agency to default to.
    config: PlatformConfig
    # Required, and a UUID: the engine holds the service-role key and can write
    # into any org, so it never picks one. An authenticated backend supplies it.
    org_id: UUID


# The scrapers this phase runs. Indeed (job_board) and Crunchbase stay in the
# code but are paused: a request for them is ignored, so they never spend
# Apify credits. Keep in step with ENABLED_SOURCES in shared/types.
ENABLED_SOURCES = {"linkedin", "local_business"}


class ScrapeRequest(BaseModel):
    sources: list[str] = ["linkedin", "local_business"]
    # Required: every scraper's geography and roles come from it.
    config: PlatformConfig
    org_id: UUID


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
    config: PlatformConfig,
    # Present so that any persistence added here inherits the caller's org
    # rather than reaching for a global default.
    org_id: str,
) -> AsyncGenerator[tuple[str, object], None]:
    """
    Core analysis logic expressed as an async generator.
    Yields (phase, payload) tuples:
      - ("enriching",   message_str)   — before parallel enrichment
      - ("classifying", message_str)   — before signal detection + industry classification
      - ("analyzing",   message_str)   — before pain-point analysis + scoring (run in parallel)
      - ("complete",    result_dict)   — final yield with the full analysis result
    """
    # A LinkedIn/Facebook/etc. page in the website field is worse than no
    # website: enrichment scrapes blocked pages and email domains get derived
    # from the wrong host. Drop such URLs up front so every consumer below
    # (verifier, tech stack, contact finder, content scraper) sees None and
    # falls back to name/location-based discovery instead.
    lead.website = clean_company_website(lead.website)
    lead.cached_verified_website = clean_company_website(lead.cached_verified_website)

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
            "operational_maturity": "N/A — Enterprise company, outside the target market",
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
            "scores": {
                "fit": None, "intent": None, "ai": None, "engagement": None,
                "weights": normalize_weights(config.scoring_weights),
                "overall": 0,
                "disqualified": disqualify_reason,
            },
        })
        return

    target_locations = config.target_locations
    detector = SignalDetector(target_locations=target_locations)
    scorer = LeadScorer(target_locations=target_locations)
    pain_analyzer = PainPointAnalyzer(config.agency())
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
        # find_contact stops starting new stages after CONTACT_BUDGET_SECONDS and
        # returns what it has, so a slow site or verifier no longer discards
        # the LinkedIn person it already found. The outer timeout is only a
        # backstop for a single call that hangs past its own timeout.
        _cached(lead.cached_contact) if use_cached_contact
            else _with_timeout(asyncio.to_thread(find_contact, lead.company_name, lead.website,
                                                 lead.location, CONTACT_BUDGET_SECONDS),
                               CONTACT_BUDGET_SECONDS + 20),
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
            pain_analyzer.analyze_with_judgment,
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
    pain_points = pain_result["pain_points"]
    recommended_service = pain_result["recommended_service"]
    outreach_angle = pain_result["outreach_angle"]

    # ---- Step 6: the scoring model ----
    # Fit and intent are rules; the AI judgment came with the pain points;
    # engagement is added by the backend once outreach exists.
    fit = fit_score(
        company_size=lead.company_size, industry=industry, location=lead.location,
        tech_stack=tech_stack, tech_gaps=tech_gaps,
        target_company_sizes=config.target_company_sizes,
        target_industries=config.target_industries,
        target_locations=config.target_locations,
    )
    intent = intent_score(
        job_title=lead.job_title, hiring_signal=lead.hiring_signal,
        description=lead.description, source_count=lead.source_count,
        target_roles=config.target_roles,
    )
    ai = ({"score": pain_result["fit_score"], "reason": pain_result["fit_reason"]}
          if pain_result.get("fit_score") is not None else None)
    weights = normalize_weights(config.scoring_weights)
    overall = blend(weights, {
        "fit": fit["score"], "intent": intent["score"],
        "ai": ai["score"] if ai else None,
    })

    yield ("complete", {
        "lead_score": overall,
        "scores": {
            "fit": fit, "intent": intent, "ai": ai, "engagement": None,
            "weights": weights, "overall": overall,
        },
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


@app.post("/analyze", dependencies=[Depends(require_engine_key)])
async def analyze_lead(request: AnalysisRequest):
    """Analyze a raw lead and return signals, score, pain points, tech stack, and contact."""
    metering.bind(str(request.org_id))
    result = None
    async for phase, payload in _analyze_lead_core(request.lead, request.config, str(request.org_id)):
        if phase == "complete":
            result = payload
    return result


@app.post("/analyze/stream", dependencies=[Depends(require_engine_key)])
async def analyze_lead_stream(request: AnalysisRequest):
    """Same as /analyze but streams SSE progress events as each phase completes."""
    async def event_stream():
        # Bound here, in the task that drives the stream: each ensure_future
        # below copies this context into the step it runs.
        metering.bind(str(request.org_id))
        gen = _analyze_lead_core(request.lead, request.config, str(request.org_id))
        while True:
            next_event = asyncio.ensure_future(anext(gen))
            # Long quiet gaps (the Groq phase can run 30s+) get idle-killed by
            # intermediary proxies (Vercel rewrite, Render). SSE comment lines
            # are ignored by clients but keep the connection alive.
            while True:
                done, _ = await asyncio.wait({next_event}, timeout=10)
                if done:
                    break
                yield ": ping\n\n"

            try:
                phase, payload = next_event.result()
            except StopAsyncIteration:
                return
            except Exception as e:
                # Surface failures as a terminal SSE event — a silently dropped
                # stream leaves the frontend spinner hanging with no explanation.
                logger.error(f"[analyze/stream] analysis failed: {e}")
                yield f"data: {json.dumps({'phase': 'error', 'message': str(e)})}\n\n"
                return

            if phase == "complete":
                yield f"data: {json.dumps({'phase': 'complete', 'result': payload})}\n\n"
            else:
                yield f"data: {json.dumps({'phase': phase, 'message': payload})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ============================================================
# SCRAPING
# ============================================================

@app.post("/scrape", dependencies=[Depends(require_engine_key)])
async def trigger_scrape(request: ScrapeRequest, background_tasks: BackgroundTasks):
    """Record a scrape run and start it in the background.

    409 when the org already has a run in progress: one_active_scrape_per_org
    allows one queued/running/finalizing run per org. 429 when the org has used
    its monthly_scrape_cap."""
    org_id = str(request.org_id)

    # When a config is supplied, only run sources that are both requested for
    # this call (e.g. a cron job's cadence-specific list) AND currently toggled
    # on in Settings — so a per-cadence trigger can't run a source the user disabled.
    cfg = request.config
    if not cfg.target_locations:
        raise HTTPException(
            status_code=400,
            detail={"error": "not_configured",
                    "message": "Set target locations in Settings before scraping."},
        )
    effective_sources = [s for s in request.sources
                         if s in cfg.active_sources and s in ENABLED_SOURCES]

    try:
        job_id = await asyncio.to_thread(
            get_store().create_run, org_id, effective_sources, cfg.model_dump(),
        )
    except ActiveRunExists:
        raise HTTPException(
            status_code=409,
            detail={"error": "scrape_already_running",
                    "message": "A scrape is already running for this organization."},
        )
    except ScrapeCapReached as e:
        raise HTTPException(
            status_code=429,
            detail={"error": "scrape_cap_reached",
                    "message": f"This organization has used all {e.cap} scrapes for this month."},
        )

    background_tasks.add_task(run_scrape_job, job_id, org_id, effective_sources, cfg)

    return {"job_id": job_id, "status": "running", "sources": effective_sources}


async def _emit_scrape_event(job_id: str, org_id: str, event: dict) -> None:
    """Persist an event for the run's SSE stream. A failed write is logged and
    dropped: progress reporting must never fail the scrape itself."""
    try:
        await asyncio.to_thread(get_store().append_event, job_id, org_id, event)
    except Exception as e:
        logger.error(f"[Scraper] Failed to record event for run {job_id}: {e}")


async def _update_run(job_id: str, org_id: str, **fields) -> None:
    try:
        await asyncio.to_thread(get_store().update_run, job_id, org_id, **fields)
    except Exception as e:
        logger.error(f"[Scraper] Failed to update run {job_id}: {e}")


def _parse_last_event_id(value: Optional[str]) -> int:
    """The seq a reconnecting client last saw; 0 (replay everything) when the
    header is missing or not a non-negative integer."""
    try:
        seq = int(value) if value is not None else 0
    except ValueError:
        return 0
    return seq if seq > 0 else 0


def _run_view(run: dict) -> dict:
    return {
        "job_id": run["id"],
        "org_id": run["org_id"],
        "status": run["status"],
        "started_at": run["created_at"],
        "completed_at": run.get("finished_at"),
        "results": run.get("results", 0),
        "sources": run.get("source_state") or {},
        "error": run.get("error"),
    }


@app.get("/scrape/{job_id}", dependencies=[Depends(require_engine_key)])
async def get_scrape_job(job_id: UUID, org_id: UUID):
    """Status of one of the org's scrape runs. Another org's run is a 404."""
    run = await asyncio.to_thread(get_store().get_run, str(job_id), str(org_id))
    if not run:
        raise HTTPException(status_code=404, detail="Job not found")
    return _run_view(run)


@app.get("/scrape/{job_id}/stream", dependencies=[Depends(require_engine_key)])
async def stream_scrape_job(
    job_id: UUID, org_id: UUID, last_event_id: Optional[str] = Header(default=None),
):
    """Server-sent events: per-source scrape progress, read from Postgres.

    Every event carries `id: <seq>`. A client that reconnects with
    Last-Event-ID resumes after that event instead of replaying the run, and
    any engine instance can serve the stream because the events are rows."""
    run_id, org = str(job_id), str(org_id)
    store = get_store()
    run = await asyncio.to_thread(store.get_run, run_id, org)
    if not run:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_stream() -> AsyncGenerator[str, None]:
        # Always lead with the full current state — covers reconnects and
        # clients that connect after some (or all) sources already finished.
        view = _run_view(run)
        yield f"data: {json.dumps({'phase': 'snapshot', 'sources': view['sources'], 'overall_status': view['status']})}\n\n"
        if run["status"] in TERMINAL_STATUSES:
            return

        last_seq = _parse_last_event_id(last_event_id)
        idle_polls = 0
        while True:
            rows = await asyncio.to_thread(store.events_after, run_id, org, last_seq)
            for row in rows:
                last_seq = row["seq"]
                yield f"id: {row['seq']}\ndata: {json.dumps(row['event'])}\n\n"
                if row["event"].get("phase") == "complete":
                    return
            if not rows:
                current = await asyncio.to_thread(store.get_run, run_id, org)
                if not current or current["status"] in TERMINAL_STATUSES:
                    # Terminal with no complete event (e.g. reaped): close the
                    # stream with one so the client is not left waiting.
                    status = current["status"] if current else "failed"
                    yield f"data: {json.dumps({'phase': 'complete', 'status': status, 'results': (current or {}).get('results', 0)})}\n\n"
                    return
                # A scraper can run for minutes without an event. Proxies
                # (Vercel, Render) idle-kill a silent connection; an SSE
                # comment keeps it open and clients ignore it.
                idle_polls += 1
                if idle_polls * STREAM_POLL_SECONDS >= STREAM_PING_SECONDS:
                    idle_polls = 0
                    yield ": ping\n\n"
                await asyncio.sleep(STREAM_POLL_SECONDS)
            else:
                idle_polls = 0

    return StreamingResponse(event_stream(), media_type="text/event-stream")


async def run_scrape_job(job_id: str, org_id: str, sources: list[str], cfg: PlatformConfig):
    """Background task: runs all scrapers, saves leads, and writes scraping_logs rows.

    Runs with the service-role key, which can write into any org — so every
    row written here is stamped with `org_id`, and every lookup and update is
    filtered by it. The org comes from the authenticated backend, never from
    scraped data."""
    from supabase import create_client
    import os

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Every paid call made by this run's scrapers is attributed to it.
    metering.bind(org_id, job_id)
    heartbeat = asyncio.create_task(_heartbeat_loop(job_id, org_id))
    try:
        await _run_scrape_job_body(job_id, org_id, sources, cfg, supabase)
    finally:
        heartbeat.cancel()


async def _heartbeat_loop(job_id: str, org_id: str) -> None:
    """Keep the run's heartbeat fresh while a scraper runs for minutes without
    a progress write, so the reaper only ever fails runs whose worker died."""
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            await asyncio.to_thread(get_store().heartbeat, job_id, org_id)
        except Exception as e:
            logger.error(f"[Scraper] heartbeat for run {job_id} failed: {e}")


async def _run_scrape_job_body(job_id: str, org_id: str, sources: list[str],
                               cfg: PlatformConfig, supabase) -> None:
    scrapers = {
        "linkedin": LinkedInJobsScraper(target_locations=cfg.target_locations, target_roles=cfg.target_roles),
        "crunchbase": CrunchbaseScraper(target_locations=cfg.target_locations,
                                        target_industries=cfg.target_industries),
        "job_board": JobBoardScraper(target_locations=cfg.target_locations, target_roles=cfg.target_roles),
        "local_business": LocalBusinessScraper(
            target_locations=cfg.target_locations,
            target_industries=cfg.target_industries,
        ),
    }

    any_success = False
    total_new = 0
    # Per-source progress, written whole to scrape_jobs.source_state after each
    # source. Sources run one after another, so this process is its only writer.
    source_state: dict[str, dict] = {s: {"status": "pending"} for s in sources}
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
            source_state[source] = {
                "status": log_status,
                "leads_found": leads_found,
                "error": error_msg,
            }
            await _update_run(job_id, org_id, source_state=source_state)
            await _emit_scrape_event(job_id, org_id, {
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
                    "org_id": org_id,
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

        await _update_run(job_id, org_id, status="finalizing")

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
                # Org-scoped: without it, one tenant's scrape silently skips a
                # company because a *different* tenant already has it.
                res = (
                    supabase.table("leads").select("id, source_url")
                    .eq("org_id", org_id).in_("source_url", chunk).execute()
                )
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
                        "linkedin_url": lead_data.get("linkedin_url"),
                    }.items() if v
                }
                refresh["source_count"] = lead_data.get("source_count", 1)
                refresh["contributing_sources"] = contributing_sources
                refresh["updated_at"] = datetime.utcnow().isoformat()
                update_jobs.append((existing_id, refresh, contributing_sources))
            else:
                new_rows.append({
                    **lead_data,
                    "org_id": org_id,
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
                        lambda: supabase.table("leads").update(refresh)
                        .eq("id", existing_id).eq("org_id", org_id).execute()
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
                supabase.table("scraping_logs").update(update_payload).eq(
                    "id", log_id
                ).eq("org_id", org_id).execute()
            except Exception as e:
                logger.error(f"[Scraper] Failed to patch log counts for {source}: {e}")

        overall_status = "completed" if any_success else "failed"
        await _finish_run(job_id, org_id, overall_status, total_new, None, source_state)

    except Exception as e:
        logger.error(f"[Scraper] Run {job_id} failed: {e}")
        await _finish_run(job_id, org_id, "failed", total_new, str(e), source_state)


async def _finish_run(job_id: str, org_id: str, status: str, results: int,
                      error: Optional[str], source_state: dict) -> None:
    """Mark the run terminal, then emit the complete event the SSE stream
    closes on. Terminal first: a client that reconnects between the two still
    sees a finished run."""
    try:
        await asyncio.to_thread(get_store().finish, job_id, org_id, status, results, error, source_state)
    except Exception as e:
        logger.error(f"[Scraper] Failed to finish run {job_id}: {e}")
    await _emit_scrape_event(job_id, org_id, {"phase": "complete", "status": status, "results": results})

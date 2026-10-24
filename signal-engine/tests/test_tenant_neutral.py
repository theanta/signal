"""Nothing in the engine assumes the tenant is ANTA or that its market is
Michigan: identity, services, geography and roles all come from config."""
import pytest

import main
from analyzers import pain_point_analyzer as ppa
from scrapers.crunchbase import CrunchbaseScraper, build_queries
from scrapers.job_boards import JobBoardScraper
from scrapers.linkedin import LinkedInJobsScraper
from scrapers.targeting import DEFAULT_HIRING_ROLES, search_locations
from tests.conftest import TEST_CONFIG, VALID_KEY, tenant_config

H = {"X-Engine-Key": VALID_KEY}
ORG = "11111111-1111-1111-1111-111111111111"
FOREIGN = ("ANTA", "Detroit", "Michigan", "React/Next.js")
LEAD = {"company_name": "Acme Dental", "source_url": "https://acme.test", "source": "manual",
        "scraped_at": "2026-10-24T00:00:00"}

AGENCY = tenant_config().agency()
PROMPT_ARGS = dict(company_name="Acme Dental", industry="Healthcare", location="Austin, TX",
                   hiring_signal="Hiring marketing coordinator", job_title="Marketing Coordinator",
                   description="", tech_stack=[], website_content="")


@pytest.mark.parametrize("build", [ppa._build_prompt, ppa._build_partnership_prompt])
def test_prompts_name_the_tenant_and_its_services(build):
    prompt = build(agency=AGENCY, **PROMPT_ARGS)
    assert "Harbor Growth Partners" in prompt
    assert "Austin, Texas" in prompt
    for word in FOREIGN:
        assert word not in prompt
    if build is ppa._build_prompt:
        assert "- Paid Social Campaigns" in prompt


def test_a_tenant_without_services_gets_an_open_question():
    bare = ppa.AgencyProfile(name="Solo Studio")
    prompt = ppa._build_prompt(agency=bare, **PROMPT_ARGS)
    assert "Solo Studio has not listed its services" in prompt


def test_fallback_recommends_only_the_tenants_services():
    pains, service, angle = ppa._fallback_analyze(AGENCY, "Healthcare", "", "", "Austin, TX")
    assert service in AGENCY.services
    assert "Harbor Growth Partners" in angle
    assert not any(w in angle for w in FOREIGN)


def test_fallback_local_line_follows_the_tenants_location():
    _, _, local = ppa._fallback_analyze(AGENCY, "Healthcare", "", "", "Austin, TX")
    _, _, remote = ppa._fallback_analyze(AGENCY, "Healthcare", "", "", "Detroit, MI")
    assert "Austin, Texas-based" in local
    assert "knows the local market" not in remote


def test_vendor_fallback_uses_the_tenant(monkeypatch):
    monkeypatch.setattr(ppa, "_GROQ_API_KEY", "")
    _, _, angle = ppa.PainPointAnalyzer(AGENCY).analyze(
        industry="SaaS / Software", hiring_signal="", job_title="", description="",
        location="", is_vendor_company=True)
    assert "Harbor Growth Partners" in angle and "ANTA" not in angle


def test_crunchbase_searches_the_tenants_market():
    assert build_queries(["Austin", "Texas", "TX"], ["dental clinics"]) == [
        "dental clinics Austin", "dental clinics Texas"]
    assert build_queries(["Austin"], []) == ["Austin startup funded", "Austin growing company"]
    assert build_queries([], ["dental clinics"]) == []


def test_crunchbase_without_locations_refuses_to_run():
    with pytest.raises(RuntimeError, match="target locations"):
        CrunchbaseScraper(target_locations=[], target_industries=[]).scrape()


def test_linkedin_searches_the_tenants_roles_and_locations(monkeypatch):
    calls = []
    s = LinkedInJobsScraper(target_locations=["Austin", "Texas", "TX"], target_roles=["marketing coordinator"])
    monkeypatch.setattr(s, "_run_actor", lambda actor, run_input: calls.append(run_input) or [])
    s.scrape()
    assert [c["location"] for c in calls] == ["Austin", "Texas"]
    assert all(c["keywords"] == ["marketing coordinator"] for c in calls)
    assert sum(c["limit"] for c in calls) == LinkedInJobsScraper.TOTAL_LIMIT


def test_indeed_rotates_roles_over_the_tenants_locations(monkeypatch):
    calls = []
    s = JobBoardScraper(target_locations=["Austin", "Dallas"], target_roles=["a", "b", "c"])
    monkeypatch.setattr(s, "_run_actor", lambda actor, run_input: calls.append(run_input) or [])
    s.scrape()
    assert [(c["position"], c["location"]) for c in calls] == [("a", "Austin"), ("b", "Dallas"), ("c", "Austin")]


def test_unset_roles_fall_back_to_generic_ones_never_a_place():
    s = JobBoardScraper(target_locations=["Austin"], target_roles=[])
    assert s.roles == DEFAULT_HIRING_ROLES


def test_abbreviations_are_searched_only_when_nothing_longer_is_listed():
    assert search_locations(["MI", "Grand Rapids"]) == ["Grand Rapids"]
    assert search_locations(["TX"]) == ["TX"]


def test_scrape_without_config_is_rejected(client):
    r = client.post("/scrape", headers=H, json={"sources": ["job_board"], "org_id": ORG})
    assert r.status_code == 422


def test_scrape_without_target_locations_is_400(client):
    cfg = {**TEST_CONFIG, "target_locations": []}
    r = client.post("/scrape", headers=H, json={"sources": ["job_board"], "org_id": ORG, "config": cfg})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "not_configured"


@pytest.mark.parametrize("path", ["/analyze", "/analyze/stream"])
def test_analysis_without_config_is_rejected(client, path):
    r = client.post(path, headers=H, json={"lead": LEAD, "org_id": ORG})
    assert r.status_code == 422


def test_config_has_no_agency_defaults():
    with pytest.raises(Exception):
        main.PlatformConfig()  # agency_name is required
    cfg = main.PlatformConfig(agency_name="X")
    assert cfg.target_locations == [] and cfg.services == []

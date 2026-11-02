"""The scoring model: fit and intent are itemized rules, unknown inputs are
left out rather than given default points, the AI judgment is optional, and
the overall score blends whatever is present by the agency's weights."""
import pytest

from analyzers import pain_point_analyzer as ppa
from scoring.model import DEFAULT_WEIGHTS, blend, fit_score, intent_score, normalize_weights

FIT_ARGS = dict(
    company_size="51-200", industry="Healthcare", location="Austin, TX",
    tech_stack=["WordPress"], tech_gaps=["CRM", "Analytics"],
    target_company_sizes=["11-50", "51-200"], target_industries=["healthcare"],
    target_locations=["Austin"],
)


def test_fit_full_match_itemizes_every_rule():
    r = fit_score(**FIT_ARGS)
    labels = {f["label"]: (f["points"], f["max"]) for f in r["factors"]}
    assert labels == {"Company size": (35, 35), "Industry": (25, 25),
                      "Location": (25, 25), "Tech gaps": (10, 15)}
    assert r["score"] == 95
    assert r["unknown"] == []


def test_unknown_inputs_are_left_out_not_given_default_points():
    r = fit_score(**{**FIT_ARGS, "company_size": None, "tech_stack": []})
    assert "Company size" in r["unknown"]
    assert any(u.startswith("Tech gaps") for u in r["unknown"])
    # Industry 25/25 + location 25/25 out of the 50 that are known = 100.
    assert r["score"] == 100


def test_nothing_known_is_no_score_rather_than_zero():
    r = fit_score(company_size=None, industry=None, location=None, tech_stack=[], tech_gaps=[],
                  target_company_sizes=[], target_industries=[], target_locations=[])
    assert r["score"] is None


def test_adjacent_size_band_gets_partial_credit():
    r = fit_score(**{**FIT_ARGS, "company_size": "201-500"})
    assert next(f for f in r["factors"] if f["label"] == "Company size")["points"] == 15


def test_industry_and_location_misses_score_zero():
    r = fit_score(**{**FIT_ARGS, "industry": "Retail", "location": "Detroit, MI"})
    pts = {f["label"]: f["points"] for f in r["factors"]}
    assert pts["Industry"] == 0 and pts["Location"] == 0


def test_intent_target_role_pain_growth_and_sources():
    r = intent_score(job_title="Operations Coordinator", hiring_signal="Hiring now",
                     description="We track orders in spreadsheets. Fast-growing, new office.",
                     source_count=2, target_roles=["operations coordinator"])
    pts = {f["label"]: f["points"] for f in r["factors"]}
    assert pts == {"Hiring": 35, "Operational pain": 10, "Growth": 20, "Seen on several sources": 10}
    assert r["score"] == 75


def test_intent_with_no_evidence_is_low_not_middling():
    r = intent_score(job_title=None, hiring_signal=None, description=None, source_count=1, target_roles=[])
    assert r["score"] == 0


def test_hiring_off_target_role_gets_partial_credit():
    r = intent_score(job_title="Chef", hiring_signal="Hiring Chef", description="", source_count=1,
                     target_roles=["marketing coordinator"])
    assert next(f for f in r["factors"] if f["label"] == "Hiring")["points"] == 15


def test_blend_uses_agency_weights_and_skips_missing_parts():
    assert blend(DEFAULT_WEIGHTS, {"fit": 80, "intent": 40, "ai": 60, "engagement": None}) == 60
    assert blend({"fit": 100, "intent": 0, "ai": 0, "engagement": 0}, {"fit": 70, "intent": 10, "ai": 90}) == 70
    assert blend(DEFAULT_WEIGHTS, {"fit": None, "intent": None, "ai": None}) == 0


def test_weights_fall_back_per_key_and_reject_junk():
    w = normalize_weights({"fit": "50", "ai": -5, "intent": "lots"})
    assert w == {"fit": 50.0, "intent": 30.0, "ai": 0.0, "engagement": 15.0}


AGENCY = ppa.AgencyProfile(name="Harbor Growth Partners", services=("Paid Social",))
ARGS = dict(industry="Healthcare", hiring_signal="", job_title="", description="", location="")


def test_ai_judgment_comes_from_the_same_call(monkeypatch):
    monkeypatch.setattr(ppa, "_GROQ_API_KEY", "k")
    monkeypatch.setattr(ppa, "_call_groq", lambda _p: {
        "pain_points": ["a"], "recommended_service": "Paid Social", "outreach_angle": "x",
        "fit_score": 72, "fit_reason": "clinic hiring a marketer"})
    r = ppa.PainPointAnalyzer(AGENCY).analyze_with_judgment(**ARGS)
    assert (r["fit_score"], r["fit_reason"]) == (72, "clinic hiring a marketer")


def test_no_model_answer_means_no_ai_score(monkeypatch):
    monkeypatch.setattr(ppa, "_GROQ_API_KEY", "")
    r = ppa.PainPointAnalyzer(AGENCY).analyze_with_judgment(**ARGS)
    assert r["fit_score"] is None and r["pain_points"]


@pytest.mark.parametrize("raw,expected", [(140, 100), (-3, 0), ("61.6", 62), ("high", None), (None, None)])
def test_ai_score_is_clamped_or_dropped(raw, expected):
    m = ppa._PainPointResponse(pain_points=[], recommended_service="s", outreach_angle="a", fit_score=raw)
    assert m.fit_score == expected


def test_prompt_asks_for_the_judgment_in_the_agencys_name():
    p = ppa._build_prompt(agency=AGENCY, company_name="Acme", industry="", location="", hiring_signal="",
                          job_title="", description="", tech_stack=[], website_content="")
    assert "fit_score (integer)" in p and "Harbor Growth Partners is to win work" in p


def test_rounding_matches_the_backend_half_up():
    # 82.5: Python's round() would give 82 (banker's rounding); the backend's Math.round gives 83.
    assert blend({"fit": 40, "intent": 40, "ai": 0, "engagement": 0}, {"fit": 100, "intent": 65}) == 83

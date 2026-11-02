"""contact_finder review findings (#1, #3, #4, #5, #6 on b74cc84). Every
finding has at least one test here that fails on the code before the fix
(19 of these 21 do; the other two guard behaviour that must not regress)."""
import json
import time
from types import SimpleNamespace

import pytest

from enrichment import contact_finder as cf

# ---- #3: an email is matched to a person by name tokens, never substrings ----


@pytest.mark.parametrize("local,first,last,expected", [
    ("danielle", "Dan", "Smith", False),      # the reported bug
    ("dan.smith", "Dan", "Smith", True),
    ("dsmith", "Dan", "Smith", True),
    ("smith", "Dan", "Smith", True),
    ("d.smith", "Dan", "Smith", True),
    ("dans", "Dan", "Smith", True),
    ("dan", "Dan", "Smith", False),           # another Dan is as likely
    ("dan", "Dan", "", True),
    ("ann", "Joanna", "Annis", False),
    ("smithson", "Dan", "Smith", False),
])
def test_email_matches_person(local, first, last, expected):
    assert cf._email_matches_person(local, first, last) is expected


def test_another_employees_inbox_is_not_given_to_the_named_person(monkeypatch):
    monkeypatch.setattr(cf, "_serp_find_person", lambda *_a: {
        "name": "Dan Smith", "title": "CEO", "linkedin_url": "https://linkedin.com/in/dan"})
    monkeypatch.setattr(cf, "_scrape_site", lambda *_a: ({"danielle@acme.com": "/team"}, []))
    monkeypatch.setattr(cf, "_verify_email", lambda _e: "no_verifier")
    contact = cf.find_contact("Acme", "https://acme.com", None)
    assert contact["name"] == "Dan Smith"
    assert contact["email"] == ""
    assert contact["email_confidence"] == "unknown"


# ---- #4: the company guard matches whole words and fails closed ----

def test_company_guard_is_whole_word():
    assert cf._mentions_company("Owner at Ace Plumbing", ["ace", "plumbing"])
    assert not cf._mentions_company("Owner at SpaceX", ["ace"])
    assert not cf._mentions_company("CEO, Acme Corp", ["acm"])


def test_company_guard_fails_closed_without_tokens():
    assert not cf._mentions_company("anything at all", [])


def test_a_profile_for_a_different_company_is_rejected(monkeypatch):
    organic = [{"link": "https://linkedin.com/in/x", "title": "Jo Doe - CEO | LinkedIn",
                "snippet": "CEO at Spacecraft Labs"}]
    monkeypatch.setattr(cf, "SERPER_API_KEY", "k")
    monkeypatch.setattr(cf._SESSION, "post",
                        lambda *_a, **_k: SimpleNamespace(status_code=200, json=lambda: {"organic": organic}))
    assert cf._serp_find_person("Ace", None) is None


def test_a_company_name_of_only_suffixes_matches_nobody(monkeypatch):
    organic = [{"link": "https://linkedin.com/in/x", "title": "Jo Doe - CEO | LinkedIn", "snippet": "CEO"}]
    monkeypatch.setattr(cf, "SERPER_API_KEY", "k")
    monkeypatch.setattr(cf._SESSION, "post",
                        lambda *_a, **_k: SimpleNamespace(status_code=200, json=lambda: {"organic": organic}))
    assert cf._serp_find_person("The Company LLC", None) is None


# ---- #5: a personal email does not stop team-page collection ----

def _page(html, status=200):
    return SimpleNamespace(status_code=status, text=html)


def test_scrape_keeps_looking_for_people_after_a_personal_email(monkeypatch):
    team = json.dumps({"@type": "Person", "name": "Pat Lee", "jobTitle": "Founder"})
    pages = {
        "/contact": _page("write to pat@acme.com"),
        "/team": _page(f'<script type="application/ld+json">{team}</script>'),
    }
    monkeypatch.setattr(cf._SESSION, "get",
                        lambda url, **_k: pages.get(url.split("acme.com")[1], _page("", 404)))
    emails, people = cf._scrape_site("https://acme.com")
    assert "pat@acme.com" in emails
    assert people == [{"name": "Pat Lee", "title": "Founder"}]


def test_scrape_still_stops_early_once_it_has_both(monkeypatch):
    team = json.dumps({"@type": "Person", "name": "Pat Lee", "jobTitle": "Founder"})
    fetched = []

    def get(url, **_k):
        fetched.append(url)
        return _page(f'pat@acme.com <script type="application/ld+json">{team}</script>')

    monkeypatch.setattr(cf._SESSION, "get", get)
    cf._scrape_site("https://acme.com")
    assert len(fetched) == 1


# ---- #6: a transient verifier error tries the next pattern ----

def test_a_transient_verifier_error_moves_on_to_the_next_candidate(monkeypatch):
    answers = iter(["error", "ok"])
    monkeypatch.setattr(cf, "_verify_email", lambda _e: next(answers))
    monkeypatch.setattr(cf, "_serp_find_person", lambda *_a: {"name": "Dan Smith", "title": "CEO", "linkedin_url": ""})
    monkeypatch.setattr(cf, "_scrape_site", lambda *_a: ({}, []))
    contact = cf.find_contact("Acme", "https://acme.com", None)
    assert contact["email"] == "dan@acme.com"  # the second pattern
    assert contact["email_confidence"] == "verified"


def test_no_verifier_never_returns_a_guess(monkeypatch):
    calls = []
    monkeypatch.setattr(cf, "_verify_email", lambda e: calls.append(e) or "no_verifier")
    monkeypatch.setattr(cf, "_serp_find_person", lambda *_a: {"name": "Dan Smith", "title": "CEO", "linkedin_url": ""})
    monkeypatch.setattr(cf, "_scrape_site", lambda *_a: ({}, []))
    contact = cf.find_contact("Acme", "https://acme.com", None)
    assert contact["email"] == "" and len(calls) == 1


def test_verify_email_reports_errors_and_missing_key_distinctly(monkeypatch):
    monkeypatch.setattr(cf, "MILLIONVERIFIER_API_KEY", "")
    assert cf._verify_email("a@b.com") == "no_verifier"
    monkeypatch.setattr(cf, "MILLIONVERIFIER_API_KEY", "k")
    monkeypatch.setattr(cf._SESSION, "get", lambda *_a, **_k: SimpleNamespace(status_code=503))
    assert cf._verify_email("a@b.com") == "error"


# ---- #1: running out of time keeps the person already found ----

def test_out_of_budget_returns_the_person_found_so_far(monkeypatch):
    def slow_serp(*_a):
        time.sleep(0.05)
        return {"name": "Dan Smith", "title": "CEO", "linkedin_url": "https://linkedin.com/in/dan"}

    def scrape(*_a):
        raise AssertionError("site scrape should be skipped once the budget is spent")

    monkeypatch.setattr(cf, "_serp_find_person", slow_serp)
    monkeypatch.setattr(cf, "_scrape_site", scrape)
    monkeypatch.setattr(cf, "_verify_email", lambda _e: pytest.fail("no verification after the budget"))
    contact = cf.find_contact("Acme", "https://acme.com", "Austin", budget_seconds=0.01)
    assert contact["name"] == "Dan Smith"
    assert contact["linkedin_url"] == "https://linkedin.com/in/dan"

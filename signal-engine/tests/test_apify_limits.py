"""Every Apify run carries Apify-enforced ceilings, whatever the actor calls
its own limit, and the client does not stream actor logs into ours."""
from decimal import Decimal
from types import SimpleNamespace

from scrapers import apify_base
from scrapers.crunchbase import CrunchbaseScraper
from scrapers.job_boards import JobBoardScraper
from scrapers.local_business import LocalBusinessScraper


def _fake_client(monkeypatch, n_items=100):
    seen = {"call": None, "list": None}

    class _Client:
        def __init__(self, _token):
            pass

        def actor(self, _id):
            def call(**kw):
                seen["call"] = kw
                return SimpleNamespace(default_dataset_id="d", usage_total_usd=None)
            return SimpleNamespace(call=call)

        def dataset(self, _id):
            def list_items(**kw):
                seen["list"] = kw
                limit = kw.get("limit") or n_items
                return SimpleNamespace(items=[{}] * min(limit, n_items))
            return SimpleNamespace(list_items=list_items)

    monkeypatch.setattr(apify_base, "ApifyClient", _Client)
    return seen


class _Scraper(apify_base.ApifyBaseScraper):
    def scrape(self):
        return self._run_actor("some/actor", {"anything": 1}, max_items=7)


def test_every_run_is_capped_by_apify_and_silent(monkeypatch):
    seen = _fake_client(monkeypatch)
    items = _Scraper().scrape()
    assert seen["call"]["max_items"] == 7
    assert seen["call"]["max_total_charge_usd"] == apify_base.MAX_CHARGE_USD_PER_RUN
    assert seen["call"]["logger"] is None
    # Even an actor that over-produces only has `max_items` results read back.
    assert seen["list"]["limit"] == 7
    assert len(items) == 7


def test_the_charge_ceiling_is_small_by_default():
    assert apify_base.MAX_CHARGE_USD_PER_RUN <= Decimal("1.00")


def _capture(monkeypatch, scraper):
    calls = []
    monkeypatch.setattr(scraper, "_run_actor",
                        lambda actor, run_input, **kw: calls.append((run_input, kw["max_items"])) or [])
    scraper.scrape()
    return calls


def test_indeed_cap_matches_its_input(monkeypatch):
    calls = _capture(monkeypatch, JobBoardScraper(target_locations=["Austin"], target_roles=["a"]))
    assert [(c["maxItems"], m) for c, m in calls] == [(20, 20)]


def test_crunchbase_cap_matches_its_input(monkeypatch):
    calls = _capture(monkeypatch, CrunchbaseScraper(target_locations=["Austin"], target_industries=["dental"]))
    assert all(c["maxItems"] == m for c, m in calls)


def test_google_maps_cap_covers_all_its_queries(monkeypatch):
    s = LocalBusinessScraper(target_locations=["Austin"], target_industries=["dental", "legal"])
    calls = _capture(monkeypatch, s)
    (run_input, cap), = calls
    assert cap == run_input["maxCrawledPlacesPerSearch"] * len(run_input["searchStringsArray"])

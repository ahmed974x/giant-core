"""Truth Layer tests (ADR-021): 8 credibility cases plus the batch corroboration and the Butterfly gate."""

import sys
from pathlib import Path

import truth_layer as tl
from truth_layer import Item, score

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "causal"))


def test_high_trust_source_with_corroboration_is_verified():
    r = score(Item("e1", "https://www.reuters.com/world/middle-east/tanker-traffic-hormuz-2026-10-09/", tone=-1.0, num_sources=5))
    assert r["status"] == "verified" and r["score"] >= 0.9 and r["source_tier"] == "wire" and r["flags"] == []


def test_low_trust_source_stays_unverified_even_with_some_pickup():
    r = score(Item("e2", "https://www.rt.com/news/600000-strait-closure/", tone=-3.0, num_sources=2))
    assert r["status"] == "unverified" and "source:state_controlled" in r["flags"]


def test_single_source_event_is_held_back_even_from_a_good_outlet():
    good = score(Item("e3", "https://www.reuters.com/markets/x/", tone=-1.0, num_sources=1))
    unknown = score(Item("e4", "https://smallblog.example/x/", tone=-1.0, num_sources=1))
    assert good["status"] == "unverified" and "single_source" in good["flags"]
    assert unknown["score"] < good["score"] and "source:unknown" in unknown["flags"]


def test_multi_source_event_can_lift_an_unknown_outlet():
    r = score(Item("e5", "https://regional-news.example/port-delays/", tone=-1.0, num_sources=6))
    assert r["status"] == "verified" and r["sources"] == 6 and "single_source" not in r["flags"]


def test_propaganda_patterns_are_flagged_and_penalised():
    calm = score(Item("e6", "https://regional-news.example/strait-traffic-slows/", tone=-2.0, num_sources=3))
    loud = score(Item("e7", "https://regional-news.example/shocking-truth-about-the-traitors-closing-the-strait/",
                      title="EXPOSED: the cover-up they don't want you to know", tone=-7.5, num_sources=3))
    assert "propaganda_pattern" in loud["flags"] and "emotive_language" in loud["flags"]
    assert loud["status"] == "unverified" and loud["score"] < calm["score"] - 0.15


def test_verified_fact_from_an_official_primary_source():
    r = score(Item("e8", "https://www.usgs.gov/news/m66-earthquake-panama", tone=-0.5, num_sources=4))
    assert r["status"] == "verified" and r["source_tier"] == "official"
    gov = score(Item("e9", "https://www.mof.gov.kw/news/budget", tone=0.5, num_sources=4))
    assert gov["source_tier"] == "official"                               # any government domain counts as primary


def test_opinion_piece_is_flagged_and_not_used():
    r = score(Item("e10", "https://www.nytimes.com/2026/10/09/opinion/oil-shock-iran.html", tone=-4.0, num_sources=3))
    assert "opinion" in r["flags"] and r["status"] == "unverified"


def test_unclear_source_defaults_to_unknown_and_unverified():
    r = score(Item("e11", "http://192.0.2.4/item?id=1", tone=0.0, num_sources=None))
    assert r["source_tier"] == "unknown" and r["status"] == "unverified" and {"source:unknown", "single_source"} <= set(r["flags"])


def test_batch_corroboration_counts_other_domains_sharing_two_entities():
    items = [Item("a", "https://www.reuters.com/a"), Item("b", "https://www.bbc.com/b"), Item("c", "https://www.reuters.com/c"),
             Item("d", "https://lonely.example/d")]
    ents = {"a": {"strait of hormuz", "opec"}, "b": {"strait of hormuz", "opec", "iea"}, "c": {"strait of hormuz", "opec"},
            "d": {"strait of hormuz"}}
    tl.corroborate(items, ents)
    by = {i.id: i for i in items}
    assert by["a"].corroborating_domains == {"bbc.com"}                   # same-domain sibling 'c' does not count
    assert by["d"].corroborating_domains == set()                          # one shared entity is not enough


def test_butterfly_ignores_unverified_conflict_reports(monkeypatch):
    import butterfly_engine as be
    events = {"events": [
        {"id": 1, "category": "conflict", "lat": 26.6, "lon": 56.3, "place": "Hormuz", "tone": -6, "sources": 1,
         "url": "https://smallblog.example/shocking-attack/"},
        {"id": 2, "category": "conflict", "lat": 26.5, "lon": 56.2, "place": "Hormuz", "tone": -2, "sources": 5,
         "url": "https://www.reuters.com/world/incident-near-hormuz/"},
    ]}
    monkeypatch.setattr(be, "_get_json", lambda url, timeout=25: {"hazards": []} if "hazards" in url else events)
    live = be.live_signals(26.57, 56.25)
    assert [h["url"] for h in live["conflict"]] == ["https://www.reuters.com/world/incident-near-hormuz/"]
    assert len(live["unverified"]) == 1
    r = be.trace({"type": "ship_deviation"}, live=live)
    notes = [l["note"] for ch in r["chains"] for l in ch["links"] if l["cause"] == "conflict_event"]
    assert notes and "1 unverified report(s) ignored" in notes[0]

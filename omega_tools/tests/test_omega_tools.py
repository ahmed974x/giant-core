"""Tests for the OMEGA local tools (ADR-129). Guards run everywhere; tool runs skip when the library is absent."""

import importlib.util
import json
import random
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from omega_tools import docs, flags, kg, rag, risk, space
from omega_tools.http_api import Handler

GRAPH = {
    "format": "omega-knowledge-graph-v1",
    "nodes": [{"id": "d:sea", "kind": "domain", "en": "Seas"}, {"id": "t:mp", "kind": "tool", "en": "MovingPandas", "status": "idea"}],
    "edges": [{"a": "d:sea", "b": "t:mp", "kind": "uses", "w": 1}],
}


def fix(line):  # test fixture: give a TLE line its checksum digit
    b = line[:68]
    return b + str((sum(int(c) for c in b if c.isdigit()) + b.count("-")) % 10)


# A made-up ISS-like element set for the tests (not a real CelesTrak record).
L1 = fix("1 25544U 98067A   26297.50000000  .00016717  00000-0  10270-3 0  900x")
L2 = fix("2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560000 1234x")
has = lambda m: importlib.util.find_spec(m) is not None  # noqa: E731


def test_everything_is_off_by_default(monkeypatch):
    monkeypatch.delenv("OMEGA_TOOLS", raising=False)
    assert flags.enabled() == set()
    with pytest.raises(flags.ToolOff):
        kg.kg_query(GRAPH, "SELECT * WHERE { ?s ?p ?o }")
    monkeypatch.setenv("OMEGA_TOOLS", "oxigraph, nonsense ,SKYFIELD")
    assert flags.enabled() == {"oxigraph", "skyfield"}


def test_sparql_guard_refuses_writes_service_and_other_forms():
    kg.check_query('PREFIX p: <urn:omega:p:> SELECT ?n WHERE { ?n p:en "DELETE me" } # LOAD in a comment')
    kg.check_query("ASK { ?a ?b ?c }")
    for q in [
        "SELECT * WHERE { SERVICE <http://x.example> { ?s ?p ?o } }",
        "INSERT DATA { <a:b> <a:c> <a:d> }",
        "LOAD <http://x.example/data.ttl>",
        "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
        "DESCRIBE <a:b>",
        "",
        "x" * 5000,
    ]:
        with pytest.raises(ValueError):
            kg.check_query(q)
    with pytest.raises(ValueError):
        kg.check_graph({"format": "other", "nodes": [], "edges": []})


@pytest.mark.skipif(not has("pyoxigraph"), reason="pyoxigraph not installed here")
def test_oxigraph_runs_read_queries_on_the_export(monkeypatch):
    monkeypatch.setenv("OMEGA_TOOLS", "oxigraph")
    r = kg.kg_query(GRAPH, "PREFIX p: <urn:omega:p:> SELECT ?n ?k WHERE { ?n p:kind ?k } ORDER BY ?k")
    assert [x["k"] for x in r["rows"]] == ["domain", "tool"] and "[INFERENCE]" in r["label"]
    assert kg.kg_query(GRAPH, "ASK { ?a <urn:omega:p:uses> ?b }")["ask"] is True


def test_tle_checks():
    assert space.tle_checksum(L1) and space.tle_checksum(L2)
    with pytest.raises(ValueError):
        space.check_tle(L1, L2[:-1] + str((int(L2[-1]) + 1) % 10))
    with pytest.raises(ValueError):
        space.check_tle(L2, L1)


@pytest.mark.skipif(not has("skyfield"), reason="skyfield not installed here")
def test_skyfield_sgp4_track_stays_on_the_orbit(monkeypatch):
    monkeypatch.setenv("OMEGA_TOOLS", "skyfield")
    r = space.sat_track(L1, L2, "test", "2026-10-24T12:00:00Z", 30, 60)
    assert len(r["points"]) == 31 and r["model"].startswith("SGP4")
    assert all(abs(p["lat"]) <= 51.7 and 380 < p["alt_km"] < 460 for p in r["points"])
    with pytest.raises(ValueError):
        space.sat_track(L1, L2, minutes=1440, step_s=10)


def test_price_checks():
    good = [100 + i for i in range(30)]
    with pytest.raises(ValueError):
        risk.check_prices({"BTC": good})
    with pytest.raises(ValueError):
        risk.check_prices({"BTC": good, "ETH": good[:-1]})
    with pytest.raises(ValueError):
        risk.check_prices({"BTC": good, "ETH": [*good[:-1], -1]})


@pytest.mark.skipif(not has("pypfopt"), reason="PyPortfolioOpt not installed here")
def test_min_volatility_is_labelled_and_sums_to_one(monkeypatch):
    monkeypatch.setenv("OMEGA_TOOLS", "portfolio")
    rnd = random.Random(1)

    def walk(s):
        p = [100.0]
        for _ in range(99):
            p.append(p[-1] * (1 + rnd.gauss(0, s)))
        return p

    r = risk.min_volatility({"BTC": walk(0.03), "ETH": walk(0.04), "PAXG": walk(0.01)})
    assert abs(sum(r["weights"].values()) - 1) < 1e-4 and max(r["weights"].values()) <= 0.6 + 1e-9
    assert r["weights"]["PAXG"] >= r["weights"]["ETH"] and "[INFERENCE - Quant Model]" in r["label"]


def test_docling_reads_only_inside_the_inbox(tmp_path, monkeypatch):
    monkeypatch.setenv("OMEGA_INBOX", str(tmp_path / "inbox"))
    (tmp_path / "inbox").mkdir()
    (tmp_path / "inbox" / "a.pdf").write_bytes(b"%PDF-1.4")
    (tmp_path / "secret.pdf").write_bytes(b"%PDF-1.4")
    assert docs.check_file("a.pdf").name == "a.pdf"
    for bad in ["../secret.pdf", "https://x.example/a.pdf", "a.exe", "missing.pdf", ""]:
        with pytest.raises(ValueError):
            docs.check_file(bad)


def test_rag_settings_stay_on_this_machine(monkeypatch):
    monkeypatch.setenv("OLLAMA_HOST_URL", "http://127.0.0.1:11434")
    assert rag.settings()["host"] == "http://127.0.0.1:11434"
    for url in ["http://192.168.8.3:11434", "https://127.0.0.1:11434", "http://ollama.example:11434"]:
        monkeypatch.setenv("OLLAMA_HOST_URL", url)
        with pytest.raises(ValueError):
            rag.settings()
    monkeypatch.setenv("OLLAMA_HOST_URL", "http://localhost:11434")
    monkeypatch.setenv("OMEGA_RAG_MODEL", "glm-5.2:cloud")
    with pytest.raises(ValueError):
        rag.settings()


@pytest.fixture
def api(monkeypatch):
    monkeypatch.delenv("OMEGA_TOOLS", raising=False)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def call(url, body=None, headers=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers or {})  # noqa: S310 - loopback test server
    try:
        with urllib.request.urlopen(req, timeout=10) as r:  # noqa: S310 - loopback test server
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_api_health_off_tools_and_web_pages(api):
    code, h = call(api + "/api/health")
    assert code == 200 and h["paper_only"] and not any(t["on"] for t in h["tools"].values())
    assert call(api + "/api/kg_query", {"graph": GRAPH, "query": "ASK { ?s ?p ?o }"})[0] == 403
    assert call(api + "/api/kg_query", {"graph": GRAPH, "query": "ASK {}"}, {"Origin": "https://evil.example"})[0] == 403
    assert call(api + "/api/nope", {})[0] == 404

"""geo-api tests: bilingual localization + demo endpoints, no DB. `python -m pytest services/geo-api`."""

import os

os.environ["OMEGA_GEO_DEMO"] = "1"

import app as geo
from fastapi.testclient import TestClient

client = TestClient(geo.app)


def test_pick_lang_prefers_query_then_header():
    assert geo.pick_lang("ar", "en-US,en;q=0.9") == "ar"
    assert geo.pick_lang(None, "ar-SA,ar;q=0.9,en;q=0.8") == "ar"
    assert geo.pick_lang(None, "fr-FR") == "en"
    assert geo.pick_lang("de", None) == "en"               # unsupported falls back


def test_nodes_localized_both_ways():
    en = client.get("/geo/nodes?lang=en").json()
    assert en["source"] == "demo" and len(en["nodes"]) == 6
    hormuz_en = next(n for n in en["nodes"] if n["slug"] == "hormuz")
    assert hormuz_en["name"] == "Strait of Hormuz" and hormuz_en["lang"] == "en"

    ar = client.get("/geo/nodes", headers={"Accept-Language": "ar-SA,ar;q=0.9"}).json()
    hormuz_ar = next(n for n in ar["nodes"] if n["slug"] == "hormuz")
    assert hormuz_ar["name"] == "مضيق هرمز" and ar["lang"] == "ar"
    assert hormuz_ar["name_i18n"]["en"] == "Strait of Hormuz"   # both kept for the client


def test_single_node_and_404():
    assert client.get("/geo/nodes/suez?lang=ar").json()["name"] == "قناة السويس"
    assert client.get("/geo/nodes/nowhere").status_code == 404


def test_search_matches_either_language():
    assert [n["slug"] for n in client.get("/geo/nodes/search?q=هرمز").json()["nodes"]] == ["hormuz"]
    assert [n["slug"] for n in client.get("/geo/nodes/search?q=canal").json()["nodes"]] == ["panama", "suez"]
    assert client.get("/geo/nodes/search?q=هرمز&lang=en").json()["nodes"][0]["name"] == "Strait of Hormuz"


def test_near_sorts_by_distance():
    # near Dubai: Jebel Ali and Hormuz should be the closest, in that order
    r = client.get("/geo/nodes/near?lon=55.27&lat=25.2&km=600").json()
    slugs = [n["slug"] for n in r["nodes"]]
    assert slugs[:2] == ["jebel-ali", "hormuz"]
    assert r["nodes"][0]["km"] < r["nodes"][1]["km"]
    assert all(n["slug"] != "suez" for n in r["nodes"])        # Suez is > 600 km away


def test_healthz():
    assert client.get("/geo/healthz").json() == {"status": "ok", "source": "demo"}

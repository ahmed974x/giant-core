"""OMEGA PRIME geo-api: a bilingual (Arabic/English) FastAPI layer over the PostGIS logistics nodes.

Every endpoint localises its response from the `lang` query param or the `Accept-Language` header
(ar / en, English default), so one API serves both the RTL and LTR frontends. When the geo database
is unreachable (or OMEGA_GEO_DEMO=1) it serves the same six seeded nodes from memory, so the API —
and its tests — run without Docker.

    GET /geo/nodes?lang=ar              localized list
    GET /geo/nodes/{slug}?lang=en       one node
    GET /geo/nodes/search?q=هرمز        bilingual search
    GET /geo/nodes/near?lon=&lat=&km=   nearest nodes (PostGIS ST_DWithin; haversine in demo)
    GET /geo/healthz
"""

from __future__ import annotations

import math
import os

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # the demo path does not need the driver
    psycopg = None

DSN = os.environ.get("OMEGA_GEO_DSN", "postgresql://omega_geo@geo:5432/omega_geo")
DEMO = os.environ.get("OMEGA_GEO_DEMO") == "1"
LANGS = ("en", "ar")

app = FastAPI(title="OMEGA PRIME geo-api", version="1.0.0")

# The same six public choke-points/ports the SQL seeds, for the demo path.
SEED = [
    {"slug": "hormuz", "node_type": "strait", "name_i18n": {"en": "Strait of Hormuz", "ar": "مضيق هرمز"},
     "description_i18n": {"en": "Main sea route for Gulf oil exports.", "ar": "الممر البحري الرئيسي لصادرات نفط الخليج."},
     "lon": 56.25, "lat": 26.57, "status": "operational"},
    {"slug": "suez", "node_type": "canal", "name_i18n": {"en": "Suez Canal", "ar": "قناة السويس"},
     "description_i18n": {"en": "Links the Mediterranean and the Red Sea.", "ar": "يربط البحر المتوسط بالبحر الأحمر."},
     "lon": 32.35, "lat": 30.60, "status": "operational"},
    {"slug": "bab-el-mandeb", "node_type": "strait", "name_i18n": {"en": "Bab-el-Mandeb", "ar": "باب المندب"},
     "description_i18n": {"en": "Gateway between the Red Sea and the Gulf of Aden.", "ar": "البوابة بين البحر الأحمر وخليج عدن."},
     "lon": 43.33, "lat": 12.58, "status": "operational"},
    {"slug": "malacca", "node_type": "strait", "name_i18n": {"en": "Strait of Malacca", "ar": "مضيق ملقا"},
     "description_i18n": {"en": "Busiest shipping lane between the Indian and Pacific oceans.", "ar": "أكثر الممرات ازدحاماً بين المحيطين الهندي والهادئ."},
     "lon": 100.40, "lat": 2.50, "status": "operational"},
    {"slug": "panama", "node_type": "canal", "name_i18n": {"en": "Panama Canal", "ar": "قناة بنما"},
     "description_i18n": {"en": "Links the Atlantic and Pacific oceans.", "ar": "يربط المحيطين الأطلسي والهادئ."},
     "lon": -79.68, "lat": 9.08, "status": "operational"},
    {"slug": "jebel-ali", "node_type": "port", "name_i18n": {"en": "Port of Jebel Ali", "ar": "ميناء جبل علي"},
     "description_i18n": {"en": "Largest container port in the Middle East.", "ar": "أكبر ميناء حاويات في الشرق الأوسط."},
     "lon": 55.03, "lat": 24.98, "status": "operational"},
]


def pick_lang(lang: str | None, accept: str | None) -> str:
    """Resolve the response language: explicit ?lang wins, then Accept-Language, else English."""
    if lang in LANGS:
        return lang
    for part in (accept or "").lower().split(","):
        code = part.split(";")[0].strip()[:2]
        if code in LANGS:
            return code
    return "en"


def localize(row: dict, lang: str) -> dict:
    """Flatten a node to one language, keeping both raw maps for clients that want them."""
    name = row["name_i18n"]
    desc = row.get("description_i18n") or {}
    return {
        "slug": row["slug"], "node_type": row["node_type"], "status": row.get("status", "operational"),
        "name": name.get(lang) or name.get("en"),
        "description": desc.get(lang) or desc.get("en") or "",
        "lon": row["lon"], "lat": row["lat"],
        "name_i18n": name, "lang": lang,
    }


def live() -> bool:
    if DEMO or psycopg is None:
        return False
    try:
        with psycopg.connect(DSN, connect_timeout=3) as con:
            con.execute("SELECT 1")
        return True
    except Exception:
        return False


def query(sql: str, params: tuple = ()) -> list[dict]:
    with psycopg.connect(DSN, connect_timeout=5, row_factory=dict_row) as con:
        return con.execute(sql, params).fetchall()


BASE_SELECT = ("SELECT slug, node_type, status, name_i18n, description_i18n, "
               "ST_X(coordinates) AS lon, ST_Y(coordinates) AS lat FROM logistics_nodes")


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@app.get("/geo/healthz")
def healthz():
    return {"status": "ok", "source": "live" if live() else "demo"}


@app.get("/geo/nodes")
def nodes(lang: str | None = Query(None), accept_language: str | None = Header(None)):
    lg = pick_lang(lang, accept_language)
    rows = query(f"{BASE_SELECT} ORDER BY slug") if live() else SEED
    return JSONResponse({"source": "live" if live() else "demo", "lang": lg,
                         "nodes": [localize(r, lg) for r in rows]})


@app.get("/geo/nodes/search")
def search(q: str = Query(..., min_length=1, max_length=80), lang: str | None = Query(None),
           accept_language: str | None = Header(None)):
    lg = pick_lang(lang, accept_language)
    if live():
        rows = query(
            f"{BASE_SELECT} WHERE to_tsvector('simple', coalesce(name_i18n->>'en','') || ' ' || "
            "coalesce(name_i18n->>'ar','') || ' ' || coalesce(description_i18n->>'en','') || ' ' || "
            "coalesce(description_i18n->>'ar','')) @@ plainto_tsquery('simple', %s) ORDER BY slug", (q,))
    else:
        ql = q.lower()
        rows = sorted((r for r in SEED
                       if any(ql in str(v).lower() for v in (*r["name_i18n"].values(), *r["description_i18n"].values()))),
                      key=lambda r: r["slug"])
    return {"source": "live" if live() else "demo", "lang": lg, "query": q, "nodes": [localize(r, lg) for r in rows]}


@app.get("/geo/nodes/near")
def near(lon: float = Query(..., ge=-180, le=180), lat: float = Query(..., ge=-90, le=90),
         km: float = Query(500, gt=0, le=20000), lang: str | None = Query(None),
         accept_language: str | None = Header(None)):
    lg = pick_lang(lang, accept_language)
    if live():
        rows = query(
            "SELECT slug, node_type, status, name_i18n, description_i18n, ST_X(coordinates) AS lon, ST_Y(coordinates) AS lat, "
            "ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography)/1000 AS km "
            "FROM logistics_nodes "
            "WHERE ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography, %s*1000) "
            "ORDER BY km", (lon, lat, lon, lat, km))
    else:
        rows = []
        for r in SEED:
            d = haversine_km(lon, lat, r["lon"], r["lat"])
            if d <= km:
                rows.append({**r, "km": round(d, 1)})
        rows.sort(key=lambda r: r["km"])
    return {"source": "live" if live() else "demo", "lang": lg, "center": {"lon": lon, "lat": lat}, "radius_km": km,
            "nodes": [{**localize(r, lg), "km": round(r.get("km", 0), 1)} for r in rows]}


@app.get("/geo/nodes/{slug}")
def node(slug: str, lang: str | None = Query(None), accept_language: str | None = Header(None)):
    lg = pick_lang(lang, accept_language)
    rows = query(f"{BASE_SELECT} WHERE slug = %s", (slug,)) if live() else [r for r in SEED if r["slug"] == slug]
    if not rows:
        raise HTTPException(status_code=404, detail="unknown node")
    return localize(rows[0], lg)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8094)

#!/usr/bin/env python3
"""GDELT historical ingest service for the Time Machine engine.

This module fetches historical events from GDELT and stores them in a PostgreSQL/
TimescaleDB table named ``gdelt_events``. It exposes both a fetch-and-store
entry point and a read API for simulation agents.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

import requests

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None


DEFAULT_GDELT_API_URL = "https://api.gdeltproject.org/api/v2/events/search"
DEFAULT_QUERY = ""  # broad dataset query


def get_db_connection():
    """Resolve the PostgreSQL connection using environment variables."""
    if psycopg is None:
        raise RuntimeError(
            "psycopg is required for PostgreSQL ingestion. Install it with 'pip install psycopg[binary]'"
        )

    dsn = (
        os.getenv("DATABASE_URL")
        or os.getenv("POSTGRES_DSN")
        or (
            "host={host} port={port} dbname={dbname} user={user} password={password}"
            .format(
                host=os.getenv("POSTGRES_HOST", "localhost"),
                port=os.getenv("POSTGRES_PORT", "5432"),
                dbname=os.getenv("POSTGRES_DB", "omega_prime"),
                user=os.getenv("POSTGRES_USER", "postgres"),
                password=os.getenv("POSTGRES_PASSWORD", "postgres"),
            )
        )
    )
    return psycopg.connect(dsn)


def ensure_schema() -> None:
    """Create the TimescaleDB-compatible table used to store GDELT events."""
    create_sql = """
    CREATE TABLE IF NOT EXISTS gdelt_events (
        id BIGSERIAL PRIMARY KEY,
        event_id TEXT UNIQUE,
        event_date TIMESTAMPTZ,
        source_country TEXT,
        event_root_code TEXT,
        event_root_name TEXT,
        event_code TEXT,
        event_name TEXT,
        actor1_name TEXT,
        actor1_country_code TEXT,
        actor1_type TEXT,
        actor2_name TEXT,
        actor2_country_code TEXT,
        actor2_type TEXT,
        is_root_event BOOLEAN,
        quad_class INTEGER,
        goldstein_scale DOUBLE PRECISION,
        num_mentions INTEGER,
        num_sources INTEGER,
        num_articles INTEGER,
        avg_tone DOUBLE PRECISION,
        url TEXT,
        title TEXT,
        theme TEXT,
        raw JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(create_sql)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_gdelt_events_event_date ON gdelt_events (event_date DESC);"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_gdelt_events_theme ON gdelt_events (theme);"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_gdelt_events_root_code ON gdelt_events (event_root_code);"
            )
            conn.commit()


def _format_datetime(value: datetime | str) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y%m%d%H%M%S")
    return value


def fetch_gdelt_events(
    start_date: str | datetime,
    end_date: str | datetime,
    query: str = DEFAULT_QUERY,
    max_records: int = 250,
) -> List[Dict[str, Any]]:
    """Fetch GDELT event data from the public API for a given date range."""
    params = {
        "query": query,
        "mode": "Search",
        "format": "JSON",
        "startdatetime": _format_datetime(start_date),
        "enddatetime": _format_datetime(end_date),
        "maxrecords": max_records,
        "sort": "Date:desc",
    }

    response = requests.get(DEFAULT_GDELT_API_URL, params=params, timeout=60)
    response.raise_for_status()

    payload = response.json()
    rows = payload.get("events") or payload.get("data") or payload.get("result", {}).get("events")
    if not rows:
        return []

    normalized: List[Dict[str, Any]] = []
    for raw in rows:
        event = {
            "event_id": raw.get("eventId") or raw.get("globaleventid") or raw.get("id"),
            "event_date": raw.get("eventDate") or raw.get("day") or raw.get("Date"),
            "source_country": raw.get("sourceCountry") or raw.get("SOURCECOUNTRY"),
            "event_root_code": raw.get("eventRootCode") or raw.get("EventRootCode"),
            "event_root_name": raw.get("eventRootName") or raw.get("EventRootName"),
            "event_code": raw.get("eventCode") or raw.get("EventCode"),
            "event_name": raw.get("eventName") or raw.get("EventName"),
            "actor1_name": raw.get("actor1Name") or raw.get("Actor1Name"),
            "actor1_country_code": raw.get("actor1CountryCode") or raw.get("Actor1CountryCode"),
            "actor1_type": raw.get("actor1Type") or raw.get("Actor1Type"),
            "actor2_name": raw.get("actor2Name") or raw.get("Actor2Name"),
            "actor2_country_code": raw.get("actor2CountryCode") or raw.get("Actor2CountryCode"),
            "actor2_type": raw.get("actor2Type") or raw.get("Actor2Type"),
            "is_root_event": bool(raw.get("isRootEvent") or raw.get("IsRootEvent")),
            "quad_class": raw.get("quadClass") or raw.get("QuadClass"),
            "goldstein_scale": raw.get("goldsteinScale") or raw.get("GoldsteinScale"),
            "num_mentions": raw.get("numMentions") or raw.get("NumMentions"),
            "num_sources": raw.get("numSources") or raw.get("NumSources"),
            "num_articles": raw.get("numArticles") or raw.get("NumArticles"),
            "avg_tone": raw.get("avgTone") or raw.get("AvgTone"),
            "url": raw.get("url") or raw.get("URL"),
            "title": raw.get("title") or raw.get("Title"),
            "theme": query or "historical_event",
            "raw": raw,
        }
        normalized.append(event)
    return normalized


def _coerce_event_date(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value)
    for fmt in (
        "%Y%m%d%H%M%S",
        "%Y%m%d",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def store_events(events: Iterable[Dict[str, Any]]) -> int:
    """Persist events into the gdelt_events table."""
    ensure_schema()
    inserted = 0
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            for event in events:
                if not event.get("event_id"):
                    continue
                event_date = _coerce_event_date(event.get("event_date"))
                cur.execute(
                    """
                    INSERT INTO gdelt_events (
                        event_id,
                        event_date,
                        source_country,
                        event_root_code,
                        event_root_name,
                        event_code,
                        event_name,
                        actor1_name,
                        actor1_country_code,
                        actor1_type,
                        actor2_name,
                        actor2_country_code,
                        actor2_type,
                        is_root_event,
                        quad_class,
                        goldstein_scale,
                        num_mentions,
                        num_sources,
                        num_articles,
                        avg_tone,
                        url,
                        title,
                        theme,
                        raw
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (event_id) DO UPDATE SET
                        event_date=EXCLUDED.event_date,
                        source_country=EXCLUDED.source_country,
                        event_root_code=EXCLUDED.event_root_code,
                        event_root_name=EXCLUDED.event_root_name,
                        event_code=EXCLUDED.event_code,
                        event_name=EXCLUDED.event_name,
                        actor1_name=EXCLUDED.actor1_name,
                        actor1_country_code=EXCLUDED.actor1_country_code,
                        actor1_type=EXCLUDED.actor1_type,
                        actor2_name=EXCLUDED.actor2_name,
                        actor2_country_code=EXCLUDED.actor2_country_code,
                        actor2_type=EXCLUDED.actor2_type,
                        is_root_event=EXCLUDED.is_root_event,
                        quad_class=EXCLUDED.quad_class,
                        goldstein_scale=EXCLUDED.goldstein_scale,
                        num_mentions=EXCLUDED.num_mentions,
                        num_sources=EXCLUDED.num_sources,
                        num_articles=EXCLUDED.num_articles,
                        avg_tone=EXCLUDED.avg_tone,
                        url=EXCLUDED.url,
                        title=EXCLUDED.title,
                        theme=EXCLUDED.theme,
                        raw=EXCLUDED.raw
                    """,
                    (
                        event.get("event_id"),
                        event_date,
                        event.get("source_country"),
                        event.get("event_root_code"),
                        event.get("event_root_name"),
                        event.get("event_code"),
                        event.get("event_name"),
                        event.get("actor1_name"),
                        event.get("actor1_country_code"),
                        event.get("actor1_type"),
                        event.get("actor2_name"),
                        event.get("actor2_country_code"),
                        event.get("actor2_type"),
                        bool(event.get("is_root_event")),
                        event.get("quad_class"),
                        event.get("goldstein_scale"),
                        event.get("num_mentions"),
                        event.get("num_sources"),
                        event.get("num_articles"),
                        event.get("avg_tone"),
                        event.get("url"),
                        event.get("title"),
                        event.get("theme"),
                        json.dumps(event.get("raw") or {}),
                    ),
                )
                inserted += 1
            conn.commit()
    return inserted


def query_events_by_theme(
    theme: str,
    start_date: str | datetime,
    end_date: str | datetime,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Query the stored event history for a specific scenario/theme."""
    if isinstance(start_date, datetime):
        start_date = start_date.strftime("%Y-%m-%d")
    if isinstance(end_date, datetime):
        end_date = end_date.strftime("%Y-%m-%d")

    query_sql = """
        SELECT event_id, event_date, source_country, event_root_code, event_root_name,
               event_code, event_name, actor1_name, actor1_country_code,
               actor1_type, actor2_name, actor2_country_code, actor2_type,
               is_root_event, quad_class, goldstein_scale, num_mentions,
               num_sources, num_articles, avg_tone, url, title, theme, raw
        FROM gdelt_events
        WHERE theme ILIKE %s
          AND event_date >= %s::date
          AND event_date <= %s::date
        ORDER BY event_date DESC
        LIMIT %s
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query_sql, (f"%{theme}%", start_date, end_date, limit))
            rows = cur.fetchall()
            columns = [
                "event_id",
                "event_date",
                "source_country",
                "event_root_code",
                "event_root_name",
                "event_code",
                "event_name",
                "actor1_name",
                "actor1_country_code",
                "actor1_type",
                "actor2_name",
                "actor2_country_code",
                "actor2_type",
                "is_root_event",
                "quad_class",
                "goldstein_scale",
                "num_mentions",
                "num_sources",
                "num_articles",
                "avg_tone",
                "url",
                "title",
                "theme",
                "raw",
            ]
            return [dict(zip(columns, row)) for row in rows]


def ingest_scenario_theme(
    theme: str,
    start_date: str | datetime,
    end_date: str | datetime,
    max_records: int = 250,
) -> int:
    """Convenience wrapper: fetch, store, and return inserted rows."""
    events = fetch_gdelt_events(start_date=start_date, end_date=end_date, query=theme, max_records=max_records)
    return store_events(events)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Fetch and ingest GDELT historical event data.")
    parser.add_argument("--theme", default="suez canal blockage", help="Search theme or keyword.")
    parser.add_argument("--start-date", default=(datetime.utcnow() - timedelta(days=365)).strftime("%Y%m%d%H%M%S"))
    parser.add_argument("--end-date", default=datetime.utcnow().strftime("%Y%m%d%H%M%S"))
    parser.add_argument("--max-records", type=int, default=250)
    args = parser.parse_args()

    count = ingest_scenario_theme(
        theme=args.theme,
        start_date=args.start_date,
        end_date=args.end_date,
        max_records=args.max_records,
    )
    print(f"Ingested {count} GDELT event records for theme: {args.theme}")

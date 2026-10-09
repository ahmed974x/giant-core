"""AIS producers for the speed layer: the live aisstream.io WebSocket, and a mock replay of simulate_ais.

Both push Arrow batches into the `omega:ais` stream (bus.py). aisstream.io is a free public AIS relay:
positions ships broadcast themselves. A key goes in AISSTREAM_API_KEY; without one, use replay_mock().
"""

from __future__ import annotations

import asyncio
import json
import os
import time

import bus as busmod
import simulate_ais

STREAM = "omega:ais"
AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
# Default watch boxes: the Gulf & Hormuz, the Red Sea & Suez, Malacca ([[lat_min, lon_min], [lat_max, lon_max]])
BOXES = [[[22.0, 50.0], [30.0, 58.5]], [[11.0, 32.0], [31.0, 44.5]], [[-1.0, 95.0], [7.0, 105.0]]]


def parse_aisstream(msg: dict) -> dict | None:
    """One aisstream.io PositionReport → a normalized row; anything else → None."""
    if msg.get("MessageType") != "PositionReport":
        return None
    meta, pr = msg.get("MetaData", {}), msg.get("Message", {}).get("PositionReport", {})
    lat, lon = pr.get("Latitude", meta.get("latitude")), pr.get("Longitude", meta.get("longitude"))
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    ts = str(meta.get("time_utc", "")).replace(" +0000 UTC", "Z").replace(" ", "T", 1)
    return {"mmsi": int(meta.get("MMSI") or pr.get("UserID")), "ts": ts[:19] + "Z" if ts else None,
            "lon": float(lon), "lat": float(lat), "sog": pr.get("Sog"), "cog": pr.get("Cog")}


async def _flush(bus, rows: list[dict]) -> None:
    if rows:
        await bus.xadd(STREAM, {"arrow": busmod.encode_batch(rows), "n": str(len(rows)), "t0": str(time.time_ns())})


async def stream_aisstream(bus, api_key: str, boxes=BOXES, batch: int = 200, flush_ms: int = 250,
                           stop: asyncio.Event | None = None) -> None:
    """Live public AIS → stream, batching up to `batch` rows or `flush_ms`, reconnecting with backoff."""
    import websockets
    backoff = 1
    while not (stop and stop.is_set()):
        try:
            async with websockets.connect(AISSTREAM_URL, ping_interval=20, max_size=2**20) as ws:
                await ws.send(json.dumps({"APIKey": api_key, "BoundingBoxes": boxes, "FilterMessageTypes": ["PositionReport"]}))
                backoff, rows, last = 1, [], time.monotonic()
                async for raw in ws:
                    row = parse_aisstream(json.loads(raw))
                    if row:
                        rows.append(row)
                    if len(rows) >= batch or (time.monotonic() - last) * 1000 >= flush_ms:
                        await _flush(bus, rows)
                        rows, last = [], time.monotonic()
                    if stop and stop.is_set():
                        break
        except (TimeoutError, OSError, Exception):   # network drops: reconnect, never crash the loop
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def replay_mock(bus, batch: int = 200, pace_ms: float = 0, seed: int = 42, ships: int = 30,
                      hours: int = 24, scenarios: bool = True) -> dict:
    """Push a deterministic simulation into the stream in event-time order. pace_ms=0 means as fast as possible."""
    sim = simulate_ais.simulate(ships=ships, hours=hours, seed=seed, scenarios=scenarios)
    rows = sorted(sim["positions"], key=lambda p: p["ts"])
    for i in range(0, len(rows), batch):
        await _flush(bus, rows[i:i + batch])
        if pace_ms:
            await asyncio.sleep(pace_ms / 1000)
    return {"rows": len(rows), "batches": (len(rows) + batch - 1) // batch, "scenarios": sim["scenarios"]}


async def produce(bus, stop: asyncio.Event | None = None) -> None:
    """Live feed when a key is configured, otherwise a paced mock replay."""
    key = os.environ.get("AISSTREAM_API_KEY", "")
    if key:
        await stream_aisstream(bus, key, stop=stop)
    else:
        await replay_mock(bus, pace_ms=50)

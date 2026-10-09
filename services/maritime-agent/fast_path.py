"""Fast path: lightweight, sub-second rules over a sliding event-time window (Polars + DuckDB).

Every Arrow batch from the stream lands in a Polars frame (zero-copy from Arrow). On each batch:
  - ais_gap      : a vessel reappears after >= gap_s of silence (checked against its last-seen state, so
                   gaps longer than the window are still caught), "high" when it also jumped far
  - ais_silent   : a vessel has said nothing for >= gap_s as of the newest event time (live dark period)
  - vessel_stopped: in the window, a vessel stayed within a few km at < 1 kn for >= stop_s
  - speed_jump   : consecutive pings differ by >= jump_kn (abrupt manoeuvre or bad data)
  - port_congestion: DuckDB counts slow vessels near each port inside the window vs. its baseline
Each alert is emitted once per (type, vessel/port) until it clears, with the event time that caused it.
"""

from __future__ import annotations

import time

import duckdb
import polars as pl
import pyarrow as pa

EMPTY = pl.DataFrame(schema={"mmsi": pl.Int64, "t": pl.Int64, "lon": pl.Float64, "lat": pl.Float64, "sog": pl.Float64})


def _hav_km(lon1, lat1, lon2, lat2):
    """Haversine as a Polars expression (inputs are expressions in degrees)."""
    p1, p2 = lat1.radians(), lat2.radians()
    dphi, dlmb = (lat2 - lat1).radians(), (lon2 - lon1).radians()
    a = (dphi / 2).sin() ** 2 + p1.cos() * p2.cos() * (dlmb / 2).sin() ** 2
    return 2 * 6371.0 * a.sqrt().arcsin()


def to_frame(table: pa.Table) -> pl.DataFrame:
    df = pl.from_arrow(table)
    return df.with_columns(
        t=pl.col("ts").str.strip_chars_end("Z").str.to_datetime("%Y-%m-%dT%H:%M:%S", time_zone="UTC").dt.epoch("s"),
        sog=pl.col("sog").fill_null(0.0),
    ).select(EMPTY.columns).drop_nulls(["mmsi", "t", "lon", "lat"])


class SlidingWindow:
    def __init__(self, window_s: int = 3 * 3600, stop_s: int = 2 * 3600, gap_s: int = 3 * 3600,
                 jump_kn: float = 8.0, ports: list[dict] | None = None, radius_km: float = 40.0):
        self.window_s, self.stop_s, self.gap_s, self.jump_kn = window_s, stop_s, gap_s, jump_kn
        self.ports = ports or []
        self.radius_km = radius_km
        self.df = EMPTY.clone()
        self.last = EMPTY.select("mmsi", "t", "lon", "lat").clone()          # last-seen per vessel
        self.now = 0
        self.active: set[tuple] = set()                                      # alerts currently raised
        self.db = duckdb.connect()
        if self.ports:                                   # ports are static: register them once
            self.db.register("p", pa.Table.from_pylist(self.ports))

    def warmup(self) -> None:
        """Run every rule once on a throwaway row (pays Polars/DuckDB first-call cost before live traffic)."""
        import bus as busmod
        self.ingest(busmod.decode_batch(busmod.encode_batch(
            [{"mmsi": 1, "ts": "2000-01-01T00:00:00Z", "lon": 0.0, "lat": 0.0, "sog": 0.0, "cog": 0.0}])))
        self.df, self.last, self.now, self.active = EMPTY.clone(), EMPTY.select("mmsi", "t", "lon", "lat").clone(), 0, set()

    # ── ingest ──
    def ingest(self, table: pa.Table) -> list[dict]:
        """Add one batch, run every rule, return the alerts that just started."""
        t0 = time.perf_counter()
        new = to_frame(table)
        if new.is_empty():
            return []
        alerts = self._gaps_on_arrival(new)
        self.df = pl.concat([self.df, new]).unique(["mmsi", "t"], keep="last")
        self.now = max(self.now, int(new["t"].max()))
        self.df = self.df.filter(pl.col("t") >= self.now - self.window_s)
        self.last = (pl.concat([self.last, new.select("mmsi", "t", "lon", "lat")])
                     .sort("t").group_by("mmsi").agg(pl.all().last()))
        alerts += self._silent() + self._stopped() + self._speed_jumps(new) + self._congestion()
        ms = (time.perf_counter() - t0) * 1000
        for a in alerts:
            a["fast_ms"] = round(ms, 3)
        return alerts

    def _raise(self, key: tuple, alert: dict) -> list[dict]:
        if key in self.active:
            return []
        self.active.add(key)
        return [{**alert, "path": "fast"}]

    def _clear(self, keys: set[tuple]) -> None:
        self.active -= keys

    # ── rules ──
    def _gaps_on_arrival(self, new: pl.DataFrame) -> list[dict]:
        first = new.sort("t").group_by("mmsi").agg(pl.all().first())
        j = first.join(self.last, on="mmsi", suffix="_prev").with_columns(
            gap_s=pl.col("t") - pl.col("t_prev"),
            jump_km=_hav_km(pl.col("lon_prev"), pl.col("lat_prev"), pl.col("lon"), pl.col("lat")),
        ).filter(pl.col("gap_s") >= self.gap_s)
        out = []
        for r in j.iter_rows(named=True):
            self._clear({("ais_silent", r["mmsi"])})
            out += self._raise(("ais_gap", r["mmsi"], r["t"]), {
                "type": "ais_gap", "mmsi": r["mmsi"], "event_t": r["t"],
                "severity": "high" if r["jump_km"] >= 10 else "watch",
                "reason": f"No AIS for {r['gap_s'] / 3600:.1f} h, reappeared {r['jump_km']:.0f} km away",
                "gap_h": round(r["gap_s"] / 3600, 2), "jump_km": round(r["jump_km"], 1)})
        return out

    def _silent(self) -> list[dict]:
        quiet = self.last.filter(self.now - pl.col("t") >= self.gap_s)
        out = []
        for r in quiet.iter_rows(named=True):
            out += self._raise(("ais_silent", r["mmsi"]), {
                "type": "ais_silent", "mmsi": r["mmsi"], "event_t": self.now, "severity": "watch",
                "reason": f"Silent for {(self.now - r['t']) / 3600:.1f} h", "last_lon": r["lon"], "last_lat": r["lat"]})
        return out

    def _stopped(self) -> list[dict]:
        agg = self.df.group_by("mmsi").agg(
            span=pl.col("t").max() - pl.col("t").min(), n=pl.len(), max_sog=pl.col("sog").max(),
            spread_km=_hav_km(pl.col("lon").min(), pl.col("lat").min(), pl.col("lon").max(), pl.col("lat").max()),
            lon=pl.col("lon").mean(), lat=pl.col("lat").mean(),
        ).filter((pl.col("span") >= self.stop_s) & (pl.col("max_sog") < 1.0) & (pl.col("spread_km") <= 15) & (pl.col("n") >= 3))
        out = []
        for r in agg.iter_rows(named=True):
            out += self._raise(("vessel_stopped", r["mmsi"]), {
                "type": "vessel_stopped", "mmsi": r["mmsi"], "event_t": self.now, "severity": "watch",
                "reason": f"Stationary {r['span'] / 3600:.1f} h (< 1 kn, within {r['spread_km']:.0f} km)",
                "lon": round(r["lon"], 4), "lat": round(r["lat"], 4)})
        return out

    def _speed_jumps(self, new: pl.DataFrame) -> list[dict]:
        touched = new["mmsi"].unique()
        d = (self.df.filter(pl.col("mmsi").is_in(touched.to_list())).sort("mmsi", "t")
             .with_columns(dsog=pl.col("sog").diff().abs().over("mmsi"))
             .filter(pl.col("dsog") >= self.jump_kn))
        out = []
        for r in d.iter_rows(named=True):
            out += self._raise(("speed_jump", r["mmsi"], r["t"]), {
                "type": "speed_jump", "mmsi": r["mmsi"], "event_t": r["t"], "severity": "watch",
                "reason": f"Speed changed by {r['dsog']:.0f} kn between pings"})
        return out

    def _congestion(self) -> list[dict]:
        if not self.ports:
            return []
        slow = self.df.filter(pl.col("sog") < 1.0)           # Polars prefilter: DuckDB only sees slow vessels
        if slow.is_empty():
            self._clear({k for k in self.active if k[0] == "port_congestion"})
            return []
        self.db.register("w", slow.to_arrow())
        rows = self.db.execute("""
            SELECT p.slug, p.name_en, p.name_ar, p.baseline, count(DISTINCT w.mmsi) AS n
            FROM w, p
            WHERE w.sog < 1.0
              AND 2 * 6371 * asin(sqrt(pow(sin(radians(w.lat - p.lat) / 2), 2)
                  + cos(radians(p.lat)) * cos(radians(w.lat)) * pow(sin(radians(w.lon - p.lon) / 2), 2))) <= ?
            GROUP BY ALL
        """, [float(self.radius_km)]).fetchall()
        out, busy = [], set()
        for slug, en, ar, baseline, n in rows:
            if n > baseline:
                busy.add(("port_congestion", slug))
                out += self._raise(("port_congestion", slug), {
                    "type": "port_congestion", "port": slug, "port_name": {"en": en, "ar": ar}, "event_t": self.now,
                    "severity": "high" if n >= 2 * baseline else "watch", "waiting": n, "baseline": baseline,
                    "reason": f"{n} slow vessels near {en} (~{n / max(1, baseline):.1f}x normal)"})
        self._clear({k for k in self.active if k[0] == "port_congestion"} - busy)
        return out

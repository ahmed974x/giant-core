-- maritime-agent local store (SQLite). Mirrors the PostGIS design in db/geo so the same logic moves
-- to PostgreSQL later; lon/lat are plain WGS-84 numbers here instead of a geometry column.

CREATE TABLE vessels (
  mmsi        INTEGER PRIMARY KEY,               -- public AIS identifier of the ship, not a person
  name        TEXT NOT NULL,
  ship_type   TEXT NOT NULL CHECK (ship_type IN ('tanker', 'container', 'bulk', 'lng', 'general')),
  flag        TEXT,
  route       TEXT                               -- corridor id the vessel is expected to follow
);

CREATE TABLE positions (
  mmsi  INTEGER NOT NULL REFERENCES vessels(mmsi),
  ts    TEXT    NOT NULL,                        -- ISO-8601 UTC
  lon   REAL    NOT NULL CHECK (lon BETWEEN -180 AND 180),
  lat   REAL    NOT NULL CHECK (lat BETWEEN -90 AND 90),
  sog   REAL,                                    -- speed over ground, knots
  cog   REAL,                                    -- course over ground, degrees
  PRIMARY KEY (mmsi, ts)
);
CREATE INDEX positions_ts ON positions (ts);

CREATE TABLE ports (
  slug     TEXT PRIMARY KEY,
  name_en  TEXT NOT NULL,
  name_ar  TEXT NOT NULL,
  lon      REAL NOT NULL,
  lat      REAL NOT NULL,
  baseline INTEGER NOT NULL DEFAULT 5            -- vessels normally waiting offshore
);

CREATE TABLE corridors (
  id        TEXT PRIMARY KEY,
  name_en   TEXT NOT NULL,
  name_ar   TEXT NOT NULL,
  waypoints TEXT NOT NULL                        -- JSON [[lon,lat], ...]
);

CREATE TABLE anomalies (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT NOT NULL CHECK (type IN ('ais_gap', 'route_deviation', 'port_congestion')),
  severity  TEXT NOT NULL CHECK (severity IN ('watch', 'high')),
  mmsi      INTEGER,
  port      TEXT,
  reason    TEXT NOT NULL,
  detail    TEXT NOT NULL,                       -- full JSON flag
  at        TEXT NOT NULL
);
-- The same finding is stored once. SQLite treats NULLs as distinct in UNIQUE, and every finding has
-- either no vessel (port congestion) or no port, so normalise the NULLs in an expression index.
CREATE UNIQUE INDEX anomalies_once ON anomalies (type, ifnull(mmsi, 0), ifnull(port, ''), reason);

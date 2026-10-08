#!/bin/sh
# Market Sentinel memory core. Runs on the first boot of an empty volume.
#   market.*  raw 1-minute candles (hypertable) + detected anomalies; writable only via market.ingest()
#   api.*     read-only views served by PostgREST to the Neural Constellation
set -eu
: "${SENTINEL_DB_PASSWORD:?}" "${PGRST_DB_PASSWORD:?}"

# Applied once: skipped when the market schema already exists, because db/migrate.sh re-runs every
# init script on each `docker compose up` to bring older volumes up to date.
if psql -tAq --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -c "SELECT 1 FROM pg_namespace WHERE nspname = 'market'" | grep -q 1; then
  echo "01-sentinel.sh: market schema present, nothing to do"
else
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v writer_pw="$SENTINEL_DB_PASSWORD" -v rest_pw="$PGRST_DB_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── Roles ────────────────────────────────────────────────────────────────
CREATE ROLE sentinel_writer LOGIN PASSWORD :'writer_pw';   -- n8n: may only call market.ingest()
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'rest_pw';  -- PostgREST connection role
CREATE ROLE web_anon NOLOGIN;                                -- what PostgREST serves as
GRANT web_anon TO authenticator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- ── Raw memory ───────────────────────────────────────────────────────────
CREATE SCHEMA market;

CREATE TABLE market.candles_1m (
  ts            timestamptz      NOT NULL,   -- candle open time
  symbol        text             NOT NULL,
  open          double precision NOT NULL,
  high          double precision NOT NULL,
  low           double precision NOT NULL,
  close         double precision NOT NULL,
  volume        double precision NOT NULL,   -- base asset
  quote_volume  double precision NOT NULL,   -- USDT
  trades        integer          NOT NULL,
  PRIMARY KEY (symbol, ts)
);
SELECT create_hypertable('market.candles_1m', 'ts', chunk_time_interval => interval '1 day');
ALTER TABLE market.candles_1m SET (timescaledb.compress, timescaledb.compress_segmentby = 'symbol');
SELECT add_compression_policy('market.candles_1m', interval '7 days');
SELECT add_retention_policy('market.candles_1m', interval '365 days');

CREATE TABLE market.anomalies (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts        timestamptz      NOT NULL,       -- candle that triggered it
  symbol    text             NOT NULL,
  kind      text             NOT NULL CHECK (kind IN ('price_shock', 'volume_spike', 'drawdown_1h')),
  severity  text             NOT NULL CHECK (severity IN ('watch', 'high')),
  price     double precision NOT NULL,
  value     double precision NOT NULL,       -- observed metric
  baseline  double precision,                -- what "normal" looked like
  zscore    double precision,
  reason    text             NOT NULL,
  detected_at timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (symbol, kind, ts)
);
CREATE INDEX ON market.anomalies (ts DESC);

-- ── Tuning knobs (edit rows, no redeploy) ───────────────────────────────
CREATE TABLE market.thresholds (
  key   text PRIMARY KEY,
  value double precision NOT NULL,
  note  text
);
INSERT INTO market.thresholds VALUES
  ('min_samples',        60,  'baseline minutes required before z-score rules fire'),
  ('price_z',            4,   'price_shock: |z| of 1-min log return vs 24h'),
  ('price_z_high',       6,   'price_shock: |z| for severity high'),
  ('volume_mult',        5,   'volume_spike: volume >= N x 24h mean'),
  ('volume_z',           4,   'volume_spike: z of volume vs 24h'),
  ('drawdown_pct',      -2,   'drawdown_1h: close vs 1h high, percent'),
  ('drawdown_pct_high', -4,   'drawdown_1h: percent for severity high'),
  ('cooldown_min',       30,  'minutes before the same symbol+kind can fire again');

-- ── Detection: one symbol, one closed candle ─────────────────────────────
CREATE FUNCTION market.detect(p_symbol text, p_at timestamptz)
RETURNS SETOF market.anomalies
LANGUAGE sql
SET search_path = market, pg_temp
AS $$
WITH t AS (SELECT jsonb_object_agg(key, value) j FROM thresholds),
win AS (
  SELECT ts, close, high, volume,
         ln(close / nullif(lag(close) OVER (ORDER BY ts), 0)) AS ret
  FROM candles_1m
  WHERE symbol = p_symbol AND ts > p_at - interval '24 hours' AND ts <= p_at
),
cur AS (SELECT * FROM win WHERE ts = p_at),
base AS (
  SELECT count(ret) AS n, avg(ret) AS mu_r, stddev_samp(ret) AS sd_r,
         avg(volume) AS mu_v, stddev_samp(volume) AS sd_v
  FROM win WHERE ts < p_at
),
hi AS (SELECT max(high) AS h FROM win WHERE ts > p_at - interval '1 hour'),
cand AS (
  SELECT 'price_shock' AS kind, c.ret AS value, b.mu_r AS baseline,
         (c.ret - b.mu_r) / nullif(b.sd_r, 0) AS z, c.close, b.n
  FROM cur c, base b
  UNION ALL
  SELECT 'volume_spike', c.volume, b.mu_v, (c.volume - b.mu_v) / nullif(b.sd_v, 0), c.close, b.n
  FROM cur c, base b
  UNION ALL
  SELECT 'drawdown_1h', (c.close - hi.h) / nullif(hi.h, 0) * 100, hi.h, NULL, c.close, b.n
  FROM cur c, base b, hi
),
fired AS (
  SELECT cand.*,
    CASE kind
      WHEN 'price_shock'  THEN CASE WHEN abs(z) >= (t.j->>'price_z_high')::float8 THEN 'high' ELSE 'watch' END
      WHEN 'volume_spike' THEN CASE WHEN value >= 2 * (t.j->>'volume_mult')::float8 * baseline THEN 'high' ELSE 'watch' END
      ELSE CASE WHEN value <= (t.j->>'drawdown_pct_high')::float8 THEN 'high' ELSE 'watch' END
    END AS severity,
    CASE kind
      WHEN 'price_shock' THEN format('%s 1-min move %s%s%% (z=%s) vs 24h baseline',
        CASE WHEN value < 0 THEN 'Down' ELSE 'Up' END, CASE WHEN value < 0 THEN '' ELSE '+' END,
        round(((exp(value) - 1) * 100)::numeric, 2), round(z::numeric, 1))
      WHEN 'volume_spike' THEN format('Volume x%s the 24h average (z=%s)',
        round((value / nullif(baseline, 0))::numeric, 1), round(z::numeric, 1))
      ELSE format('%s%% below the 1h high of %s', round(value::numeric, 2), round(baseline::numeric, 2))
    END AS reason
  FROM cand, t
  WHERE value IS NOT NULL AND CASE kind
    WHEN 'price_shock'  THEN n >= (t.j->>'min_samples')::float8 AND abs(z) >= (t.j->>'price_z')::float8
    WHEN 'volume_spike' THEN n >= (t.j->>'min_samples')::float8
                             AND value >= (t.j->>'volume_mult')::float8 * baseline
                             AND z >= (t.j->>'volume_z')::float8
    ELSE value <= (t.j->>'drawdown_pct')::float8
  END
)
INSERT INTO anomalies (ts, symbol, kind, severity, price, value, baseline, zscore, reason)
SELECT p_at, p_symbol, f.kind, f.severity, f.close, f.value, f.baseline, f.z, f.reason
FROM fired f, t
WHERE NOT EXISTS (
  SELECT 1 FROM anomalies a
  WHERE a.symbol = p_symbol AND a.kind = f.kind
    AND a.ts > p_at - make_interval(mins => (t.j->>'cooldown_min')::int)
)
ON CONFLICT (symbol, kind, ts) DO NOTHING
RETURNING *;
$$;

-- ── Ingest: n8n's only door. Upserts closed candles, returns NEW anomalies. ──
-- payload: [{"s":"BTCUSDT","t":<open ms>,"o":..,"h":..,"l":..,"c":..,"v":..,"q":..,"n":..}, ...]
CREATE FUNCTION market.ingest(payload jsonb)
RETURNS SETOF market.anomalies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = market, pg_temp
AS $$
DECLARE r record;
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) > 5000 THEN
    RAISE EXCEPTION 'payload must be an array of at most 5000 candles';
  END IF;

  INSERT INTO candles_1m AS c (ts, symbol, open, high, low, close, volume, quote_volume, trades)
  SELECT to_timestamp((e->>'t')::bigint / 1000.0), e->>'s',
         (e->>'o')::float8, (e->>'h')::float8, (e->>'l')::float8, (e->>'c')::float8,
         (e->>'v')::float8, (e->>'q')::float8, (e->>'n')::int
  FROM jsonb_array_elements(payload) e
  WHERE e->>'s' ~ '^[A-Z0-9]{5,20}$' AND (e->>'c')::float8 > 0
  ON CONFLICT (symbol, ts) DO UPDATE SET
    open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
    volume = EXCLUDED.volume, quote_volume = EXCLUDED.quote_volume, trades = EXCLUDED.trades;

  -- Detect on the newest candle per symbol only (a backfill does not replay history as alerts).
  FOR r IN
    SELECT e->>'s' AS symbol, max(to_timestamp((e->>'t')::bigint / 1000.0)) AS ts
    FROM jsonb_array_elements(payload) e
    WHERE e->>'s' ~ '^[A-Z0-9]{5,20}$'
    GROUP BY 1
  LOOP
    RETURN QUERY SELECT * FROM detect(r.symbol, r.ts);
  END LOOP;
END;
$$;

REVOKE ALL ON SCHEMA market FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA market FROM PUBLIC;
GRANT USAGE ON SCHEMA market TO sentinel_writer;
GRANT EXECUTE ON FUNCTION market.ingest(jsonb) TO sentinel_writer;

-- ── Read API (PostgREST). Views run as their owner, so web_anon never touches market.* ──
CREATE SCHEMA api;

CREATE VIEW api.latest AS
SELECT DISTINCT ON (c.symbol)
  c.symbol, c.ts, c.close,
  round(((c.close / h1.close - 1) * 100)::numeric, 3)  AS change_1h_pct,
  round(((c.close / h24.close - 1) * 100)::numeric, 3) AS change_24h_pct,
  v.quote_volume_24h
FROM market.candles_1m c
LEFT JOIN LATERAL (SELECT close FROM market.candles_1m x WHERE x.symbol = c.symbol AND x.ts <= c.ts - interval '1 hour'  ORDER BY ts DESC LIMIT 1) h1  ON true
LEFT JOIN LATERAL (SELECT close FROM market.candles_1m x WHERE x.symbol = c.symbol AND x.ts <= c.ts - interval '24 hours' ORDER BY ts DESC LIMIT 1) h24 ON true
LEFT JOIN LATERAL (SELECT sum(quote_volume) AS quote_volume_24h FROM market.candles_1m x WHERE x.symbol = c.symbol AND x.ts > c.ts - interval '24 hours') v ON true
WHERE c.ts > now() - interval '2 days'
ORDER BY c.symbol, c.ts DESC;

CREATE VIEW api.candles AS                       -- 1-minute, last 7 days; filter with ?symbol=eq.X&ts=gte.Y
SELECT symbol, ts, open, high, low, close, volume, quote_volume
FROM market.candles_1m WHERE ts > now() - interval '7 days';

CREATE VIEW api.candles_5m AS                    -- 5-minute buckets, last 48h, for sparklines
SELECT symbol, time_bucket('5 minutes', ts) AS ts,
       first(open, ts) AS open, max(high) AS high, min(low) AS low, last(close, ts) AS close,
       sum(volume) AS volume
FROM market.candles_1m WHERE ts > now() - interval '48 hours'
GROUP BY 1, 2;

CREATE VIEW api.anomalies AS
SELECT id, ts, symbol, kind, severity, price, value, baseline, zscore, reason, detected_at
FROM market.anomalies WHERE ts > now() - interval '30 days';

GRANT USAGE ON SCHEMA api TO web_anon;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO web_anon;
SQL
fi

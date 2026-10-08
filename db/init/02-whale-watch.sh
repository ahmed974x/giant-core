#!/bin/sh
# Whale Watch memory: on-chain BTC/ETH transfers, an exchange address book, and >= $50M alerts.
#   chain.*  transfers (hypertable), whale_alerts, entities, assets, thresholds; written only via chain.ingest()
#   api.*    whales + whale_feeds views for PostgREST
# Runs on the first boot of an empty volume. On a volume that already exists, apply it once with:
#   docker compose exec -T timescale sh /docker-entrypoint-initdb.d/02-whale-watch.sh
set -eu

if psql -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT 1 FROM pg_namespace WHERE nspname = 'chain'" | grep -q 1; then
  echo "whale watch schema already present"; exit 0
fi

psql -v ON_ERROR_STOP=1 --single-transaction --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE SCHEMA chain;

-- ── What we track and how to price it ────────────────────────────────────
CREATE TABLE chain.assets (
  chain        text    NOT NULL CHECK (chain IN ('btc', 'eth')),
  asset        text    NOT NULL,
  contract     text,                      -- ERC-20 contract (lowercase); NULL = native coin
  decimals     integer NOT NULL,
  price_symbol text,                      -- market.candles_1m symbol that prices it
  fixed_usd    double precision,          -- stablecoins: 1.0
  PRIMARY KEY (chain, asset),
  CHECK ((price_symbol IS NULL) <> (fixed_usd IS NULL))
);
INSERT INTO chain.assets VALUES
  ('btc', 'BTC',   NULL,                                         8,  'BTCUSDT', NULL),
  ('eth', 'ETH',   NULL,                                         18, 'ETHUSDT', NULL),
  ('eth', 'USDT',  '0xdac17f958d2ee523a2206206994597c13d831ec7', 6,  NULL,      1),
  ('eth', 'USDC',  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6,  NULL,      1),
  ('eth', 'WETH',  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 18, 'ETHUSDT', NULL),
  ('eth', 'WBTC',  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 8,  'BTCUSDT', NULL),
  ('eth', 'STETH', '0xae7ab96520de3a18e5e111b7eaab095312d7fe84', 18, 'ETHUSDT', NULL);

-- ── Address book (Forensics grows this; labels turn "unknown" into a verdict) ──
CREATE TABLE chain.entities (
  chain    text NOT NULL CHECK (chain IN ('btc', 'eth')),
  address  text NOT NULL,                 -- ETH lowercase; BTC as written
  entity   text NOT NULL CHECK (length(entity) BETWEEN 1 AND 40),
  kind     text NOT NULL CHECK (kind IN ('exchange', 'issuer', 'fund', 'bridge', 'miner', 'other')),
  source   text NOT NULL DEFAULT 'manual',
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, address)
);
-- Seed: well-known public explorer tags. Spot-check before trusting a verdict; add your own freely.
INSERT INTO chain.entities (chain, address, entity, kind, source) VALUES
  ('btc', '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',                              'Binance',  'exchange', 'seed'),
  ('btc', 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', 'Bitfinex', 'exchange', 'seed'),
  ('btc', 'bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2',                     'Robinhood','exchange', 'seed'),
  ('eth', '0x28c6c06298d514db089934071355e5743bf21d60', 'Binance',  'exchange', 'seed'),
  ('eth', '0x21a31ee1afc51d94c2efccaa2092ad1028285549', 'Binance',  'exchange', 'seed'),
  ('eth', '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8', 'Binance',  'exchange', 'seed'),
  ('eth', '0xf977814e90da44bfa03b6295a0616a897441acec', 'Binance',  'exchange', 'seed'),
  ('eth', '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', 'Coinbase', 'exchange', 'seed'),
  ('eth', '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', 'Coinbase', 'exchange', 'seed'),
  ('eth', '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', 'Kraken',   'exchange', 'seed'),
  ('eth', '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', 'OKX',      'exchange', 'seed'),
  ('eth', '0x5754284f345afc66a98fbb0a0afe71e0f007b949', 'Tether Treasury', 'issuer', 'seed');

-- ── Tuning knobs (edit rows, no redeploy) ───────────────────────────────
CREATE TABLE chain.thresholds (
  key   text PRIMARY KEY,
  value double precision NOT NULL,
  note  text
);
INSERT INTO chain.thresholds VALUES
  ('whale_usd_min',   50000000,  'transfers at or above this reach the Constellation'),
  ('whale_usd_high',  250000000, 'unlabelled transfers at or above this are severity high'),
  ('store_usd_min',   5000000,   'kept in chain.transfers for history and hit-rates, never alerted'),
  ('stall_min_btc',   90,        'feed health: minutes without a new BTC block before "degraded"'),
  ('stall_min_eth',   10,        'feed health: minutes without a new ETH block before "degraded"');

-- ── Memory ───────────────────────────────────────────────────────────────
CREATE TABLE chain.transfers (
  ts          timestamptz      NOT NULL,      -- block time
  chain       text             NOT NULL,
  block       bigint           NOT NULL,
  tx_hash     text             NOT NULL,
  idx         integer          NOT NULL,      -- ERC-20 log index; -1 native ETH; 0 BTC
  asset       text             NOT NULL,
  amount      numeric          NOT NULL,
  price_usd   double precision NOT NULL,
  usd_value   double precision NOT NULL,
  from_addrs  text[]           NOT NULL,      -- BTC: input addresses; ETH: one
  to_addrs    text[]           NOT NULL,      -- BTC: non-change outputs, largest first; ETH: one
  from_entity text,
  to_entity   text,
  verdict     text             NOT NULL,
  PRIMARY KEY (chain, tx_hash, idx, ts)
);
SELECT create_hypertable('chain.transfers', 'ts', chunk_time_interval => interval '7 days');
ALTER TABLE chain.transfers SET (timescaledb.compress, timescaledb.compress_segmentby = 'chain');
SELECT add_compression_policy('chain.transfers', interval '30 days');
SELECT add_retention_policy('chain.transfers', interval '365 days');

CREATE TABLE chain.whale_alerts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          timestamptz      NOT NULL,
  chain       text             NOT NULL,
  block       bigint           NOT NULL,
  tx_hash     text             NOT NULL,
  idx         integer          NOT NULL,
  asset       text             NOT NULL,
  amount      double precision NOT NULL,
  usd_value   double precision NOT NULL,
  from_addr   text             NOT NULL,
  to_addr     text             NOT NULL,
  from_entity text,
  to_entity   text,
  verdict     text             NOT NULL,
  severity    text             NOT NULL CHECK (severity IN ('watch', 'high')),
  reason      text             NOT NULL,
  detected_at timestamptz      NOT NULL DEFAULT now(),
  UNIQUE (chain, tx_hash, idx)
);
CREATE INDEX ON chain.whale_alerts (ts DESC);

CREATE TABLE chain.feeds (
  chain      text PRIMARY KEY CHECK (chain IN ('btc', 'eth')),
  block      bigint,                       -- last block fully processed
  block_ts   timestamptz,
  updated_at timestamptz,                  -- last time the cursor moved
  checked_at timestamptz                   -- last time the workflow asked for a plan
);
INSERT INTO chain.feeds (chain) VALUES ('btc'), ('eth');

-- ── Pricing: nearest 1-minute close at or before the block, else the newest we have ──
CREATE FUNCTION chain.price_at(p_chain text, p_asset text, p_ts timestamptz)
RETURNS double precision
LANGUAGE sql STABLE
SET search_path = chain, market, pg_temp
AS $$
  SELECT COALESCE(a.fixed_usd,
    (SELECT close FROM market.candles_1m c WHERE c.symbol = a.price_symbol AND c.ts <= p_ts ORDER BY c.ts DESC LIMIT 1),
    (SELECT close FROM market.candles_1m c WHERE c.symbol = a.price_symbol ORDER BY c.ts DESC LIMIT 1))
  FROM chain.assets a WHERE a.chain = p_chain AND a.asset = p_asset;
$$;

-- ── Plan: n8n's first call each run. Cursor + per-asset floors so dust never leaves n8n. ──
CREATE FUNCTION chain.plan(p_chain text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chain, market, pg_temp
AS $$
DECLARE
  v_min double precision := (SELECT value FROM thresholds WHERE key = 'store_usd_min');
  v_cur feeds%ROWTYPE;
  v_assets jsonb;
BEGIN
  UPDATE feeds SET checked_at = now() WHERE chain = p_chain RETURNING * INTO v_cur;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown chain %', p_chain; END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'asset', a.asset, 'contract', a.contract, 'decimals', a.decimals,
           'floor', v_min / nullif(price_at(p_chain, a.asset, now()), 0)) ORDER BY a.asset)
    INTO v_assets FROM assets a WHERE a.chain = p_chain;
  RETURN jsonb_build_object(
    'chain', p_chain,
    'cursor', v_cur.block,
    'assets', v_assets,
    -- not ready until Market Sentinel has a price for every asset (first minutes of a fresh stack)
    'ready', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_assets) e WHERE e->'floor' = 'null'::jsonb));
END;
$$;

-- ── Ingest: n8n's only write door. Prices, labels, judges, stores; returns NEW alerts. ──
-- payload: [{"h":tx hash,"i":idx,"a":asset,"q":"amount (decimal string)","t":block ms,"b":block,
--            "f":[from addresses],"o":[to addresses]}, ...]
CREATE FUNCTION chain.ingest(p_chain text, p_through bigint, payload jsonb)
RETURNS SETOF chain.whale_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chain, market, pg_temp
AS $$
DECLARE
  t jsonb := (SELECT jsonb_object_agg(key, value) FROM thresholds);
  addr_re text := CASE p_chain WHEN 'btc' THEN '^[A-Za-z0-9]{14,90}$' ELSE '^0x[0-9a-f]{40}$' END;
  hash_re text := CASE p_chain WHEN 'btc' THEN '^[0-9a-f]{64}$' ELSE '^0x[0-9a-f]{64}$' END;
  zero text := '0x0000000000000000000000000000000000000000';
BEGIN
  IF p_chain NOT IN ('btc', 'eth') THEN RAISE EXCEPTION 'unknown chain %', p_chain; END IF;
  IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) > 5000 THEN
    RAISE EXCEPTION 'payload must be an array of at most 5000 transfers';
  END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT lower(e->>'h') AS h, (e->>'i')::int AS i, upper(e->>'a') AS a, (e->>'q')::numeric AS q,
           to_timestamp((e->>'t')::bigint / 1000.0) AS ts, (e->>'b')::bigint AS b,
           ARRAY(SELECT CASE WHEN p_chain = 'eth' THEN lower(x) ELSE x END
                 FROM jsonb_array_elements_text(e->'f') WITH ORDINALITY AS f(x, n) ORDER BY n LIMIT 20) AS f,
           ARRAY(SELECT CASE WHEN p_chain = 'eth' THEN lower(x) ELSE x END
                 FROM jsonb_array_elements_text(e->'o') WITH ORDINALITY AS o(x, n) ORDER BY n LIMIT 20) AS o
    FROM jsonb_array_elements(payload) e
    WHERE jsonb_typeof(e->'f') = 'array' AND jsonb_typeof(e->'o') = 'array'
  ),
  valid AS (
    SELECT r.* FROM raw r
    JOIN assets a ON a.chain = p_chain AND a.asset = r.a
    WHERE r.h ~ hash_re AND r.q > 0 AND r.b <= p_through
      AND cardinality(r.f) > 0 AND cardinality(r.o) > 0
      AND NOT EXISTS (SELECT 1 FROM unnest(r.f || r.o) x WHERE x !~ addr_re)
  ),
  priced AS (
    SELECT v.*, price_at(p_chain, v.a, v.ts) AS px,
      (SELECT en.entity FROM unnest(v.f) WITH ORDINALITY u(x, n) JOIN entities en ON en.chain = p_chain AND en.address = u.x ORDER BY u.n LIMIT 1) AS fe,
      (SELECT en.kind   FROM unnest(v.f) WITH ORDINALITY u(x, n) JOIN entities en ON en.chain = p_chain AND en.address = u.x ORDER BY u.n LIMIT 1) AS fk,
      (SELECT en.entity FROM unnest(v.o) WITH ORDINALITY u(x, n) JOIN entities en ON en.chain = p_chain AND en.address = u.x ORDER BY u.n LIMIT 1) AS te,
      (SELECT en.kind   FROM unnest(v.o) WITH ORDINALITY u(x, n) JOIN entities en ON en.chain = p_chain AND en.address = u.x ORDER BY u.n LIMIT 1) AS tk
    FROM valid v
  ),
  judged AS (
    SELECT p.*, p.q * p.px AS usd,
      CASE
        WHEN p.f[1] = zero THEN 'mint'
        WHEN p.o[1] = zero THEN 'burn'
        WHEN p.fe IS NOT NULL AND p.fe = p.te THEN 'internal'
        WHEN p.fk = 'exchange' AND p.tk = 'exchange' THEN 'exchange_shuffle'
        WHEN p.tk = 'exchange' THEN 'to_exchange'
        WHEN p.fk = 'exchange' THEN 'from_exchange'
        WHEN p.fk = 'issuer' THEN 'issuer_out'
        ELSE 'unknown'
      END AS verdict
    FROM priced p
    WHERE p.px IS NOT NULL AND p.q * p.px >= (t->>'store_usd_min')::float8
  ),
  stored AS (
    INSERT INTO transfers AS x (ts, chain, block, tx_hash, idx, asset, amount, price_usd, usd_value,
                                from_addrs, to_addrs, from_entity, to_entity, verdict)
    SELECT ts, p_chain, b, h, i, a, q, px, usd, f, o, fe, te, verdict FROM judged
    ON CONFLICT DO NOTHING
    RETURNING x.*
  ),
  alerts AS (
    INSERT INTO whale_alerts AS w (ts, chain, block, tx_hash, idx, asset, amount, usd_value,
                                   from_addr, to_addr, from_entity, to_entity, verdict, severity, reason)
    SELECT s.ts, s.chain, s.block, s.tx_hash, s.idx, s.asset, s.amount::float8, s.usd_value,
           s.from_addrs[1], s.to_addrs[1], s.from_entity, s.to_entity, s.verdict,
           CASE WHEN s.verdict IN ('to_exchange', 'from_exchange', 'mint', 'issuer_out')
                  OR s.usd_value >= (t->>'whale_usd_high')::float8 THEN 'high' ELSE 'watch' END,
           format('$%sM %s %s · %s → %s · %s',
             to_char(s.usd_value / 1e6, 'FM999G999G990D0'),
             to_char(s.amount, CASE WHEN s.amount >= 1000 THEN 'FM999G999G999G990' ELSE 'FM990D00' END), s.asset,
             CASE WHEN s.verdict = 'mint' THEN 'Mint'
                  ELSE COALESCE(s.from_entity, left(s.from_addrs[1], 6) || '…' || right(s.from_addrs[1], 4)) END,
             CASE WHEN s.verdict = 'burn' THEN 'Burn'
                  ELSE COALESCE(s.to_entity, left(s.to_addrs[1], 6) || '…' || right(s.to_addrs[1], 4)) END,
             CASE s.verdict
               WHEN 'to_exchange'      THEN 'into an exchange: sell pressure'
               WHEN 'from_exchange'    THEN 'out of an exchange: accumulation'
               WHEN 'exchange_shuffle' THEN 'exchange to exchange'
               WHEN 'mint'             THEN 'fresh mint'
               WHEN 'burn'             THEN 'burn'
               WHEN 'issuer_out'       THEN 'issuer release: new supply'
               ELSE 'unlabelled wallets'
             END)
    FROM stored s
    WHERE s.usd_value >= (t->>'whale_usd_min')::float8 AND s.verdict <> 'internal'
    ON CONFLICT (chain, tx_hash, idx) DO NOTHING
    RETURNING w.*
  )
  SELECT * FROM alerts ORDER BY usd_value DESC;

  UPDATE feeds SET
    block = GREATEST(COALESCE(block, p_through), p_through),
    block_ts = COALESCE((SELECT max(to_timestamp((e->>'t')::bigint / 1000.0)) FROM jsonb_array_elements(payload) e), block_ts),
    updated_at = CASE WHEN block IS DISTINCT FROM GREATEST(COALESCE(block, p_through), p_through) OR updated_at IS NULL
                      THEN now() ELSE updated_at END
  WHERE chain = p_chain;
END;
$$;

REVOKE ALL ON SCHEMA chain FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA chain FROM PUBLIC;
GRANT USAGE ON SCHEMA chain TO sentinel_writer;
GRANT EXECUTE ON FUNCTION chain.plan(text), chain.ingest(text, bigint, jsonb) TO sentinel_writer;

-- ── Read API ─────────────────────────────────────────────────────────────
CREATE VIEW api.whales AS
SELECT id, ts, chain, block, tx_hash, idx, asset, amount, usd_value, from_addr, to_addr,
       from_entity, to_entity, verdict, severity, reason, detected_at
FROM chain.whale_alerts WHERE ts > now() - interval '30 days';

CREATE VIEW api.whale_feeds AS
SELECT c.chain, c.block, c.block_ts, c.updated_at, c.checked_at,
  CASE
    WHEN c.checked_at IS NULL OR c.checked_at < now() - interval '5 minutes' THEN 'down'
    WHEN c.updated_at IS NULL THEN 'unknown'
    WHEN c.updated_at < now() - make_interval(mins => (SELECT value FROM chain.thresholds WHERE key = 'stall_min_' || c.chain)::int)
      THEN 'degraded'
    ELSE 'ok'
  END AS health
FROM chain.feeds c;

GRANT SELECT ON api.whales, api.whale_feeds TO web_anon;
SQL

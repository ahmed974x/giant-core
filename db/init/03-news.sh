#!/bin/sh
# News + sentiment memory. Headlines from free RSS feeds, scored by the Cortex gateway (free route),
# plus the daily Crypto Fear & Greed index.
#   news.items         one row per headline (deduped by URL); score columns stay NULL until scored
#   news.fear_greed    one row per day from alternative.me
#   news.ingest()      n8n's door for new headlines; returns what still needs a score
#   news.score()       n8n's door for scores; returns the rows it scored
#   api.news, api.sentiment_now, api.sentiment_1h, api.fear_greed, api.sentiment_vs_price   read-only views
# Sentiment is in [-1, 1]. Aggregates weight each headline by relevance × impact (low 1, medium 2, high 3).
# Runs on first boot of an empty volume. On an existing volume:
#   docker compose exec timescale sh /docker-entrypoint-initdb.d/03-news.sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE SCHEMA news;

CREATE TABLE news.items (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  published_at  timestamptz NOT NULL,
  source        text        NOT NULL,
  title         text        NOT NULL,
  url           text        NOT NULL,
  summary       text,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  -- filled by news.score()
  sentiment     double precision CHECK (sentiment BETWEEN -1 AND 1),
  relevance     double precision CHECK (relevance BETWEEN 0 AND 1),
  impact        text CHECK (impact IN ('low', 'medium', 'high')),
  symbols       text[] NOT NULL DEFAULT '{}',   -- base tickers (BTC, ETH, ...); empty = market-wide
  rationale     text,
  scored_by     text,                           -- provider:model that answered, or 'lexicon'
  scored_at     timestamptz,
  label         text GENERATED ALWAYS AS (
                  CASE WHEN sentiment >= 0.2 THEN 'bullish' WHEN sentiment <= -0.2 THEN 'bearish'
                       WHEN sentiment IS NOT NULL THEN 'neutral' END) STORED,
  weight        double precision GENERATED ALWAYS AS (
                  coalesce(relevance, 0) * CASE impact WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) STORED
);
CREATE UNIQUE INDEX items_url_key ON news.items (md5(lower(url)));
CREATE INDEX ON news.items (published_at DESC);
CREATE INDEX ON news.items USING gin (symbols);
CREATE INDEX items_pending ON news.items (published_at DESC) WHERE sentiment IS NULL;

CREATE TABLE news.fear_greed (
  ts     timestamptz PRIMARY KEY,                -- day the reading belongs to (UTC midnight)
  value  smallint NOT NULL CHECK (value BETWEEN 0 AND 100),
  label  text     NOT NULL
);

-- ── Ingest: payload [{"source","title","url","published_at","summary"}, ...] ──
-- Inserts what is new, then returns every headline from the last 48h still waiting for a score
-- (newest first, at most p_limit), so a run that died before scoring is picked up by the next one.
CREATE FUNCTION news.ingest(payload jsonb, p_limit integer DEFAULT 25)
RETURNS TABLE (id bigint, published_at timestamptz, source text, title text, summary text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = news, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) > 1000 THEN
    RAISE EXCEPTION 'payload must be an array of at most 1000 headlines';
  END IF;

  INSERT INTO items (published_at, source, title, url, summary)
  SELECT least(e.ts, now()), left(e.src, 40), left(e.title, 300), e.url, nullif(left(e.summary, 600), '')
  FROM (
    SELECT btrim(x->>'source') AS src, btrim(regexp_replace(x->>'title', '\s+', ' ', 'g')) AS title,
           btrim(x->>'url') AS url, btrim(regexp_replace(coalesce(x->>'summary', ''), '\s+', ' ', 'g')) AS summary,
           CASE WHEN x->>'published_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (x->>'published_at')::timestamptz END AS ts
    FROM jsonb_array_elements(payload) x
  ) e
  WHERE e.src ~ '^[A-Za-z0-9 .&-]{1,40}$'
    AND length(e.title) >= 12
    AND e.url ~ '^https?://[^\s<>"]{4,}$' AND length(e.url) <= 600
    AND e.ts > now() - interval '3 days'
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT i.id, i.published_at, i.source, i.title, i.summary
  FROM items i
  WHERE i.sentiment IS NULL AND i.published_at > now() - interval '48 hours'
  ORDER BY i.published_at DESC
  LIMIT greatest(1, least(p_limit, 100));
END;
$$;

-- ── Score: payload [{"id","sentiment","relevance","impact","symbols","rationale","scored_by"}, ...] ──
-- Only fills headlines that are still unscored; everything is clamped. Returns the scored rows.
CREATE FUNCTION news.score(payload jsonb)
RETURNS TABLE (id bigint, published_at timestamptz, source text, title text, url text, symbols text[],
               sentiment double precision, relevance double precision, impact text, label text,
               rationale text, scored_by text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = news, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) > 200 THEN
    RAISE EXCEPTION 'payload must be an array of at most 200 scores';
  END IF;

  RETURN QUERY
  WITH s AS (
    SELECT DISTINCT ON ((x->>'id')::bigint)
           (x->>'id')::bigint AS id,
           greatest(-1, least(1, (x->>'sentiment')::float8)) AS sentiment,
           greatest(0, least(1, coalesce((x->>'relevance')::float8, 0.5))) AS relevance,
           CASE WHEN x->>'impact' IN ('low', 'medium', 'high') THEN x->>'impact' ELSE 'low' END AS impact,
           coalesce((SELECT array_agg(DISTINCT upper(t)) FROM (
                       SELECT t FROM jsonb_array_elements_text(
                         CASE WHEN jsonb_typeof(x->'symbols') = 'array' THEN x->'symbols' ELSE '[]' END) t
                       LIMIT 8) q
                     WHERE upper(t) ~ '^[A-Z0-9]{2,10}$'), '{}') AS symbols,
           nullif(left(btrim(coalesce(x->>'rationale', '')), 160), '') AS rationale,
           left(coalesce(x->>'scored_by', 'unknown'), 160) AS scored_by
    FROM jsonb_array_elements(payload) x
    WHERE x->>'id' ~ '^\d{1,18}$' AND x->>'sentiment' ~ '^-?\d+(\.\d+)?$'
      AND coalesce(x->>'relevance', '0') ~ '^\d+(\.\d+)?$'
  )
  UPDATE items i SET sentiment = s.sentiment, relevance = s.relevance, impact = s.impact,
                     symbols = s.symbols, rationale = s.rationale, scored_by = s.scored_by, scored_at = now()
  FROM s
  WHERE i.id = s.id AND i.sentiment IS NULL
  RETURNING i.id, i.published_at, i.source, i.title, i.url, i.symbols, i.sentiment, i.relevance,
            i.impact, i.label, i.rationale, i.scored_by;
END;
$$;

-- ── Fear & Greed: payload = alternative.me "data" array [{"value","value_classification","timestamp"}] ──
CREATE FUNCTION news.store_fear_greed(payload jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = news, pg_temp
AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) > 400 THEN
    RAISE EXCEPTION 'payload must be an array of at most 400 readings';
  END IF;
  INSERT INTO fear_greed AS f (ts, value, label)
  SELECT date_trunc('day', to_timestamp((x->>'timestamp')::bigint), 'UTC'),
         (x->>'value')::smallint, left(x->>'value_classification', 24)
  FROM jsonb_array_elements(payload) x
  WHERE x->>'timestamp' ~ '^\d{9,11}$' AND x->>'value' ~ '^\d{1,3}$' AND (x->>'value')::int <= 100
    AND x->>'value_classification' ~ '^[A-Za-z ]{1,24}$'
  ON CONFLICT (ts) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON SCHEMA news FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA news FROM PUBLIC;
GRANT USAGE ON SCHEMA news TO sentinel_writer;
GRANT EXECUTE ON FUNCTION news.ingest(jsonb, integer), news.score(jsonb), news.store_fear_greed(jsonb) TO sentinel_writer;

-- ── Read API. Every scored headline counts toward MARKET and toward each ticker it names. ──
CREATE VIEW news.scoped AS
SELECT i.*, 'MARKET'::text AS scope FROM news.items i WHERE i.sentiment IS NOT NULL
UNION ALL
SELECT i.*, s AS scope FROM news.items i, unnest(i.symbols) s WHERE i.sentiment IS NOT NULL;

CREATE VIEW api.news AS                          -- scored headlines, last 7 days
SELECT id, published_at, source, title, url, symbols, sentiment, relevance, impact, label, rationale, scored_by
FROM news.items
WHERE sentiment IS NOT NULL AND published_at > now() - interval '7 days';

CREATE VIEW api.sentiment_now AS                 -- per scope: last 24h vs the 24h before
SELECT scope,
  round((sum(sentiment * weight) FILTER (WHERE published_at > now() - interval '24 hours')
         / nullif(sum(weight) FILTER (WHERE published_at > now() - interval '24 hours'), 0))::numeric, 3) AS score_24h,
  round((sum(sentiment * weight) FILTER (WHERE published_at > now() - interval '6 hours')
         / nullif(sum(weight) FILTER (WHERE published_at > now() - interval '6 hours'), 0))::numeric, 3) AS score_6h,
  round((sum(sentiment * weight) FILTER (WHERE published_at <= now() - interval '24 hours')
         / nullif(sum(weight) FILTER (WHERE published_at <= now() - interval '24 hours'), 0))::numeric, 3) AS score_prev_24h,
  count(*) FILTER (WHERE published_at > now() - interval '24 hours')                       AS n_24h,
  count(*) FILTER (WHERE published_at > now() - interval '24 hours' AND label = 'bullish') AS bullish_24h,
  count(*) FILTER (WHERE published_at > now() - interval '24 hours' AND label = 'bearish') AS bearish_24h,
  count(*) FILTER (WHERE published_at > now() - interval '24 hours' AND impact = 'high')   AS high_impact_24h,
  max(published_at)                                                                         AS last_headline
FROM news.scoped
WHERE published_at > now() - interval '48 hours'
GROUP BY scope;

CREATE VIEW api.sentiment_1h AS                  -- hourly series, last 7 days
SELECT date_trunc('hour', published_at) AS ts, scope,
       round((sum(sentiment * weight) / nullif(sum(weight), 0))::numeric, 3) AS score,
       count(*) AS n
FROM news.scoped
WHERE published_at > now() - interval '7 days'
GROUP BY 1, 2;

CREATE VIEW api.fear_greed AS
SELECT ts, value, label FROM news.fear_greed WHERE ts > now() - interval '90 days';

-- Does the mood lead the price? Each hour's sentiment next to the return of the FOLLOWING hour.
-- Correlate score with next_1h_return_pct before trusting any signal built on this.
CREATE VIEW api.sentiment_vs_price AS
SELECT h.ts, h.scope AS symbol, h.score, h.n,
       round(((p2.close / nullif(p1.close, 0) - 1) * 100)::numeric, 3) AS next_1h_return_pct
FROM api.sentiment_1h h
LEFT JOIN LATERAL (SELECT close FROM market.candles_1m c WHERE c.symbol = h.scope || 'USDT'
                   AND c.ts <= h.ts + interval '1 hour' ORDER BY c.ts DESC LIMIT 1) p1 ON true
LEFT JOIN LATERAL (SELECT close FROM market.candles_1m c WHERE c.symbol = h.scope || 'USDT'
                   AND c.ts <= h.ts + interval '2 hours' AND c.ts > h.ts + interval '1 hour'
                   ORDER BY c.ts DESC LIMIT 1) p2 ON true
WHERE h.scope <> 'MARKET';

GRANT SELECT ON api.news, api.sentiment_now, api.sentiment_1h, api.fear_greed, api.sentiment_vs_price TO web_anon;
NOTIFY pgrst, 'reload schema';
SQL

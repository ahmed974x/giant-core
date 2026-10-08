#!/bin/sh
# Cortex performance memory: one row per LLM gateway attempt (no prompt or answer text, ever).
#   llm.calls          hypertable, compressed after 7d, kept 180d; writable only via api.log_llm_calls()
#   api.llm_perf       per provider/model over the last 24h: success rate, p50/p95 latency, tokens
#   api.llm_perf_1h    hourly buckets over 48h, for the dashboard
#   api.llm_calls      recent attempts
# Runs on first boot of an empty volume. On an existing volume:
#   docker compose exec timescale sh /docker-entrypoint-initdb.d/02-cortex.sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
-- PostgREST switches to this role when the gateway presents its signed JWT.
CREATE ROLE gateway_writer NOLOGIN;
GRANT gateway_writer TO authenticator;

CREATE SCHEMA llm;

CREATE TABLE llm.calls (
  ts                timestamptz NOT NULL,          -- attempt start
  request_id        uuid        NOT NULL,          -- groups failover attempts of one request
  attempt           smallint    NOT NULL,
  route             text        NOT NULL,          -- omega/fast, omega/smart, claude, or direct
  provider          text        NOT NULL,
  model             text        NOT NULL,
  ok                boolean     NOT NULL,
  http_status       smallint,
  error             text,                          -- short class: rate_limited, timeout, auth, ...
  latency_ms        integer     NOT NULL,
  prompt_tokens     integer,
  completion_tokens integer,
  finish_reason     text
);
SELECT create_hypertable('llm.calls', 'ts', chunk_time_interval => interval '7 days');
CREATE INDEX ON llm.calls (provider, model, ts DESC);
ALTER TABLE llm.calls SET (timescaledb.compress, timescaledb.compress_segmentby = 'provider, model');
SELECT add_compression_policy('llm.calls', interval '7 days');
SELECT add_retention_policy('llm.calls', interval '180 days');

-- The gateway's only door. Caps and coerces every field; anything malformed is skipped.
CREATE FUNCTION api.log_llm_calls(rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = llm, pg_temp
AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(rows) <> 'array' OR jsonb_array_length(rows) > 500 THEN
    RAISE EXCEPTION 'rows must be an array of at most 500 attempts';
  END IF;
  INSERT INTO calls (ts, request_id, attempt, route, provider, model, ok, http_status, error,
                     latency_ms, prompt_tokens, completion_tokens, finish_reason)
  SELECT (r->>'ts')::timestamptz, (r->>'request_id')::uuid, least((r->>'attempt')::int, 50),
         left(r->>'route', 64), left(r->>'provider', 32), left(r->>'model', 128),
         (r->>'ok')::boolean, (r->>'http_status')::smallint, left(r->>'error', 64),
         greatest(0, (r->>'latency_ms')::int),
         (r->>'prompt_tokens')::int, (r->>'completion_tokens')::int, left(r->>'finish_reason', 32)
  FROM jsonb_array_elements(rows) r
  WHERE r->>'provider' ~ '^[a-z0-9_-]{1,32}$'
    AND r->>'request_id' ~ '^[0-9a-f-]{36}$'
    AND (r->>'ts')::timestamptz > now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION api.log_llm_calls(jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA api TO gateway_writer;
GRANT EXECUTE ON FUNCTION api.log_llm_calls(jsonb) TO gateway_writer;

CREATE VIEW api.llm_perf AS
SELECT provider, model,
       count(*)                                                           AS calls,
       round(avg(ok::int)::numeric, 3)                                    AS success_rate,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p95_ms,
       coalesce(sum(prompt_tokens) FILTER (WHERE ok), 0)                  AS prompt_tokens,
       coalesce(sum(completion_tokens) FILTER (WHERE ok), 0)              AS completion_tokens,
       round((sum(completion_tokens) FILTER (WHERE ok)::numeric
              / nullif(sum(latency_ms) FILTER (WHERE ok AND completion_tokens > 0), 0) * 1000)::numeric, 1)
                                                                          AS tokens_per_s,
       max(ts)                                                            AS last_call,
       (array_agg(error ORDER BY ts DESC) FILTER (WHERE NOT ok))[1]       AS last_error
FROM llm.calls
WHERE ts > now() - interval '24 hours'
GROUP BY provider, model;

CREATE VIEW api.llm_perf_1h AS
SELECT time_bucket('1 hour', ts) AS ts, provider,
       count(*) AS calls, count(*) FILTER (WHERE ok) AS ok_calls,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p50_ms,
       coalesce(sum(prompt_tokens + completion_tokens) FILTER (WHERE ok), 0) AS tokens
FROM llm.calls
WHERE ts > now() - interval '48 hours'
GROUP BY 1, 2;

CREATE VIEW api.llm_calls AS
SELECT ts, request_id, attempt, route, provider, model, ok, http_status, error,
       latency_ms, prompt_tokens, completion_tokens, finish_reason
FROM llm.calls WHERE ts > now() - interval '7 days';

GRANT SELECT ON api.llm_perf, api.llm_perf_1h, api.llm_calls TO web_anon, gateway_writer;
NOTIFY pgrst, 'reload schema';
SQL

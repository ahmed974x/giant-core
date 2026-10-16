#!/bin/sh
# Long-term memory for the agents (ADR-080, design in docs/agents/ARCHITECTURE-AGENTS.md section 6). Needs 05-nerve.sh.
#   mem.episodes   what happened (any agent logs; archived after 30 days, still searchable)
#   mem.facts      what we believe, bitemporal: valid_from/valid_to (world time) + recorded_at/superseded_at
#                  (when we learned it). Never edited, never deleted: a new belief supersedes the old row.
#   mem.skills     procedures that worked, with success counts
#   mem.forecasts  every forecast an agent makes, scored when it resolves (Brier) = the calibration ledger
#   mem.search()   hybrid recall: words + meaning (embeddings) + recency + trust, merged by reciprocal rank fusion
# Write gate: facts only through أمين (tool memory.write), only with evidence, never with a secret in them
# (a key-shaped string is refused: nothing stored, NULL returned, a guard.secret_refused event logged);
# facts from tainted sources stay 'unverified' until a second independent source confirms them.
# Embeddings are filled in by the ameen worker (services/ameen): local only, nothing leaves the laptop.
# Optional: AMEEN_DB_PASSWORD creates the `ameen` login for that worker.
set -eu

PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

if ! $PSQL -tA -c "SELECT 1 FROM pg_namespace WHERE nspname = 'mem'" | grep -q 1; then
$PSQL --single-transaction <<'SQL'
CREATE SCHEMA mem;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mem_keeper') THEN CREATE ROLE mem_keeper NOLOGIN; END IF;
END $$;

-- ── Helpers ──────────────────────────────────────────────────────────────
-- Key-shaped strings never enter memory (API keys, tokens, private keys, JWTs).
CREATE FUNCTION mem.looks_secret(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(t, '') ~ ('(sk-(ant-|proj-)?[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{20,}|csk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}'
                            '|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}'
                            '|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.)')
$$;

-- Cosine similarity of two embeddings of the same length (NULL when lengths differ).
CREATE FUNCTION mem.cosine(a real[], b real[]) RETURNS double precision LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN cardinality(a) <> cardinality(b) THEN NULL
              WHEN na = 0 OR nb = 0 THEN 0 ELSE dot / (sqrt(na) * sqrt(nb)) END
  FROM (SELECT sum(x::float8 * y) AS dot, sum(x::float8 * x) AS na, sum(y::float8 * y) AS nb FROM unnest(a, b) AS t (x, y)) s
$$;

-- Every item of an evidence list is an object with an http(s) url or a nerve event id.
CREATE FUNCTION mem.valid_evidence(ev jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(ev) = 'array' AND jsonb_array_length(ev) BETWEEN 1 AND 20
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ev) e
                     WHERE NOT (coalesce(e ->> 'url', '') ~ '^https?://[^ ]+$' OR coalesce(e ->> 'event', '') ~ '^[0-9]+$'))
$$;

-- ── Episodic memory ──────────────────────────────────────────────────────
CREATE TABLE mem.episodes (
  id         bigserial PRIMARY KEY,
  user_id    text NOT NULL DEFAULT 'owner',
  agent      text NOT NULL,
  run_id     uuid,
  summary    text NOT NULL CHECK (length(summary) BETWEEN 1 AND 2000),
  detail     jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) < 32768),
  trust      text NOT NULL CHECK (trust IN ('owner', 'system', 'agent', 'tainted')),
  evidence   jsonb NOT NULL DEFAULT '[]',
  event_id   bigint REFERENCES nerve.events (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived   boolean NOT NULL DEFAULT false,
  embedding  real[] CHECK (embedding IS NULL OR cardinality(embedding) BETWEEN 8 AND 4096),
  embed_model text,
  search     tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, summary)) STORED
);
CREATE INDEX episodes_search ON mem.episodes USING gin (search);
CREATE INDEX episodes_user_time ON mem.episodes (user_id, created_at DESC);
CREATE INDEX episodes_unembedded ON mem.episodes (id) WHERE embedding IS NULL;

-- ── Semantic memory (bitemporal facts) ───────────────────────────────────
CREATE TABLE mem.facts (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL DEFAULT 'owner',
  subject       text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  predicate     text NOT NULL CHECK (length(predicate) BETWEEN 1 AND 100),
  object        text NOT NULL CHECK (length(object) BETWEEN 1 AND 500),
  statement     text NOT NULL CHECK (length(statement) BETWEEN 1 AND 1000),
  confidence    real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status        text NOT NULL CHECK (status IN ('verified', 'unverified')),
  sources       integer NOT NULL DEFAULT 1,
  evidence      jsonb NOT NULL CHECK (mem.valid_evidence(evidence)),
  source_trust  text NOT NULL CHECK (source_trust IN ('owner', 'system', 'agent', 'tainted')),
  written_by    text NOT NULL,
  valid_from    timestamptz NOT NULL DEFAULT now(),   -- when it became true in the world
  valid_to      timestamptz,                          -- when it stopped being true (NULL = still true)
  recorded_at   timestamptz NOT NULL DEFAULT now(),   -- when we learned it
  superseded_at timestamptz,                          -- when we stopped believing this row
  superseded_by bigint REFERENCES mem.facts (id),
  embedding     real[] CHECK (embedding IS NULL OR cardinality(embedding) BETWEEN 8 AND 4096),
  embed_model   text,
  search        tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, statement)) STORED
);
CREATE UNIQUE INDEX facts_current ON mem.facts (user_id, lower(subject), lower(predicate)) WHERE superseded_at IS NULL;
CREATE INDEX facts_search ON mem.facts USING gin (search);
CREATE INDEX facts_unembedded ON mem.facts (id) WHERE embedding IS NULL;

-- Facts are history: the statement, evidence and times of a row never change, and rows are never deleted,
-- except by mem.forget_user() (the user's right to delete their own memories).
CREATE FUNCTION mem.guard_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('mem.forgetting', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'facts are never deleted; supersede them instead';
  END IF;
  IF NEW.subject <> OLD.subject OR NEW.predicate <> OLD.predicate OR NEW.object <> OLD.object
     OR NEW.statement <> OLD.statement OR NEW.recorded_at <> OLD.recorded_at OR NEW.valid_from <> OLD.valid_from
     OR NEW.user_id <> OLD.user_id OR NEW.written_by <> OLD.written_by THEN
    RAISE EXCEPTION 'a fact''s content is never edited; assert a new one';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER facts_guard BEFORE UPDATE OR DELETE ON mem.facts FOR EACH ROW EXECUTE FUNCTION mem.guard_facts();

-- ── Procedural memory ────────────────────────────────────────────────────
CREATE TABLE mem.skills (
  name        text PRIMARY KEY CHECK (name ~ '^[a-z0-9_.-]{3,60}$'),
  description text NOT NULL,
  steps       jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 30),
  reviewed_by text,                      -- بدر must review a skill before agents use it
  uses        integer NOT NULL DEFAULT 0,
  successes   integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Calibration ledger ───────────────────────────────────────────────────
CREATE TABLE mem.forecasts (
  id          bigserial PRIMARY KEY,
  agent       text NOT NULL,
  claim       text NOT NULL CHECK (length(claim) BETWEEN 5 AND 500),
  probability real NOT NULL CHECK (probability BETWEEN 0 AND 1),
  resolves_at timestamptz NOT NULL,
  evidence    jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now(),
  outcome     boolean,
  resolved_at timestamptz,
  resolved_by text,
  brier       double precision GENERATED ALWAYS AS
                (CASE WHEN outcome IS NULL THEN NULL ELSE power(probability - CASE WHEN outcome THEN 1 ELSE 0 END, 2) END) STORED,
  CHECK (resolves_at > created_at)
);

CREATE VIEW mem.calibration AS
  SELECT agent, count(*) FILTER (WHERE outcome IS NOT NULL) AS resolved, count(*) FILTER (WHERE outcome IS NULL) AS open,
         round(avg(brier)::numeric, 4) AS brier,                         -- 0 = perfect, 0.25 = coin flip
         round((1 - avg(brier) / 0.25)::numeric, 3) AS skill_vs_coin      -- > 0 beats always saying 50%
  FROM mem.forecasts GROUP BY agent;

-- ── Writing ──────────────────────────────────────────────────────────────
CREATE FUNCTION mem.log_episode(p_agent text, p_summary text, p_detail jsonb DEFAULT '{}', p_trust text DEFAULT 'agent',
                                p_run uuid DEFAULT NULL, p_evidence jsonb DEFAULT '[]', p_user text DEFAULT 'owner')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, nerve, pg_temp AS $$
DECLARE ev bigint; id bigint;
BEGIN
  IF mem.looks_secret(p_summary) OR mem.looks_secret(p_detail::text) THEN
    PERFORM nerve._emit('system', 'guard.secret_refused', 'system', jsonb_build_object('agent', p_agent, 'where', 'episode'));
    RAISE WARNING 'refused: looks like a secret (nothing stored)';
    RETURN NULL;                         -- no exception, so the refusal stays in the log
  END IF;
  IF nerve.caller_is_agent() AND p_trust NOT IN ('agent', 'tainted') THEN RAISE EXCEPTION 'agents log with agent or tainted trust'; END IF;
  ev := nerve._emit(p_agent, 'memory.episode', CASE WHEN p_agent IN ('owner', 'system') THEN p_agent ELSE
                    CASE WHEN p_trust = 'tainted' THEN 'tainted' ELSE 'agent' END END,
                    jsonb_build_object('summary', left(p_summary, 200)), '[]', p_run);
  INSERT INTO mem.episodes (user_id, agent, run_id, summary, detail, trust, evidence, event_id)
  VALUES (p_user, p_agent, p_run, p_summary, coalesce(p_detail, '{}'), p_trust, coalesce(p_evidence, '[]'), ev)
  RETURNING episodes.id INTO id;
  RETURN id;
END $$;

-- Assert a belief. Same subject+predicate with the same object = confirmation (more sources);
-- a different object = the old row is superseded (kept, with its dates) and the new one becomes current.
CREATE FUNCTION mem.assert_fact(p_by text, p_subject text, p_predicate text, p_object text, p_statement text,
                                p_evidence jsonb, p_confidence real DEFAULT 0.7, p_source_trust text DEFAULT 'agent',
                                p_valid_from timestamptz DEFAULT NULL, p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, nerve, pg_temp AS $$
DECLARE gate jsonb; cur mem.facts; new_id bigint; new_urls int; when_true timestamptz := coalesce(p_valid_from, now());
BEGIN
  gate := nerve.tool_call(p_by, 'memory.write', 'agent', jsonb_build_object('subject', p_subject, 'predicate', p_predicate), p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'memory write refused: %', gate ->> 'reason'; END IF;
  IF mem.looks_secret(p_statement) OR mem.looks_secret(p_object) OR mem.looks_secret(p_subject) THEN
    PERFORM nerve._emit('system', 'guard.secret_refused', 'system', jsonb_build_object('agent', p_by, 'where', 'fact'));
    RAISE WARNING 'refused: looks like a secret (nothing stored)';
    RETURN NULL;                         -- no exception, so the refusal stays in the log
  END IF;
  IF NOT mem.valid_evidence(p_evidence) THEN RAISE EXCEPTION 'a fact needs evidence: a list of {url} or {event} items'; END IF;

  SELECT * INTO cur FROM mem.facts
  WHERE user_id = p_user AND lower(subject) = lower(p_subject) AND lower(predicate) = lower(p_predicate) AND superseded_at IS NULL
  FOR UPDATE;

  IF FOUND AND lower(cur.object) = lower(p_object) THEN
    -- Confirmation: count only evidence urls/events we did not have.
    SELECT count(*) INTO new_urls FROM jsonb_array_elements(p_evidence) n
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cur.evidence) o WHERE o = n);
    UPDATE mem.facts SET
      evidence   = CASE WHEN new_urls > 0 THEN (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(cur.evidence || p_evidence) x) ELSE evidence END,
      sources    = sources + new_urls,
      confidence = greatest(confidence, p_confidence),
      -- an independent source confirms; a tainted confirmation of a tainted claim still counts as a second source
      status     = CASE WHEN sources + new_urls >= 2 THEN 'verified' ELSE status END
    WHERE id = cur.id;
    PERFORM nerve._emit(p_by, 'memory.confirmed', 'agent', jsonb_build_object('fact', cur.id, 'new_sources', new_urls), p_evidence, p_run);
    RETURN cur.id;
  END IF;

  IF cur.id IS NOT NULL THEN
    -- A different belief about the same thing: close the old row (kept, with its dates), then insert the new one.
    UPDATE mem.facts SET superseded_at = now(), valid_to = coalesce(valid_to, when_true) WHERE id = cur.id;
  END IF;
  INSERT INTO mem.facts (user_id, subject, predicate, object, statement, confidence, status, evidence, source_trust, written_by, valid_from)
  VALUES (p_user, p_subject, p_predicate, p_object, p_statement, p_confidence,
          CASE WHEN p_source_trust = 'tainted' THEN 'unverified' ELSE 'verified' END,
          p_evidence, p_source_trust, p_by, when_true)
  RETURNING id INTO new_id;
  IF cur.id IS NOT NULL THEN
    UPDATE mem.facts SET superseded_by = new_id WHERE id = cur.id;
    IF cur.confidence >= 0.8 THEN          -- a strong belief was overturned: بدر should look
      PERFORM nerve._emit(p_by, 'memory.contradiction', 'agent',
        jsonb_build_object('old_fact', cur.id, 'old', cur.statement, 'new_fact', new_id, 'new', p_statement), p_evidence, p_run);
    END IF;
  END IF;
  PERFORM nerve._emit(p_by, 'memory.fact', 'agent',
    jsonb_build_object('fact', new_id, 'subject', p_subject, 'predicate', p_predicate,
                       'status', CASE WHEN p_source_trust = 'tainted' THEN 'unverified' ELSE 'verified' END), p_evidence, p_run);
  RETURN new_id;
END $$;

CREATE FUNCTION mem.save_skill(p_by text, p_name text, p_description text, p_steps jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, nerve, pg_temp AS $$
DECLARE gate jsonb;
BEGIN
  gate := nerve.tool_call(p_by, 'memory.write', 'agent', jsonb_build_object('skill', p_name));
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'memory write refused: %', gate ->> 'reason'; END IF;
  IF mem.looks_secret(p_description) OR mem.looks_secret(p_steps::text) THEN RAISE EXCEPTION 'refused: looks like a secret'; END IF;
  INSERT INTO mem.skills (name, description, steps) VALUES (p_name, p_description, p_steps)
  ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, steps = EXCLUDED.steps,
                                   reviewed_by = NULL, status = 'draft', updated_at = now();   -- changed = review again
  PERFORM nerve._emit(p_by, 'memory.skill', 'agent', jsonb_build_object('skill', p_name, 'status', 'draft'));
END $$;

CREATE FUNCTION mem.review_skill(p_by text, p_name text, p_ok boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, nerve, pg_temp AS $$
BEGIN
  IF p_by NOT IN ('badr', 'owner') THEN RAISE EXCEPTION 'only بدر or the owner reviews skills'; END IF;
  IF p_by = 'owner' AND nerve.caller_is_agent() THEN RAISE EXCEPTION 'an agent cannot act as the owner'; END IF;
  UPDATE mem.skills SET reviewed_by = p_by, status = CASE WHEN p_ok THEN 'active' ELSE 'retired' END, updated_at = now() WHERE name = p_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown skill %', p_name; END IF;
  PERFORM nerve._emit(p_by, 'memory.skill_reviewed', CASE WHEN p_by = 'owner' THEN 'owner' ELSE 'agent' END,
                      jsonb_build_object('skill', p_name, 'ok', p_ok));
END $$;

CREATE FUNCTION mem.skill_used(p_name text, p_success boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = mem, pg_temp AS $$
  UPDATE mem.skills SET uses = uses + 1, successes = successes + (p_success)::int, updated_at = now()
  WHERE name = p_name AND status = 'active'
$$;

CREATE FUNCTION mem.forecast(p_agent text, p_claim text, p_probability real, p_resolves_at timestamptz, p_evidence jsonb DEFAULT '[]')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, nerve, pg_temp AS $$
DECLARE id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nerve.agents a WHERE a.id = p_agent) THEN RAISE EXCEPTION 'unknown agent %', p_agent; END IF;
  INSERT INTO mem.forecasts (agent, claim, probability, resolves_at, evidence)
  VALUES (p_agent, p_claim, p_probability, p_resolves_at, coalesce(p_evidence, '[]')) RETURNING forecasts.id INTO id;
  PERFORM nerve._emit(p_agent, 'memory.forecast', 'agent', jsonb_build_object('forecast', id, 'claim', left(p_claim, 200), 'p', p_probability));
  RETURN id;
END $$;

-- Grading is never done by the agent that made the forecast.
CREATE FUNCTION mem.resolve_forecast(p_by text, p_id bigint, p_outcome boolean, p_evidence jsonb)
RETURNS double precision LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, nerve, pg_temp AS $$
DECLARE f mem.forecasts;
BEGIN
  IF p_by = 'owner' AND nerve.caller_is_agent() THEN RAISE EXCEPTION 'an agent cannot act as the owner'; END IF;
  IF NOT mem.valid_evidence(p_evidence) THEN RAISE EXCEPTION 'resolving needs evidence'; END IF;
  SELECT * INTO f FROM mem.forecasts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown forecast %', p_id; END IF;
  IF f.agent = p_by THEN RAISE EXCEPTION 'an agent cannot grade its own forecast'; END IF;
  IF f.outcome IS NOT NULL THEN RAISE EXCEPTION 'forecast % is already resolved', p_id; END IF;
  UPDATE mem.forecasts SET outcome = p_outcome, resolved_at = now(), resolved_by = p_by, evidence = evidence || p_evidence
  WHERE id = p_id RETURNING * INTO f;
  PERFORM nerve._emit(CASE WHEN p_by IN ('owner', 'system') THEN p_by ELSE p_by END, 'memory.resolved',
                      CASE WHEN p_by IN ('owner', 'system') THEN p_by ELSE 'agent' END,
                      jsonb_build_object('forecast', p_id, 'outcome', p_outcome, 'brier', f.brier), p_evidence);
  RETURN f.brier;
END $$;

-- ── Recall ───────────────────────────────────────────────────────────────
-- Hybrid search over current facts (or the facts believed at p_as_of) and episodes.
-- Each signal ranks the candidates; scores are 1/(60+rank) summed (RRF), plus a small recency term,
-- times 0.8 for unverified facts and 0.9 for archived episodes.
CREATE FUNCTION mem.search(p_query text, p_embedding real[] DEFAULT NULL, p_k integer DEFAULT 10,
                           p_user text DEFAULT 'owner', p_as_of timestamptz DEFAULT NULL)
RETURNS TABLE (kind text, id bigint, text text, score double precision, status text, evidence jsonb, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mem, pg_temp AS $$
  WITH q AS (
    SELECT CASE WHEN tq::text = '' THEN NULL ELSE replace(tq::text, ' & ', ' | ')::tsquery END AS tq
    FROM (SELECT plainto_tsquery('simple'::regconfig, coalesce(p_query, '')) AS tq) z
  ), c AS (
    SELECT 'fact'::text AS kind, f.id, f.statement AS text, f.search, f.embedding, f.recorded_at AS at, f.status, f.evidence
    FROM mem.facts f
    WHERE f.user_id = p_user
      AND (CASE WHEN p_as_of IS NULL THEN f.superseded_at IS NULL
                ELSE f.recorded_at <= p_as_of AND (f.superseded_at IS NULL OR f.superseded_at > p_as_of) END)
    UNION ALL
    SELECT 'episode', e.id, e.summary, e.search, e.embedding, e.created_at,
           CASE WHEN e.archived THEN 'archived' ELSE 'episode' END, e.evidence
    FROM mem.episodes e
    WHERE e.user_id = p_user AND (p_as_of IS NULL OR e.created_at <= p_as_of)
  ), s AS (
    SELECT c.*, CASE WHEN q.tq IS NOT NULL AND c.search @@ q.tq THEN ts_rank(c.search, q.tq) END AS fts,
           CASE WHEN p_embedding IS NOT NULL AND c.embedding IS NOT NULL THEN mem.cosine(c.embedding, p_embedding) END AS sim
    FROM c, q
  ), r AS (
    SELECT s.*,
           CASE WHEN fts IS NOT NULL THEN rank() OVER (ORDER BY fts DESC NULLS LAST) END AS r_fts,
           CASE WHEN sim >= 0.25 THEN rank() OVER (ORDER BY sim DESC NULLS LAST) END AS r_sim,
           rank() OVER (ORDER BY at DESC) AS r_new
    FROM s
  )
  SELECT kind, id, text,
         (coalesce(1.0 / (60 + r_fts), 0) + coalesce(1.0 / (60 + r_sim), 0) + 0.3 / (60 + r_new))
           * CASE status WHEN 'unverified' THEN 0.8 WHEN 'archived' THEN 0.9 ELSE 1 END AS score,
         status, evidence, at
  FROM r
  WHERE r_fts IS NOT NULL OR r_sim IS NOT NULL
  ORDER BY score DESC, at DESC
  LIMIT least(greatest(p_k, 1), 50)
$$;

-- ── Upkeep (the ameen worker) ────────────────────────────────────────────
CREATE FUNCTION mem.pending_embeddings(p_limit integer DEFAULT 50)
RETURNS TABLE (kind text, id bigint, text text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mem, pg_temp AS $$
  (SELECT 'fact', f.id, f.statement FROM mem.facts f WHERE f.embedding IS NULL ORDER BY f.id LIMIT p_limit)
  UNION ALL
  (SELECT 'episode', e.id, e.summary FROM mem.episodes e WHERE e.embedding IS NULL ORDER BY e.id LIMIT p_limit)
$$;

CREATE FUNCTION mem.set_embedding(p_kind text, p_id bigint, p_vec real[], p_model text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, pg_temp AS $$
BEGIN
  IF p_kind = 'fact' THEN UPDATE mem.facts SET embedding = p_vec, embed_model = p_model WHERE id = p_id;
  ELSIF p_kind = 'episode' THEN UPDATE mem.episodes SET embedding = p_vec, embed_model = p_model WHERE id = p_id;
  ELSE RAISE EXCEPTION 'unknown kind %', p_kind; END IF;
END $$;

-- Nightly "sleep": archive old episodes, retire skills that keep failing, report open contradictions and
-- overdue forecasts. The language parts (summaries, merges) run in the worker on the local model.
CREATE FUNCTION mem.sleep(p_archive_after interval DEFAULT '30 days')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, nerve, pg_temp AS $$
DECLARE n_archived int; n_retired int; out jsonb;
BEGIN
  UPDATE mem.episodes SET archived = true WHERE NOT archived AND created_at < now() - p_archive_after;
  GET DIAGNOSTICS n_archived = ROW_COUNT;
  UPDATE mem.skills SET status = 'retired', updated_at = now()
  WHERE status = 'active' AND uses >= 5 AND successes::real / uses < 0.5;
  GET DIAGNOSTICS n_retired = ROW_COUNT;
  out := jsonb_build_object(
    'episodes_archived', n_archived,
    'skills_retired', n_retired,
    'facts_current', (SELECT count(*) FROM mem.facts WHERE superseded_at IS NULL),
    'facts_unverified', (SELECT count(*) FROM mem.facts WHERE superseded_at IS NULL AND status = 'unverified'),
    'contradictions_24h', (SELECT count(*) FROM nerve.events WHERE kind = 'memory.contradiction' AND ts > now() - interval '24 hours'),
    'forecasts_overdue', (SELECT count(*) FROM mem.forecasts WHERE outcome IS NULL AND resolves_at < now()),
    'unembedded', (SELECT count(*) FROM mem.pending_embeddings(1000)));
  PERFORM nerve._emit('ameen', 'memory.sleep', 'agent', out);
  RETURN out;
END $$;

-- The user's right to delete their own memories (owner only).
CREATE FUNCTION mem.forget_user(p_user text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = mem, nerve, pg_temp AS $$
DECLARE f int; e int;
BEGIN
  PERFORM set_config('mem.forgetting', 'on', true);
  UPDATE mem.facts SET superseded_by = NULL WHERE user_id = p_user;
  DELETE FROM mem.facts WHERE user_id = p_user; GET DIAGNOSTICS f = ROW_COUNT;
  DELETE FROM mem.episodes WHERE user_id = p_user; GET DIAGNOSTICS e = ROW_COUNT;
  PERFORM set_config('mem.forgetting', 'off', true);
  PERFORM nerve._emit('owner', 'human.forgot', 'owner', jsonb_build_object('user', p_user, 'facts', f, 'episodes', e));
  RETURN jsonb_build_object('facts', f, 'episodes', e);
END $$;

-- ── Permissions ──────────────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA mem FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mem FROM PUBLIC;
GRANT USAGE ON SCHEMA mem TO nerve_agent, mem_keeper;
GRANT EXECUTE ON FUNCTION mem.log_episode(text, text, jsonb, text, uuid, jsonb, text),
                          mem.assert_fact(text, text, text, text, text, jsonb, real, text, timestamptz, text, uuid),
                          mem.save_skill(text, text, text, jsonb), mem.review_skill(text, text, boolean),
                          mem.skill_used(text, boolean), mem.forecast(text, text, real, timestamptz, jsonb),
                          mem.resolve_forecast(text, bigint, boolean, jsonb),
                          mem.search(text, real[], integer, text, timestamptz) TO nerve_agent;
GRANT EXECUTE ON FUNCTION mem.pending_embeddings(integer), mem.set_embedding(text, bigint, real[], text),
                          mem.sleep(interval) TO mem_keeper;
GRANT nerve_agent TO mem_keeper;
-- mem.forget_user stays with the owner (admin role) only.

-- ── Read-only views for the Ops Room ─────────────────────────────────────
CREATE VIEW api.mem_facts AS
  SELECT id, subject, predicate, object, statement, confidence, status, sources, recorded_at, valid_from
  FROM mem.facts WHERE superseded_at IS NULL AND user_id = 'owner' ORDER BY recorded_at DESC LIMIT 200;
CREATE VIEW api.mem_calibration AS SELECT * FROM mem.calibration;
CREATE VIEW api.mem_stats AS
  SELECT (SELECT count(*) FROM mem.facts WHERE superseded_at IS NULL) AS facts,
         (SELECT count(*) FROM mem.facts WHERE superseded_at IS NOT NULL) AS superseded,
         (SELECT count(*) FROM mem.episodes) AS episodes,
         (SELECT count(*) FROM mem.skills WHERE status = 'active') AS skills,
         (SELECT count(*) FROM mem.forecasts) AS forecasts,
         (SELECT max(ts) FROM nerve.events WHERE kind = 'memory.sleep') AS last_sleep;
GRANT SELECT ON api.mem_facts, api.mem_calibration, api.mem_stats TO web_anon;
SQL
echo "memory schema created"
else
  echo "memory schema already present"
fi

# The worker's login: only when a password is set (set AMEEN_DB_PASSWORD in .env, then `--profile memory`).
if [ -n "${AMEEN_DB_PASSWORD:-}" ]; then
  $PSQL -v pw="$AMEEN_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE ameen LOGIN PASSWORD %L IN ROLE mem_keeper', :'pw') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ameen')
\gexec
SQL
fi

#!/bin/sh
# The second brain (ADR-081, design docs/agents/ARCHITECTURE-AGENTS.md section 12). Needs 05-nerve.sh and 06-memory.sh.
#   brain.raw     every capture, verbatim, never edited (only the owner can forget it)
#   brain.nodes   atoms: one idea, question, task, fact, worry, decision, quote or source each, linked to its raw note
#   brain.edges   links with an origin (human | machine), a confidence, a one-line why and a state. Machine links
#                 start 'suggested' and wait for the owner; rejected ones are never suggested again
#   brain.clusters themes (named by the worker); brain.settings the thresholds the owner's taps tune
# Privacy: this graph is private and separate from the agents' memory (mem.*). Agents reach it only through the
# gated functions below (tools brain.read / brain.write / brain.link); no table is granted to any agent. Nothing
# here can feed a trading proposal: fahd (proposals.add) does not hold brain.read, and ameen cannot add proposals.
# Events never carry the owner's words, only ids and counts (the event log is published read-only by the relay).
set -eu

PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

if ! $PSQL -tA -c "SELECT 1 FROM pg_namespace WHERE nspname = 'brain'" | grep -q 1; then
$PSQL --single-transaction <<'SQL'
CREATE SCHEMA brain;
-- The event log gets one more family of kinds: brain.* (ids and counts only, never the owner's words).
ALTER TABLE nerve.events DROP CONSTRAINT events_kind_check;
ALTER TABLE nerve.events ADD CONSTRAINT events_kind_check
  CHECK (kind ~ '^(signal|task|tool|memory|proposal|human|guard|agent|brain)\.[a-z_]+$');

-- ── Tables ───────────────────────────────────────────────────────────────
CREATE TABLE brain.raw (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL DEFAULT 'owner',
  text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 20000),
  source      text NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice', 'link', 'file', 'screenshot')),
  source_url  text CHECK (source_url IS NULL OR source_url ~ '^https?://'),
  cloud_ok    boolean NOT NULL DEFAULT false,          -- the owner marked this note "ok for cloud"; default is local only
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE brain.clusters (
  user_id     text NOT NULL DEFAULT 'owner',
  key         int NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  size        int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE brain.nodes (
  id          bigserial PRIMARY KEY,
  raw_id      bigint NOT NULL REFERENCES brain.raw (id),
  user_id     text NOT NULL DEFAULT 'owner',
  text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  type        text NOT NULL CHECK (type IN ('idea', 'question', 'task', 'fact', 'worry', 'decision', 'quote', 'source')),
  entities    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(entities) <= 20),
  embedding   real[] CHECK (embedding IS NULL OR cardinality(embedding) BETWEEN 8 AND 4096),
  embed_model text,
  cluster     int,
  captured_at timestamptz NOT NULL DEFAULT now(),
  search      tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, text)) STORED
);
CREATE INDEX brain_nodes_search ON brain.nodes USING gin (search);
CREATE INDEX brain_nodes_user_time ON brain.nodes (user_id, captured_at);

CREATE TABLE brain.edges (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL DEFAULT 'owner',
  src         bigint NOT NULL REFERENCES brain.nodes (id) ON DELETE CASCADE,
  dst         bigint NOT NULL REFERENCES brain.nodes (id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('similar_to', 'supports', 'contradicts', 'leads_to', 'part_of',
                                            'answers', 'derived_from', 'mentions', 'links_to')),
  origin      text NOT NULL CHECK (origin IN ('human', 'machine')),
  confidence  real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  why         text NOT NULL DEFAULT '' CHECK (length(why) <= 300),
  state       text NOT NULL DEFAULT 'accepted' CHECK (state IN ('suggested', 'accepted', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  CHECK (src <> dst),
  CHECK (origin = 'machine' OR state = 'accepted'),          -- what the owner typed is solid from the start
  CHECK (type <> 'similar_to' OR src < dst),                 -- symmetric links are stored once
  UNIQUE (src, dst, type)                                    -- a rejected link is never suggested again
);
CREATE INDEX brain_edges_user ON brain.edges (user_id, state);

CREATE TABLE brain.settings (
  user_id    text NOT NULL DEFAULT 'owner',
  key        text NOT NULL,
  value      real NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
INSERT INTO brain.settings (user_id, key, value) VALUES ('owner', 'similar_min', 0.55);

-- ── Guards: append-only, except that the owner can forget (mirrors mem.forget_user) ──
CREATE FUNCTION brain.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('brain.forgetting', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'the second brain is append-only (%)', TG_OP;
END $$;
CREATE TRIGGER raw_guard BEFORE UPDATE OR DELETE ON brain.raw FOR EACH ROW EXECUTE FUNCTION brain.refuse_change();
CREATE TRIGGER raw_truncate BEFORE TRUNCATE ON brain.raw FOR EACH STATEMENT EXECUTE FUNCTION brain.refuse_change();

-- An atom's words, type and source never change; only its cluster and its embedding are recomputed.
CREATE FUNCTION brain.guard_nodes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('brain.forgetting', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'the second brain is append-only (DELETE)';
  END IF;
  IF NEW.text IS DISTINCT FROM OLD.text OR NEW.raw_id <> OLD.raw_id OR NEW.type <> OLD.type
     OR NEW.user_id <> OLD.user_id OR NEW.captured_at <> OLD.captured_at THEN
    RAISE EXCEPTION 'a captured thought is never rewritten';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER nodes_guard BEFORE UPDATE OR DELETE ON brain.nodes FOR EACH ROW EXECUTE FUNCTION brain.guard_nodes();

-- A link's meaning is fixed; only a suggestion can be accepted or rejected, and that decision is final.
CREATE FUNCTION brain.guard_edges() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('brain.forgetting', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'the second brain is append-only (DELETE)';
  END IF;
  IF NEW.src <> OLD.src OR NEW.dst <> OLD.dst OR NEW.type <> OLD.type OR NEW.origin <> OLD.origin
     OR NEW.user_id <> OLD.user_id OR NEW.confidence <> OLD.confidence OR NEW.why <> OLD.why THEN
    RAISE EXCEPTION 'a link keeps its meaning; decide it instead';
  END IF;
  IF OLD.state <> 'suggested' AND NEW.state <> OLD.state THEN RAISE EXCEPTION 'a decided link is final'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER edges_guard BEFORE UPDATE OR DELETE ON brain.edges FOR EACH ROW EXECUTE FUNCTION brain.guard_edges();

-- ── Gate helpers ─────────────────────────────────────────────────────────
-- An agent may only act as its own login (no agent writes the brain under another name).
CREATE FUNCTION brain.guard_session(p_by text) RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF nerve.caller_is_agent() AND p_by IS DISTINCT FROM session_user THEN
    RAISE EXCEPTION 'an agent may only act as itself (% is not %)', session_user, p_by;
  END IF;
END $$;

-- ── Writing (tool brain.write: capture and atoms; ameen only) ────────────
CREATE FUNCTION brain.capture(p_by text, p_text text, p_source text DEFAULT 'text', p_source_url text DEFAULT NULL,
                              p_cloud_ok boolean DEFAULT false, p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = brain, nerve, mem, pg_temp AS $$
DECLARE gate jsonb; rid bigint;
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.write', 'agent', jsonb_build_object('source', p_source), p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain write refused: %', gate ->> 'reason'; END IF;
  IF mem.looks_secret(p_text) OR mem.looks_secret(p_source_url) THEN
    PERFORM nerve._emit('system', 'guard.secret_refused', 'system', jsonb_build_object('agent', p_by, 'where', 'brain.raw'));
    RAISE WARNING 'refused: looks like a secret (nothing stored)';
    RETURN NULL;                         -- no exception, so the refusal stays in the log
  END IF;
  INSERT INTO brain.raw (user_id, text, source, source_url, cloud_ok)
  VALUES (p_user, p_text, p_source, p_source_url, coalesce(p_cloud_ok, false)) RETURNING id INTO rid;
  PERFORM nerve._emit(p_by, 'brain.captured', 'agent', jsonb_build_object('raw', rid, 'source', p_source), '[]', p_run);
  RETURN rid;
END $$;

CREATE FUNCTION brain.add_node(p_by text, p_raw bigint, p_text text, p_type text, p_entities text[], p_embedding real[],
                               p_model text, p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = brain, nerve, mem, pg_temp AS $$
DECLARE gate jsonb; nid bigint;
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.write', 'agent', jsonb_build_object('type', p_type), p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain write refused: %', gate ->> 'reason'; END IF;
  IF mem.looks_secret(p_text) THEN
    PERFORM nerve._emit('system', 'guard.secret_refused', 'system', jsonb_build_object('agent', p_by, 'where', 'brain.nodes'));
    RAISE WARNING 'refused: looks like a secret (nothing stored)';
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM brain.raw WHERE id = p_raw AND user_id = p_user) THEN RAISE EXCEPTION 'unknown note %', p_raw; END IF;
  INSERT INTO brain.nodes (raw_id, user_id, text, type, entities, embedding, embed_model)
  VALUES (p_raw, p_user, p_text, p_type, coalesce(p_entities, '{}'), p_embedding, p_model) RETURNING id INTO nid;
  PERFORM nerve._emit(p_by, 'brain.atom', 'agent', jsonb_build_object('node', nid, 'type', p_type), '[]', p_run);
  RETURN nid;
END $$;

-- A link the owner typed himself ([[wikilink]]): solid from the start.
CREATE FUNCTION brain.add_human_edge(p_by text, p_src bigint, p_dst bigint, p_type text, p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = brain, nerve, pg_temp AS $$
DECLARE gate jsonb; eid bigint; a bigint := least(p_src, p_dst); b bigint := greatest(p_src, p_dst);
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.write', 'agent', jsonb_build_object('type', p_type), p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain write refused: %', gate ->> 'reason'; END IF;
  IF (SELECT count(*) FROM brain.nodes WHERE id IN (p_src, p_dst) AND user_id = p_user) <> 2 OR p_src = p_dst THEN
    RAISE EXCEPTION 'both ends must be your own atoms';
  END IF;
  INSERT INTO brain.edges (user_id, src, dst, type, origin, state)
  VALUES (p_user, CASE WHEN p_type = 'similar_to' THEN a ELSE p_src END, CASE WHEN p_type = 'similar_to' THEN b ELSE p_dst END,
          p_type, 'human', 'accepted')
  ON CONFLICT (src, dst, type) DO NOTHING RETURNING id INTO eid;
  RETURN eid;
END $$;

-- ── Links (tool brain.link: the worker suggests; the owner's taps decide) ──
CREATE FUNCTION brain.suggest_edge(p_by text, p_src bigint, p_dst bigint, p_type text, p_confidence real, p_why text,
                                   p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = brain, nerve, mem, pg_temp AS $$
DECLARE gate jsonb; eid bigint; a bigint := least(p_src, p_dst); b bigint := greatest(p_src, p_dst);
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.link', 'agent', jsonb_build_object('type', p_type), p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain link refused: %', gate ->> 'reason'; END IF;
  IF mem.looks_secret(p_why) THEN
    PERFORM nerve._emit('system', 'guard.secret_refused', 'system', jsonb_build_object('agent', p_by, 'where', 'brain.edges'));
    RAISE WARNING 'refused: looks like a secret (nothing stored)';
    RETURN NULL;
  END IF;
  IF p_src = p_dst OR (SELECT count(*) FROM brain.nodes WHERE id IN (p_src, p_dst) AND user_id = p_user) <> 2 THEN
    RAISE EXCEPTION 'both ends must be your own atoms';
  END IF;
  INSERT INTO brain.edges (user_id, src, dst, type, origin, confidence, why, state)
  VALUES (p_user, CASE WHEN p_type = 'similar_to' THEN a ELSE p_src END, CASE WHEN p_type = 'similar_to' THEN b ELSE p_dst END,
          p_type, 'machine', p_confidence, left(coalesce(p_why, ''), 300), 'suggested')
  ON CONFLICT (src, dst, type) DO NOTHING RETURNING id INTO eid;
  IF eid IS NOT NULL THEN
    PERFORM nerve._emit(p_by, 'brain.suggested', 'agent', jsonb_build_object('edge', eid, 'type', p_type, 'confidence', p_confidence), '[]', p_run);
  END IF;
  RETURN eid;
END $$;

-- The owner's tap. Accepting a similarity lowers the threshold a little, rejecting raises it (the linker learns taste).
CREATE FUNCTION brain.decide_edge(p_by text, p_edge bigint, p_decision text, p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = brain, nerve, pg_temp AS $$
DECLARE gate jsonb; t text;
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.link', 'agent', jsonb_build_object('decision', p_decision), p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain link refused: %', gate ->> 'reason'; END IF;
  IF p_decision NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION 'decision must be accepted or rejected'; END IF;
  UPDATE brain.edges SET state = p_decision, decided_at = now()
  WHERE id = p_edge AND user_id = p_user AND origin = 'machine' AND state = 'suggested'
  RETURNING type INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION 'no suggested link % to decide', p_edge; END IF;
  IF t = 'similar_to' THEN
    UPDATE brain.settings SET value = CASE WHEN p_decision = 'accepted' THEN greatest(0.30, value - 0.01)
                                           ELSE least(0.90, value + 0.02) END, updated_at = now()
    WHERE user_id = p_user AND key = 'similar_min';
  END IF;
  PERFORM nerve._emit(p_by, 'brain.decided', 'agent', jsonb_build_object('edge', p_edge, 'decision', p_decision), '[]', p_run);
END $$;

-- Clusters: the worker's nightly names and groups replace the previous ones for this user.
CREATE FUNCTION brain.apply_clusters(p_by text, p_clusters jsonb, p_assign jsonb, p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = brain, nerve, pg_temp AS $$
DECLARE gate jsonb; n int;
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.link', 'agent', '{}', p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain link refused: %', gate ->> 'reason'; END IF;
  DELETE FROM brain.clusters WHERE user_id = p_user;
  INSERT INTO brain.clusters (user_id, key, name, size)
  SELECT p_user, c.key, c.name, c.size FROM jsonb_to_recordset(coalesce(p_clusters, '[]')) AS c (key int, name text, size int);
  UPDATE brain.nodes n SET cluster = a.cluster FROM jsonb_to_recordset(coalesce(p_assign, '[]')) AS a (id bigint, cluster int)
  WHERE n.id = a.id AND n.user_id = p_user;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM nerve._emit(p_by, 'brain.clustered', 'agent', jsonb_build_object('nodes', n, 'clusters', jsonb_array_length(coalesce(p_clusters, '[]'))), '[]', p_run);
  RETURN n;
END $$;

-- ── Reading (tool brain.read: owner's own graph; never shared) ───────────
-- The whole graph for the map and the linker: atoms (with their text and embeddings), live links, clusters, thresholds.
CREATE FUNCTION brain.snapshot(p_by text, p_user text DEFAULT 'owner', p_limit int DEFAULT 5000, p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = brain, nerve, pg_temp AS $$
DECLARE gate jsonb;
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.read', 'agent', '{}', p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain read refused: %', gate ->> 'reason'; END IF;
  RETURN jsonb_build_object(
    'nodes', coalesce((SELECT jsonb_agg(x ORDER BY x.captured_at) FROM (
        SELECT n.id, n.raw_id, n.text, n.type, n.entities, n.embedding, n.cluster, n.captured_at, r.source, r.source_url
        FROM brain.nodes n JOIN brain.raw r ON r.id = n.raw_id
        WHERE n.user_id = p_user ORDER BY n.captured_at DESC LIMIT least(greatest(p_limit, 1), 20000)) x), '[]'::jsonb),
    'edges', coalesce((SELECT jsonb_agg(e) FROM brain.edges e WHERE e.user_id = p_user AND e.state <> 'rejected'), '[]'::jsonb),
    'clusters', coalesce((SELECT jsonb_agg(c) FROM brain.clusters c WHERE c.user_id = p_user), '[]'::jsonb),
    'settings', coalesce((SELECT jsonb_object_agg(s.key, s.value) FROM brain.settings s WHERE s.user_id = p_user), '{}'::jsonb));
END $$;

-- Evidence for one atom: the verbatim note it came from.
CREATE FUNCTION brain.evidence(p_by text, p_node bigint, p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = brain, nerve, pg_temp AS $$
DECLARE gate jsonb; out jsonb;
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.read', 'agent', '{}', p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain read refused: %', gate ->> 'reason'; END IF;
  SELECT jsonb_build_object('raw', r.text, 'source', r.source, 'source_url', r.source_url, 'captured_at', r.captured_at, 'cloud_ok', r.cloud_ok)
    INTO out FROM brain.nodes n JOIN brain.raw r ON r.id = n.raw_id WHERE n.id = p_node AND n.user_id = p_user;
  RETURN out;
END $$;

-- Hybrid search over the owner's atoms: words + meaning + recency, merged by reciprocal rank fusion (as mem.search).
CREATE FUNCTION brain.search(p_by text, p_query text, p_embedding real[] DEFAULT NULL, p_k int DEFAULT 10,
                             p_user text DEFAULT 'owner', p_run uuid DEFAULT NULL)
RETURNS TABLE (id bigint, text text, type text, cluster int, score double precision, captured_at timestamptz, raw_id bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = brain, nerve, mem, pg_temp AS $$
DECLARE gate jsonb; tq tsquery;
BEGIN
  PERFORM brain.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'brain.read', 'agent', jsonb_build_object('k', p_k), p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'brain read refused: %', gate ->> 'reason'; END IF;
  SELECT CASE WHEN q.t::text = '' THEN NULL ELSE replace(q.t::text, ' & ', ' | ')::tsquery END INTO tq
  FROM (SELECT plainto_tsquery('simple'::regconfig, coalesce(p_query, '')) AS t) q;
  RETURN QUERY
  WITH s AS (
    SELECT n.id, n.text, n.type, n.cluster, n.captured_at, n.raw_id,
           CASE WHEN tq IS NOT NULL AND n.search @@ tq THEN ts_rank(n.search, tq) END AS fts,
           CASE WHEN p_embedding IS NOT NULL AND n.embedding IS NOT NULL THEN mem.cosine(n.embedding, p_embedding) END AS sim
    FROM brain.nodes n WHERE n.user_id = p_user
  ), r AS (
    SELECT s.*,
           CASE WHEN s.fts IS NOT NULL THEN rank() OVER (ORDER BY s.fts DESC NULLS LAST) END AS r_fts,
           CASE WHEN s.sim >= 0.25 THEN rank() OVER (ORDER BY s.sim DESC NULLS LAST) END AS r_sim,
           rank() OVER (ORDER BY s.captured_at DESC) AS r_new
    FROM s
  )
  SELECT r.id, r.text, r.type, r.cluster,
         (coalesce(1.0 / (60 + r.r_fts), 0) + coalesce(1.0 / (60 + r.r_sim), 0) + 0.3 / (60 + r.r_new))::double precision AS score,
         r.captured_at, r.raw_id
  FROM r WHERE r.r_fts IS NOT NULL OR r.r_sim IS NOT NULL
  ORDER BY score DESC, r.captured_at DESC
  LIMIT least(greatest(p_k, 1), 50);
END $$;

-- ── The owner's right to forget (owner only; agents cannot run it) ───────
CREATE FUNCTION brain.forget_user(p_user text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = brain, nerve, pg_temp AS $$
DECLARE e int; n int; r int;
BEGIN
  IF nerve.caller_is_agent() THEN RAISE EXCEPTION 'only the owner can forget the second brain'; END IF;
  PERFORM set_config('brain.forgetting', 'on', true);
  DELETE FROM brain.edges WHERE user_id = p_user; GET DIAGNOSTICS e = ROW_COUNT;
  DELETE FROM brain.nodes WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM brain.raw WHERE user_id = p_user; GET DIAGNOSTICS r = ROW_COUNT;
  DELETE FROM brain.clusters WHERE user_id = p_user;
  DELETE FROM brain.settings WHERE user_id = p_user;
  PERFORM set_config('brain.forgetting', 'off', true);
  PERFORM nerve._emit('owner', 'human.forgot', 'owner', jsonb_build_object('scope', 'second_brain', 'raw', r, 'nodes', n, 'edges', e));
  RETURN jsonb_build_object('raw', r, 'nodes', n, 'edges', e);
END $$;

-- ── Permissions ──────────────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA brain FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA brain FROM PUBLIC;
GRANT USAGE ON SCHEMA brain TO nerve_agent;
GRANT EXECUTE ON FUNCTION brain.capture(text, text, text, text, boolean, text, uuid),
                          brain.add_node(text, bigint, text, text, text[], real[], text, text, uuid),
                          brain.add_human_edge(text, bigint, bigint, text, text, uuid),
                          brain.suggest_edge(text, bigint, bigint, text, real, text, text, uuid),
                          brain.decide_edge(text, bigint, text, text, uuid),
                          brain.apply_clusters(text, jsonb, jsonb, text, uuid),
                          brain.snapshot(text, text, int, uuid),
                          brain.evidence(text, bigint, text, uuid),
                          brain.search(text, text, real[], int, text, uuid) TO nerve_agent;
-- brain.forget_user and the guards stay with the owner.

-- ── Toolbelts (sole holder: brain.write and brain.link belong to أمين alone) ──
INSERT INTO nerve.tools (name, writes, sole_holder, description) VALUES
  ('brain.read',  false, NULL,    'Read the owner''s private second brain (graph, search, evidence); never shared'),
  ('brain.write', true,  'ameen', 'Capture a note and add its atoms to the second brain'),
  ('brain.link',  true,  'ameen', 'Suggest links and clusters, and apply the owner''s accept or reject');
UPDATE nerve.agents SET tools = tools || ARRAY['brain.read'] WHERE id = 'hakeem' AND NOT ('brain.read' = ANY (tools));
UPDATE nerve.agents SET tools = tools || ARRAY['brain.read', 'brain.write', 'brain.link'] WHERE id = 'ameen' AND NOT ('brain.write' = ANY (tools));
UPDATE nerve.agents SET cannot = cannot || ARRAY['trade proposals from the second brain'] WHERE id = 'ameen'
  AND NOT ('trade proposals from the second brain' = ANY (cannot));
SQL
echo "brain schema created"
else
  echo "brain schema already present"
fi

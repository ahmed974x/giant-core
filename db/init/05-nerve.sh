#!/bin/sh
# Nervous system for the agents (ADR-079, design in docs/agents/ARCHITECTURE-AGENTS.md section 5).
#   nerve.events   append-only event log, hash-chained: every row carries sha256(previous hash + this row)
#   nerve.agents   registry: one Agent Card per agent (disclosure line, toolbelt, container, active/paused)
#   nerve.tools    every tool an agent may hold; money-moving tools can never be registered
#   nerve.queue    one queue per agent (send / read with a visibility timeout / ack), archived on ack
#   api.nerve_*    read-only views for the Ops Room
# Agents get the nerve_agent role: they call functions only, never write tables directly.
# Runs on the first boot of an empty volume. On a volume that already exists, db-migrate applies it, or:
#   docker compose exec -T timescale sh /docker-entrypoint-initdb.d/05-nerve.sh
set -eu

if psql -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT 1 FROM pg_namespace WHERE nspname = 'nerve'" | grep -q 1; then
  echo "nerve schema already present"; exit 0
fi

psql -v ON_ERROR_STOP=1 --single-transaction --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE SCHEMA nerve;
CREATE SCHEMA IF NOT EXISTS api;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nerve_agent') THEN CREATE ROLE nerve_agent NOLOGIN; END IF;
END $$;

-- ── Tools ────────────────────────────────────────────────────────────────
-- writes:      the tool changes something, so input marked 'tainted' can never drive it
-- sole_holder: only this agent may carry the tool (e.g. only فهد may add proposals)
CREATE TABLE nerve.tools (
  name        text PRIMARY KEY CHECK (name ~ '^[a-z_]+(\.[a-z_]+)+$'),
  writes      boolean NOT NULL,
  sole_holder text,
  description text NOT NULL,
  -- ADR-073/076: no agent may approve, fill, order, withdraw, transfer, sign or execute. Not even registrable.
  CONSTRAINT no_money_tools CHECK (name !~ '(approve|fill|order|withdraw|transfer|sign|execute|trade|wallet_key|custody)')
);
INSERT INTO nerve.tools (name, writes, sole_holder, description) VALUES
  ('registry.read',     false, NULL,     'Read Agent Cards: who can do what'),
  ('events.read',       false, NULL,     'Read the event log'),
  ('queue.send',        true,  NULL,     'Send a task to another agent''s queue'),
  ('memory.search',     false, NULL,     'Search long-term memory'),
  ('memory.write',      true,  'ameen',  'Write, merge or supersede memories'),
  ('searxng.search',    false, NULL,     'Local SearXNG web search'),
  ('deep_research.run', false, NULL,     'Run the deep-research engine (ADR-050)'),
  ('web.read',          false, NULL,     'Read a public page as text; the result is tainted'),
  ('strategies.read',   false, NULL,     'Read strategy signals and backtests'),
  ('market.read',       false, NULL,     'Read market prices and candles'),
  ('newton.solve',      false, NULL,     'Ask the Newton math brain'),
  ('worldpulse.read',   false, NULL,     'Read World Pulse events'),
  ('risk.check',        false, NULL,     'Check a draft proposal against the risk rules'),
  ('rr.compute',        false, NULL,     'Reward/risk ratio and size inside the 50 to 200 USDT band'),
  ('paper.read',        false, NULL,     'Read the paper account and ledger'),
  ('proposals.read',    false, NULL,     'Read the approval queue'),
  ('proposals.add',     true,  'fahd',   'Add a proposal to the approval queue; a human approves each one'),
  ('docs.read',         false, NULL,     'Read the product docs'),
  ('glossary.read',     false, NULL,     'Read the beginner glossary'),
  ('evidence.verify',   false, NULL,     'Check that a claim''s evidence link exists and says what is claimed'),
  ('health.read',       false, NULL,     'Read service health'),
  ('agents.pause',      true,  'haris',  'Pause an agent (only the owner can resume it)'),
  ('vault.read',        false, NULL,     'Read the paper Vault'),
  ('vault.reconcile',   true,  'khazen', 'Recompute paper balances and report differences');

-- ── Registry: one Agent Card per agent ───────────────────────────────────
CREATE TABLE nerve.agents (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z]{2,20}$' AND id NOT IN ('owner', 'system')),
  name_ar       text NOT NULL,
  name_en       text NOT NULL,
  role          text NOT NULL,
  -- ADR-076: every agent says it is an AI. The registry refuses an agent without that line.
  disclosure_ar text NOT NULL CHECK (disclosure_ar LIKE '%ذكاء اصطناعي%'),
  disclosure_en text NOT NULL CHECK (disclosure_en ILIKE '%an AI agent%'),
  tools         text[] NOT NULL DEFAULT '{}',
  cannot        text[] NOT NULL DEFAULT '{}',
  container     text NOT NULL CHECK (container IN ('agent-core', 'agent-research', 'agent-quant')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  paused_by     text,
  paused_reason text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION nerve.check_toolbelt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; holder text;
BEGIN
  FOREACH t IN ARRAY NEW.tools LOOP
    SELECT sole_holder INTO holder FROM nerve.tools WHERE name = t;
    IF NOT FOUND THEN RAISE EXCEPTION 'unknown tool % for agent %', t, NEW.id; END IF;
    IF holder IS NOT NULL AND holder <> NEW.id THEN
      RAISE EXCEPTION 'tool % belongs only to %, not %', t, holder, NEW.id;
    END IF;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER agents_toolbelt BEFORE INSERT OR UPDATE ON nerve.agents FOR EACH ROW EXECUTE FUNCTION nerve.check_toolbelt();

INSERT INTO nerve.agents (id, name_ar, name_en, role, disclosure_ar, disclosure_en, tools, cannot, container) VALUES
  ('hakeem', 'حكيم', 'Hakeem', 'Planner: turns a goal into a plan, assigns steps, merges results',
   'أنا حكيم، وكيل ذكاء اصطناعي متخصص في التخطيط وتنسيق الوكلاء. أنا هنا لمساعدتك.',
   'I am Hakeem, an AI agent specialised in planning and coordinating the agents. I am here to help you.',
   '{registry.read,events.read,queue.send,memory.search}', '{market tools,proposals,money}', 'agent-core'),
  ('maha', 'مها', 'Maha', 'Researcher: search, read, cross-check and cite',
   'أنا مها، وكيلة ذكاء اصطناعي متخصصة في البحث العميق. أنا هنا لمساعدتك.',
   'I am Maha, an AI agent specialised in deep research. I am here to help you.',
   '{searxng.search,deep_research.run,web.read,memory.search}', '{act on what it reads,proposals,money}', 'agent-research'),
  ('ameen', 'أمين', 'Ameen', 'Librarian: writes, merges, dates and supersedes memories; runs the nightly sleep',
   'أنا أمين، وكيل ذكاء اصطناعي متخصص في حفظ الذاكرة وترتيبها. أنا هنا لمساعدتك.',
   'I am Ameen, an AI agent specialised in keeping and organising memory. I am here to help you.',
   '{memory.search,memory.write,events.read}', '{delete the event log,proposals,money}', 'agent-core'),
  ('salem', 'سالم', 'Salem', 'Analyst: reads signals and strategies, explains with numbers',
   'أنا سالم، وكيل ذكاء اصطناعي متخصص في تحليل السوق. أنا هنا لمساعدتك.',
   'I am Salem, an AI agent specialised in market analysis. I am here to help you.',
   '{strategies.read,market.read,newton.solve,worldpulse.read,memory.search}', '{add proposals,state forecasts as facts,money}', 'agent-core'),
  ('rashid', 'راشد', 'Rashid', 'Risk manager and RR unit: checks every draft proposal',
   'أنا راشد، وكيل ذكاء اصطناعي متخصص في مراقبة المخاطر. أنا هنا لمساعدتك.',
   'I am Rashid, an AI agent specialised in risk monitoring. I am here to help you.',
   '{risk.check,rr.compute,paper.read,proposals.read}', '{approve or reject for the user,change limits,money}', 'agent-quant'),
  ('fahd', 'فهد', 'Fahd', 'Proposal clerk: packs a checked idea into a proposal with its evidence',
   'أنا فهد، وكيل ذكاء اصطناعي متخصص في تجهيز المقترحات الورقية. أنا هنا لمساعدتك.',
   'I am Fahd, an AI agent specialised in preparing paper proposals. I am here to help you.',
   '{proposals.add,proposals.read,paper.read}', '{approve,record a fill,send an order,money}', 'agent-core'),
  ('noura', 'نورة', 'Noura', 'Guide: explains screens and terms to beginners',
   'أنا نورة، وكيلة ذكاء اصطناعي متخصصة في شرح الأمور للمبتدئين. أنا هنا لمساعدتك.',
   'I am Noura, an AI agent specialised in explaining things to beginners. I am here to help you.',
   '{docs.read,glossary.read}', '{say you should buy or sell,money}', 'agent-core'),
  ('badr', 'بدر', 'Badr', 'Critic and auditor: red-teams plans and answers',
   'أنا بدر، وكيل ذكاء اصطناعي متخصص في المراجعة والنقد. أنا هنا لمساعدتك.',
   'I am Badr, an AI agent specialised in review and critique. I am here to help you.',
   '{events.read,memory.search,evidence.verify}', '{change anything,money}', 'agent-core'),
  ('haris', 'حارس', 'Haris', 'Sentinel and immune system: health, injection watch, pause',
   'أنا حارس، وكيل ذكاء اصطناعي متخصص في صحة النظام وأمانه. أنا هنا لمساعدتك.',
   'I am Haris, an AI agent specialised in system health and safety. I am here to help you.',
   '{health.read,events.read,agents.pause}', '{resume an agent,money}', 'agent-core'),
  ('khazen', 'خازن', 'Khazen', 'Vault keeper: paper double-entry, daily reconciliation (not a bank)',
   'أنا خازن، وكيل ذكاء اصطناعي متخصص في الدفتر الورقي. أنا هنا لمساعدتك.',
   'I am Khazen, an AI agent specialised in the paper ledger. I am here to help you.',
   '{vault.read,vault.reconcile,paper.read}', '{create money,post entries outside an approved fill,hold funds}', 'agent-quant');

-- ── Event log: append-only, hash-chained ─────────────────────────────────
CREATE SEQUENCE nerve.events_id_seq;
CREATE TABLE nerve.events (
  id        bigint PRIMARY KEY,               -- set inside the chain lock, so id order = chain order
  ts        timestamptz NOT NULL,
  agent     text NOT NULL,                    -- an agent id, 'owner' (Ahmad) or 'system'
  kind      text NOT NULL CHECK (kind ~ '^(signal|task|tool|memory|proposal|human|guard|agent)\.[a-z_]+$'),
  run_id    uuid,
  parent_id bigint REFERENCES nerve.events (id),
  trust     text NOT NULL CHECK (trust IN ('owner', 'system', 'agent', 'tainted')),
  payload   jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) < 65536),
  evidence  jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence) = 'array'),
  prev_hash text NOT NULL,
  hash      text NOT NULL UNIQUE
);
CREATE INDEX events_agent_ts ON nerve.events (agent, id DESC);
CREATE INDEX events_run ON nerve.events (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX events_kind ON nerve.events (kind, id DESC);

-- The text the hash covers. Timestamps in UTC with microseconds so the chain is the same in any session time zone.
CREATE FUNCTION nerve.event_digest(prev text, e nerve.events) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|', prev, e.id::text,
           to_char(e.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), e.agent, e.kind,
           coalesce(e.run_id::text, ''), coalesce(e.parent_id::text, ''), e.trust, e.payload::text, e.evidence::text), 'UTF8')), 'hex')
$$;

CREATE FUNCTION nerve.chain_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text;
BEGIN
  IF NEW.agent NOT IN ('owner', 'system') AND NOT EXISTS (SELECT 1 FROM nerve.agents WHERE id = NEW.agent) THEN
    RAISE EXCEPTION 'unknown agent %', NEW.agent;
  END IF;
  IF (NEW.trust = 'owner') <> (NEW.agent = 'owner') THEN
    RAISE EXCEPTION 'trust ''owner'' is only for events written by the owner';
  END IF;
  IF NEW.kind LIKE 'human.%' AND NEW.agent <> 'owner' THEN
    RAISE EXCEPTION 'only the owner writes human.* events';
  END IF;
  -- One writer at a time: the id and the previous hash are taken under the same lock.
  PERFORM pg_advisory_xact_lock(hashtext('nerve.events'));
  NEW.id := nextval('nerve.events_id_seq');
  NEW.ts := clock_timestamp();
  SELECT hash INTO prev FROM nerve.events ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := coalesce(prev, 'genesis');
  NEW.hash := nerve.event_digest(NEW.prev_hash, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER events_chain BEFORE INSERT ON nerve.events FOR EACH ROW EXECUTE FUNCTION nerve.chain_event();

CREATE FUNCTION nerve.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'nerve.events is append-only'; END $$;
CREATE TRIGGER events_no_update BEFORE UPDATE OR DELETE ON nerve.events FOR EACH ROW EXECUTE FUNCTION nerve.refuse_change();
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON nerve.events FOR EACH STATEMENT EXECUTE FUNCTION nerve.refuse_change();

-- Recompute the chain. p_last = how many recent events to check (NULL = all). Returns the first broken id, if any.
CREATE FUNCTION nerve.verify_chain(p_last integer DEFAULT NULL)
RETURNS TABLE (ok boolean, checked bigint, broken_at bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
DECLARE e nerve.events; prev text := NULL; n bigint := 0; start_id bigint;
BEGIN
  SELECT coalesce(min(id), 0) INTO start_id FROM (SELECT id FROM nerve.events ORDER BY id DESC LIMIT p_last) s;
  FOR e IN SELECT * FROM nerve.events WHERE id >= start_id ORDER BY id LOOP
    IF prev IS NULL THEN prev := e.prev_hash; END IF;           -- anchor on the first checked row
    IF e.prev_hash <> prev OR e.hash <> nerve.event_digest(prev, e) THEN
      ok := false; checked := n; broken_at := e.id; RETURN NEXT; RETURN;
    END IF;
    prev := e.hash; n := n + 1;
  END LOOP;
  ok := true; checked := n; broken_at := NULL; RETURN NEXT;
END $$;

-- Is the caller an agent login (a member of nerve_agent and not the superuser owner)?
CREATE FUNCTION nerve.caller_is_agent() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = session_user), false)
         AND pg_has_role(session_user, 'nerve_agent', 'MEMBER')
$$;

-- Internal writer, used by the other nerve functions. Not granted to agents.
CREATE FUNCTION nerve._emit(p_agent text, p_kind text, p_trust text, p_payload jsonb DEFAULT '{}',
                           p_evidence jsonb DEFAULT '[]', p_run uuid DEFAULT NULL, p_parent bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
DECLARE new_id bigint;
BEGIN
  INSERT INTO nerve.events (id, ts, agent, kind, run_id, parent_id, trust, payload, evidence, prev_hash, hash)
  VALUES (0, now(), p_agent, p_kind, p_run, p_parent, p_trust, coalesce(p_payload, '{}'), coalesce(p_evidence, '[]'), '', '')
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- What agents call to log a step. An agent login can only write as an agent, with 'agent' or 'tainted' trust.
CREATE FUNCTION nerve.emit(p_agent text, p_kind text, p_trust text, p_payload jsonb DEFAULT '{}',
                           p_evidence jsonb DEFAULT '[]', p_run uuid DEFAULT NULL, p_parent bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
BEGIN
  IF nerve.caller_is_agent() AND (p_agent IN ('owner', 'system') OR p_trust NOT IN ('agent', 'tainted')) THEN
    RAISE EXCEPTION 'an agent may only write its own events with agent or tainted trust';
  END IF;
  RETURN nerve._emit(p_agent, p_kind, p_trust, p_payload, p_evidence, p_run, p_parent);
END $$;

-- ── Tool gateway: allow-list from data, not from prompts ─────────────────
CREATE FUNCTION nerve.tool_call(p_agent text, p_tool text, p_trust text, p_args jsonb DEFAULT '{}', p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
DECLARE a nerve.agents; t nerve.tools; why text := NULL; ev bigint;
BEGIN
  SELECT * INTO a FROM nerve.agents WHERE id = p_agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown agent %', p_agent; END IF;
  SELECT * INTO t FROM nerve.tools WHERE name = p_tool;
  IF NOT FOUND THEN why := 'unknown tool';
  ELSIF a.status <> 'active' THEN why := 'agent is paused';
  ELSIF NOT (p_tool = ANY (a.tools)) THEN why := 'tool not in this agent''s toolbelt';
  ELSIF t.writes AND p_trust = 'tainted' THEN why := 'tainted input cannot drive a write tool';
  END IF;
  IF why IS NULL THEN
    ev := nerve._emit(p_agent, 'tool.call', CASE WHEN p_trust = 'tainted' THEN 'tainted' ELSE 'agent' END,
                     jsonb_build_object('tool', p_tool, 'args', coalesce(p_args, '{}')), '[]', p_run);
    RETURN jsonb_build_object('allowed', true, 'event_id', ev);
  END IF;
  ev := nerve._emit('system', 'guard.refused', 'system',
                   jsonb_build_object('agent', p_agent, 'tool', p_tool, 'reason', why, 'input_trust', p_trust), '[]', p_run);
  RETURN jsonb_build_object('allowed', false, 'reason', why, 'event_id', ev);
END $$;

-- ── Pause and resume (the kill-switch) ───────────────────────────────────
-- حارس (or the owner) can pause any agent. Only the owner resumes: nerve_agent cannot execute resume_agent.
CREATE FUNCTION nerve.pause_agent(p_by text, p_agent text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
BEGIN
  IF p_by = 'owner' AND nerve.caller_is_agent() THEN RAISE EXCEPTION 'an agent cannot act as the owner'; END IF;
  IF p_by <> 'owner' AND NOT EXISTS (SELECT 1 FROM nerve.agents WHERE id = p_by AND status = 'active' AND 'agents.pause' = ANY (tools)) THEN
    RAISE EXCEPTION '% may not pause agents', p_by;
  END IF;
  UPDATE nerve.agents SET status = 'paused', paused_by = p_by, paused_reason = left(p_reason, 300) WHERE id = p_agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown agent %', p_agent; END IF;
  PERFORM nerve._emit(CASE WHEN p_by = 'owner' THEN 'owner' ELSE p_by END, 'guard.paused',
                     CASE WHEN p_by = 'owner' THEN 'owner' ELSE 'agent' END,
                     jsonb_build_object('agent', p_agent, 'reason', p_reason));
END $$;

CREATE FUNCTION nerve.resume_agent(p_agent text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
BEGIN
  UPDATE nerve.agents SET status = 'active', paused_by = NULL, paused_reason = NULL WHERE id = p_agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown agent %', p_agent; END IF;
  PERFORM nerve._emit('owner', 'human.resumed', 'owner', jsonb_build_object('agent', p_agent));
END $$;

-- ── Queues: one per agent, at-least-once delivery ────────────────────────
CREATE TABLE nerve.queue (
  msg_id      bigserial PRIMARY KEY,
  queue       text NOT NULL REFERENCES nerve.agents (id),
  sender      text NOT NULL,
  trust       text NOT NULL CHECK (trust IN ('owner', 'system', 'agent', 'tainted')),
  run_id      uuid NOT NULL,
  message     jsonb NOT NULL CHECK (jsonb_typeof(message) = 'object' AND pg_column_size(message) < 65536),
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  vt          timestamptz NOT NULL DEFAULT now(),       -- invisible to readers until this time
  read_ct     integer NOT NULL DEFAULT 0,
  deadline    timestamptz NOT NULL
);
CREATE INDEX queue_ready ON nerve.queue (queue, vt, msg_id);
CREATE TABLE nerve.queue_archive (LIKE nerve.queue, outcome text NOT NULL, archived_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION nerve.send(p_from text, p_to text, p_message jsonb, p_trust text DEFAULT 'agent',
                           p_run uuid DEFAULT NULL, p_ttl interval DEFAULT '1 hour')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
DECLARE gate jsonb; m bigint; run uuid := coalesce(p_run, gen_random_uuid());
BEGIN
  IF p_from IN ('owner', 'system') AND nerve.caller_is_agent() THEN RAISE EXCEPTION 'an agent cannot send as %', p_from; END IF;
  -- A message is never more trusted than its sender: only the owner sends 'owner', only the system 'system'.
  IF (p_trust = 'owner' AND p_from <> 'owner') OR (p_trust = 'system' AND p_from <> 'system')
     OR (p_from IN ('owner', 'system') AND p_trust NOT IN (p_from, 'tainted')) THEN
    RAISE EXCEPTION 'trust % does not match sender %', p_trust, p_from;
  END IF;
  IF p_from NOT IN ('owner', 'system') THEN
    gate := nerve.tool_call(p_from, 'queue.send', p_trust, jsonb_build_object('to', p_to), run);
    IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'send refused: %', gate ->> 'reason'; END IF;
  END IF;
  INSERT INTO nerve.queue (queue, sender, trust, run_id, message, deadline)
  VALUES (p_to, p_from, p_trust, run, p_message, now() + least(p_ttl, interval '7 days'))
  RETURNING msg_id INTO m;
  PERFORM nerve._emit(CASE WHEN p_from = 'owner' THEN 'owner' ELSE p_from END, 'task.sent',
                     CASE WHEN p_from = 'owner' THEN 'owner' WHEN p_from = 'system' THEN 'system' ELSE 'agent' END,
                     jsonb_build_object('to', p_to, 'msg_id', m, 'input_trust', p_trust), '[]', run);
  PERFORM pg_notify('nerve_' || p_to, m::text);          -- wakes the agent's worker; nothing polls
  RETURN m;
END $$;

-- Take up to p_qty ready messages; they stay hidden for p_vt seconds, then reappear unless acked.
CREATE FUNCTION nerve.read(p_agent text, p_vt integer DEFAULT 60, p_qty integer DEFAULT 1)
RETURNS SETOF nerve.queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nerve.agents WHERE id = p_agent AND status = 'active') THEN RETURN; END IF;
  RETURN QUERY
    UPDATE nerve.queue q SET vt = clock_timestamp() + make_interval(secs => greatest(p_vt, 1)), read_ct = q.read_ct + 1
    WHERE q.msg_id IN (SELECT msg_id FROM nerve.queue
                       WHERE queue = p_agent AND vt <= clock_timestamp() AND deadline > clock_timestamp()
                       ORDER BY msg_id FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_qty, 1), 100))
    RETURNING q.*;
END $$;

CREATE FUNCTION nerve.ack(p_agent text, p_msg_id bigint, p_outcome text DEFAULT 'done')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
DECLARE r nerve.queue;
BEGIN
  DELETE FROM nerve.queue WHERE msg_id = p_msg_id AND queue = p_agent RETURNING * INTO r;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO nerve.queue_archive SELECT r.*, left(p_outcome, 40), now();
  PERFORM nerve._emit(p_agent, 'task.done', 'agent', jsonb_build_object('msg_id', p_msg_id, 'outcome', left(p_outcome, 40)), '[]', r.run_id);
  RETURN true;
END $$;

-- Messages past their deadline are archived as 'expired' (call on a schedule).
CREATE FUNCTION nerve.expire() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = nerve, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH gone AS (DELETE FROM nerve.queue WHERE deadline <= now() RETURNING *)
  INSERT INTO nerve.queue_archive SELECT gone.*, 'expired', now() FROM gone;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN PERFORM nerve._emit('system', 'task.expired', 'system', jsonb_build_object('count', n)); END IF;
  RETURN n;
END $$;

-- ── Genesis ──────────────────────────────────────────────────────────────
SELECT nerve._emit('system', 'agent.registered', 'system', jsonb_build_object('agent', id, 'name', name_ar, 'tools', tools))
FROM nerve.agents ORDER BY id;

-- ── Permissions: agents call functions, never touch tables ───────────────
REVOKE ALL ON ALL TABLES IN SCHEMA nerve FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nerve FROM PUBLIC;
GRANT USAGE ON SCHEMA nerve TO nerve_agent;
GRANT EXECUTE ON FUNCTION nerve.emit(text, text, text, jsonb, jsonb, uuid, bigint),
                          nerve.tool_call(text, text, text, jsonb, uuid),
                          nerve.pause_agent(text, text, text),
                          nerve.send(text, text, jsonb, text, uuid, interval),
                          nerve.read(text, integer, integer),
                          nerve.ack(text, bigint, text),
                          nerve.verify_chain(integer) TO nerve_agent;
-- nerve._emit, nerve.resume_agent and nerve.expire stay with the owner (admin role) only.

-- ── Read-only views for the Ops Room ─────────────────────────────────────
CREATE VIEW api.nerve_agents AS
  SELECT a.id, a.name_ar, a.name_en, a.role, a.disclosure_ar, a.disclosure_en, a.tools, a.cannot, a.container,
         a.status, a.paused_by, a.paused_reason,
         (SELECT count(*) FROM nerve.queue q WHERE q.queue = a.id) AS queued,
         (SELECT max(e.ts) FROM nerve.events e WHERE e.agent = a.id) AS last_seen,
         jsonb_build_object('name', a.name_en, 'description', a.role, 'version', '1',
                            'provider', jsonb_build_object('organization', 'OMEGA'),
                            'skills', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.name, 'description', t.description)), '[]')
                                       FROM nerve.tools t WHERE t.name = ANY (a.tools))) AS card
  FROM nerve.agents a;

CREATE VIEW api.nerve_events AS
  SELECT id, ts, agent, kind, trust, run_id, parent_id, left(payload::text, 400) AS payload,
         jsonb_array_length(evidence) AS evidence_count, left(hash, 12) AS hash
  FROM nerve.events ORDER BY id DESC LIMIT 500;

CREATE VIEW api.nerve_chain AS SELECT * FROM nerve.verify_chain(2000);

GRANT USAGE ON SCHEMA api TO web_anon;
GRANT SELECT ON api.nerve_agents, api.nerve_events, api.nerve_chain TO web_anon;
GRANT USAGE ON SCHEMA nerve TO web_anon;
GRANT EXECUTE ON FUNCTION nerve.verify_chain(integer) TO web_anon;     -- read-only; used by api.nerve_chain
SQL

echo "nerve schema created"

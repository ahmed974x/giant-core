#!/bin/sh
# Market agents, paper gate (ADR-083, design docs/agents/ARCHITECTURE-AGENTS.md sections 3 and 8). Needs 05 to 08.
# Two keys and an owner: فهد (proposals.add) packs a checked idea into a proposal with its evidence; راشد (risk.check)
# checks the reward-to-risk and the size; only the owner approves. Approved means "approved on paper": there is no
# function in this schema, or anywhere in the agents, that places an order, fills, moves money or talks to an exchange.
# Long setups only in this version (stop < entry < target). Size is held between 50 and 200 USDT (paper units).
set -eu

PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

if ! $PSQL -tA -c "SELECT 1 FROM pg_namespace WHERE nspname = 'prop'" | grep -q 1; then
$PSQL --single-transaction <<'SQL'
CREATE SCHEMA prop;

CREATE TABLE prop.proposals (
  id          bigserial PRIMARY KEY,
  agent       text NOT NULL DEFAULT 'fahd' CHECK (agent = 'fahd'),
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  rationale   text NOT NULL CHECK (length(rationale) BETWEEN 3 AND 1000),
  evidence    jsonb NOT NULL,
  entry       numeric NOT NULL CHECK (entry > 0),
  stop        numeric NOT NULL CHECK (stop > 0),
  target      numeric NOT NULL CHECK (target > 0),
  rr          numeric NOT NULL,
  size_usdt   numeric NOT NULL CHECK (size_usdt BETWEEN 50 AND 200),
  status      text NOT NULL DEFAULT 'pending_risk'
              CHECK (status IN ('pending_risk', 'risk_pass', 'risk_fail', 'approved', 'rejected')),
  risk_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  CHECK (stop < entry AND entry < target)
);

-- The freeze: خازن's reconciliation sets it when the paper books do not agree (ADR-085). While set, no new proposal is added.
CREATE TABLE prop.freeze (
  id         integer PRIMARY KEY CHECK (id = 1),
  frozen     boolean NOT NULL DEFAULT false,
  reason     text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO prop.freeze (id) VALUES (1);

-- A proposal's numbers never change; only its status moves, and each move is one of the steps below.
CREATE FUNCTION prop.guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'proposals are kept (audit)'; END IF;
  IF NEW.title <> OLD.title OR NEW.rationale <> OLD.rationale OR NEW.evidence <> OLD.evidence OR NEW.entry <> OLD.entry
     OR NEW.stop <> OLD.stop OR NEW.target <> OLD.target OR NEW.rr <> OLD.rr OR NEW.size_usdt <> OLD.size_usdt THEN
    RAISE EXCEPTION 'a proposal is not rewritten; add a new one';
  END IF;
  IF OLD.status IN ('approved', 'rejected', 'risk_fail') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'a decided proposal is final'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proposals_guard BEFORE UPDATE OR DELETE ON prop.proposals FOR EACH ROW EXECUTE FUNCTION prop.guard();

CREATE FUNCTION prop.guard_session(p_by text) RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF nerve.caller_is_agent() AND p_by IS DISTINCT FROM session_user THEN
    RAISE EXCEPTION 'an agent may only act as itself (% is not %)', session_user, p_by;
  END IF;
END $$;

-- Fahd: add a proposal. Long setups only; the reward-to-risk is computed here, not taken from the caller.
CREATE FUNCTION prop.add(p_by text, p_title text, p_rationale text, p_evidence jsonb, p_entry numeric, p_stop numeric,
                         p_target numeric, p_size_usdt numeric, p_run uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = prop, nerve, mem, pg_temp AS $$
DECLARE gate jsonb; pid bigint; r numeric;
BEGIN
  PERFORM prop.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'proposals.add', 'agent', '{}', p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'proposal refused: %', gate ->> 'reason'; END IF;
  IF (SELECT frozen FROM prop.freeze WHERE id = 1) THEN RAISE EXCEPTION 'new proposals are frozen until the paper books reconcile'; END IF;
  IF mem.looks_secret(p_title) OR mem.looks_secret(p_rationale) THEN
    PERFORM nerve._emit('system', 'guard.secret_refused', 'system', jsonb_build_object('agent', p_by, 'where', 'prop.proposals'));
    RAISE WARNING 'refused: looks like a secret (nothing stored)';
    RETURN NULL;
  END IF;
  IF NOT mem.valid_evidence(p_evidence) THEN RAISE EXCEPTION 'a proposal needs evidence: a list of {url} or {event} items'; END IF;
  IF NOT (p_stop < p_entry AND p_entry < p_target) THEN RAISE EXCEPTION 'long setups only: stop < entry < target'; END IF;
  r := round((p_target - p_entry) / (p_entry - p_stop), 4);
  INSERT INTO prop.proposals (title, rationale, evidence, entry, stop, target, rr, size_usdt)
  VALUES (p_title, p_rationale, p_evidence, p_entry, p_stop, p_target, r, p_size_usdt) RETURNING id INTO pid;
  PERFORM nerve._emit(p_by, 'proposal.created', 'agent', jsonb_build_object('proposal', pid, 'rr', r), '[]', p_run);
  RETURN pid;
END $$;

-- Rashid: the two-key check. A pass needs the reward-to-risk of at least 2 (ADR-073); Rashid cannot pass a weaker setup.
CREATE FUNCTION prop.risk_check(p_by text, p_id bigint, p_reason text, p_run uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = prop, nerve, pg_temp AS $$
DECLARE gate jsonb; p prop.proposals; verdict text;
BEGIN
  PERFORM prop.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'risk.check', 'agent', '{}', p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'risk check refused: %', gate ->> 'reason'; END IF;
  SELECT * INTO p FROM prop.proposals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown proposal %', p_id; END IF;
  IF p.status <> 'pending_risk' THEN RAISE EXCEPTION 'proposal % is already %', p_id, p.status; END IF;
  verdict := CASE WHEN p.rr >= 2 THEN 'risk_pass' ELSE 'risk_fail' END;
  UPDATE prop.proposals SET status = verdict,
    risk_reason = left(coalesce(p_reason, '') || CASE WHEN p.rr < 2 THEN ' (reward-to-risk below 2)' ELSE '' END, 300)
  WHERE id = p_id;
  PERFORM nerve._emit(p_by, 'proposal.checked', 'agent', jsonb_build_object('proposal', p_id, 'verdict', verdict), '[]', p_run);
  RETURN verdict;
END $$;

-- The owner's decision. Agents cannot call it; a checked proposal only, and it is approval on paper.
CREATE FUNCTION prop.decide(p_id bigint, p_decision text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = prop, nerve, pg_temp AS $$
DECLARE st text;
BEGIN
  IF nerve.caller_is_agent() THEN RAISE EXCEPTION 'only the owner decides a proposal'; END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'decision must be approved or rejected'; END IF;
  SELECT status INTO st FROM prop.proposals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown proposal %', p_id; END IF;
  IF st <> 'risk_pass' THEN RAISE EXCEPTION 'proposal % is not checked yet (%)', p_id, st; END IF;
  UPDATE prop.proposals SET status = p_decision, decided_at = now() WHERE id = p_id;
  PERFORM nerve._emit('owner', 'human.decided', 'owner', jsonb_build_object('proposal', p_id, 'decision', p_decision));
END $$;

-- The queue, for the owner's page and for the agents that hold proposals.read.
CREATE FUNCTION prop.queue(p_by text, p_run uuid DEFAULT NULL)
RETURNS TABLE (id bigint, title text, status text, rr numeric, size_usdt numeric, risk_reason text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = prop, nerve, pg_temp AS $$
DECLARE gate jsonb;
BEGIN
  PERFORM prop.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'proposals.read', 'agent', '{}', p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'queue refused: %', gate ->> 'reason'; END IF;
  RETURN QUERY SELECT p.id, p.title, p.status, p.rr, p.size_usdt, p.risk_reason, p.created_at
               FROM prop.proposals p ORDER BY p.created_at DESC LIMIT 100;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA prop FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prop FROM PUBLIC;
GRANT USAGE ON SCHEMA prop TO nerve_agent;
GRANT EXECUTE ON FUNCTION prop.add(text, text, text, jsonb, numeric, numeric, numeric, numeric, uuid),
                          prop.risk_check(text, bigint, text, uuid),
                          prop.queue(text, uuid) TO nerve_agent;
-- prop.decide stays with the owner's admin login. There is no execute grant for agents.
-- The public page reads the queue through this view only; the view runs with its owner's rights, so web_anon
-- never gets the table itself. No rationale or evidence in the view: titles and numbers only.
CREATE VIEW api.prop_queue AS
  SELECT id, title, status, rr, size_usdt, risk_reason, created_at FROM prop.proposals ORDER BY created_at DESC LIMIT 100;
GRANT SELECT ON api.prop_queue TO web_anon;
SQL
echo "market proposal gate created"
else
  echo "market proposal gate already present"
fi

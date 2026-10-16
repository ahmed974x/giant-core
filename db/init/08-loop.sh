#!/bin/sh
# The brain loop (ADR-082, design docs/agents/ARCHITECTURE-AGENTS.md section 4). Needs 05, 06 and 07.
#   loop.runs         one row per run: the goal (never in the event log), budgets, counters, the report
#   loop.checkpoints  one row per step, append-only: the state after each node, so a run resumes after a restart
# Budgets are enforced here, not in Python: a step past max_steps or max_tokens stops the run as 'incomplete'.
# Only عبدالله (the planner, who runs the loop) holds loop.run. It cannot add a proposal: proposals.add belongs to فهد.
# The answer a run produces is an answer, never an order; nothing here can write to the proposal queue.
set -eu

PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

if ! $PSQL -tA -c "SELECT 1 FROM pg_namespace WHERE nspname = 'loop'" | grep -q 1; then
$PSQL --single-transaction <<'SQL'
CREATE SCHEMA loop;
ALTER TABLE nerve.events DROP CONSTRAINT events_kind_check;
ALTER TABLE nerve.events ADD CONSTRAINT events_kind_check
  CHECK (kind ~ '^(signal|task|tool|memory|proposal|human|guard|agent|brain|loop)\.[a-z_]+$');

CREATE TABLE loop.runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal        text NOT NULL CHECK (length(goal) BETWEEN 3 AND 4000),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'incomplete', 'failed')),
  max_steps   int NOT NULL CHECK (max_steps BETWEEN 1 AND 50),
  max_tokens  int NOT NULL CHECK (max_tokens BETWEEN 100 AND 200000),
  steps       int NOT NULL DEFAULT 0,
  tokens      int NOT NULL DEFAULT 0,
  report      jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE loop.checkpoints (
  run_id     uuid NOT NULL REFERENCES loop.runs (id),
  step       int NOT NULL,
  node       text NOT NULL CHECK (node IN ('perceive', 'recall', 'plan', 'research', 'analyse', 'critique', 'propose', 'learn')),
  state      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step)
);

-- Checkpoints and runs are never rewritten; a finished run is final.
CREATE FUNCTION loop.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the loop log is append-only (%)', TG_OP;
END $$;
CREATE TRIGGER checkpoints_guard BEFORE UPDATE OR DELETE ON loop.checkpoints FOR EACH ROW EXECUTE FUNCTION loop.refuse_change();
CREATE TRIGGER runs_no_delete BEFORE DELETE ON loop.runs FOR EACH ROW EXECUTE FUNCTION loop.refuse_change();
CREATE TRIGGER runs_final BEFORE UPDATE ON loop.runs FOR EACH ROW
  WHEN (OLD.status <> 'running' AND NEW IS DISTINCT FROM OLD) EXECUTE FUNCTION loop.refuse_change();

CREATE FUNCTION loop.guard_session(p_by text) RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF nerve.caller_is_agent() AND p_by IS DISTINCT FROM session_user THEN
    RAISE EXCEPTION 'an agent may only act as itself (% is not %)', session_user, p_by;
  END IF;
END $$;

CREATE FUNCTION loop.start(p_by text, p_goal text, p_max_steps int DEFAULT 12, p_max_tokens int DEFAULT 6000, p_run uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = loop, nerve, mem, pg_temp AS $$
DECLARE gate jsonb; rid uuid;
BEGIN
  PERFORM loop.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'loop.run', 'agent', '{}', p_run);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'loop refused: %', gate ->> 'reason'; END IF;
  IF mem.looks_secret(p_goal) THEN
    PERFORM nerve._emit('system', 'guard.secret_refused', 'system', jsonb_build_object('agent', p_by, 'where', 'loop.runs'));
    RAISE WARNING 'refused: looks like a secret (nothing stored)';
    RETURN NULL;
  END IF;
  INSERT INTO loop.runs (goal, max_steps, max_tokens) VALUES (p_goal, p_max_steps, p_max_tokens) RETURNING id INTO rid;
  -- the event carries the id and the budgets only, never the goal
  PERFORM nerve._emit(p_by, 'loop.started', 'agent', jsonb_build_object('run', rid, 'max_steps', p_max_steps, 'max_tokens', p_max_tokens), '[]', p_run);
  RETURN rid;
END $$;

-- One node's result. Refused (and the run stopped as incomplete) when a budget would be exceeded.
CREATE FUNCTION loop.step(p_by text, p_run uuid, p_node text, p_state jsonb, p_tokens int DEFAULT 0, p_run_ctx uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = loop, nerve, mem, pg_temp AS $$
DECLARE gate jsonb; r loop.runs; n int;
BEGIN
  PERFORM loop.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'loop.run', 'agent', '{}', p_run_ctx);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'loop refused: %', gate ->> 'reason'; END IF;
  SELECT * INTO r FROM loop.runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown run %', p_run; END IF;
  IF r.status <> 'running' THEN RAISE EXCEPTION 'run % is already %', p_run, r.status; END IF;
  IF mem.looks_secret(p_state::text) THEN
    PERFORM nerve._emit('system', 'guard.secret_refused', 'system', jsonb_build_object('agent', p_by, 'where', 'loop.checkpoints'));
    UPDATE loop.runs SET status = 'failed', finished_at = now() WHERE id = p_run;
    RAISE WARNING 'refused: looks like a secret (run failed, nothing stored)';
    RETURN jsonb_build_object('ok', false, 'reason', 'secret refused');
  END IF;
  IF r.steps + 1 > r.max_steps OR r.tokens + greatest(coalesce(p_tokens, 0), 0) > r.max_tokens THEN
    UPDATE loop.runs SET status = 'incomplete', finished_at = now() WHERE id = p_run;
    PERFORM nerve._emit(p_by, 'loop.budget', 'agent', jsonb_build_object('run', p_run, 'steps', r.steps, 'tokens', r.tokens), '[]', p_run_ctx);
    RETURN jsonb_build_object('ok', false, 'reason', 'budget reached', 'status', 'incomplete');
  END IF;
  n := r.steps + 1;
  INSERT INTO loop.checkpoints (run_id, step, node, state) VALUES (p_run, n, p_node, coalesce(p_state, '{}'));
  UPDATE loop.runs SET steps = n, tokens = r.tokens + greatest(coalesce(p_tokens, 0), 0) WHERE id = p_run;
  RETURN jsonb_build_object('ok', true, 'step', n);
END $$;

CREATE FUNCTION loop.finish(p_by text, p_run uuid, p_status text, p_report jsonb, p_run_ctx uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = loop, nerve, mem, pg_temp AS $$
DECLARE gate jsonb; st int;
BEGIN
  PERFORM loop.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'loop.run', 'agent', '{}', p_run_ctx);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'loop refused: %', gate ->> 'reason'; END IF;
  IF p_status NOT IN ('done', 'incomplete', 'failed') THEN RAISE EXCEPTION 'bad status %', p_status; END IF;
  UPDATE loop.runs SET status = p_status, report = p_report, finished_at = now()
  WHERE id = p_run AND status = 'running' RETURNING steps INTO st;
  IF NOT FOUND THEN RAISE EXCEPTION 'run % is not running', p_run; END IF;
  PERFORM nerve._emit(p_by, 'loop.finished', 'agent', jsonb_build_object('run', p_run, 'status', p_status, 'steps', st), '[]', p_run_ctx);
END $$;

-- The last checkpoint of a run: where to resume after a restart.
CREATE FUNCTION loop.resume(p_by text, p_run uuid, p_run_ctx uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = loop, nerve, pg_temp AS $$
DECLARE gate jsonb; out jsonb;
BEGIN
  PERFORM loop.guard_session(p_by);
  gate := nerve.tool_call(p_by, 'loop.run', 'agent', '{}', p_run_ctx);
  IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'loop refused: %', gate ->> 'reason'; END IF;
  SELECT jsonb_build_object('run', r.id, 'status', r.status, 'goal', r.goal, 'steps', r.steps, 'tokens', r.tokens,
                            'node', c.node, 'step', c.step, 'state', c.state)
    INTO out
  FROM loop.runs r LEFT JOIN LATERAL (SELECT * FROM loop.checkpoints k WHERE k.run_id = r.id ORDER BY k.step DESC LIMIT 1) c ON true
  WHERE r.id = p_run;
  RETURN out;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA loop FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA loop FROM PUBLIC;
GRANT USAGE ON SCHEMA loop TO nerve_agent;
GRANT EXECUTE ON FUNCTION loop.start(text, text, int, int, uuid), loop.step(text, uuid, text, jsonb, int, uuid),
                          loop.finish(text, uuid, text, jsonb, uuid), loop.resume(text, uuid, uuid) TO nerve_agent;

INSERT INTO nerve.tools (name, writes, sole_holder, description) VALUES
  ('loop.run', true, 'hakeem', 'Run the brain loop: start, checkpoint and finish a run (planner only)');
UPDATE nerve.agents SET tools = tools || ARRAY['loop.run'] WHERE id = 'hakeem' AND NOT ('loop.run' = ANY (tools));
UPDATE nerve.agents SET cannot = cannot || ARRAY['an order or a proposal from the loop'] WHERE id = 'hakeem'
  AND NOT ('an order or a proposal from the loop' = ANY (cannot));

-- A login for the planner (the loop runner), created only when a password is set.
SQL
echo "loop schema created"
else
  echo "loop schema already present"
fi

if [ -n "${HAKEEM_DB_PASSWORD:-}" ]; then
  $PSQL -v pw="$HAKEEM_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE hakeem LOGIN PASSWORD %L IN ROLE nerve_agent', :'pw') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hakeem')
\gexec
SQL
fi

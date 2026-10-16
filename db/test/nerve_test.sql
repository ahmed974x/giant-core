-- Tests for the nervous system (db/init/05-nerve.sh). Run with scripts/test-nerve.sh.
-- Each block raises on failure; the run stops at the first one (ON_ERROR_STOP).
\set QUIET on
SET client_min_messages = warning;

-- Helper: true when the statement raises an error containing the expected text.
CREATE FUNCTION pg_temp.fails(stmt text, expect text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF position(expect IN SQLERRM) = 0 THEN RAISE EXCEPTION 'wrong error for %: %', stmt, SQLERRM; END IF;
  RETURN true;
END $$;

CREATE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF;
  RAISE NOTICE 'ok  %', what;
END $$;
SET client_min_messages = notice;

-- ── Registry ──
SELECT pg_temp.check((SELECT count(*) FROM nerve.agents) = 10, 'ten agents registered');
SELECT pg_temp.check((SELECT bool_and(disclosure_ar LIKE '%ذكاء اصطناعي%' AND disclosure_en ILIKE '%an AI agent%') FROM nerve.agents),
                     'every agent carries its AI disclosure (ADR-076)');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO nerve.agents (id, name_ar, name_en, role, disclosure_ar, disclosure_en, container)
                                     VALUES ('ghost', 'شبح', 'Ghost', 'x', 'أنا موظف حقيقي', 'I am a person', 'agent-core')$$, 'check constraint'),
                     'an agent without the AI disclosure is refused');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO nerve.tools VALUES ('proposals.approve', true, NULL, 'x')$$, 'no_money_tools'),
                     'an approve tool cannot even be registered');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO nerve.tools VALUES ('paper.fill', true, NULL, 'x')$$, 'no_money_tools'),
                     'a fill tool cannot be registered');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO nerve.tools VALUES ('exchange.order', true, NULL, 'x')$$, 'no_money_tools'),
                     'an order tool cannot be registered');
SELECT pg_temp.check(pg_temp.fails($$UPDATE nerve.agents SET tools = tools || '{proposals.add}' WHERE id = 'salem'$$, 'belongs only to fahd'),
                     'only Fahd may hold proposals.add');
SELECT pg_temp.check(pg_temp.fails($$UPDATE nerve.agents SET tools = tools || '{teleport.now}' WHERE id = 'salem'$$, 'unknown tool'),
                     'unknown tools are refused');
SELECT pg_temp.check((SELECT count(*) FROM nerve.agents WHERE 'proposals.add' = ANY (tools)) = 1, 'exactly one agent can add proposals');
SELECT pg_temp.check((SELECT card ->> 'name' FROM api.nerve_agents WHERE id = 'fahd') = 'Fahd'
                     AND (SELECT jsonb_array_length(card -> 'skills') FROM api.nerve_agents WHERE id = 'fahd') = 3,
                     'Agent Card view lists the skills');

-- ── Event log ──
SELECT pg_temp.check((SELECT count(*) FROM nerve.events WHERE kind = 'agent.registered') = 10, 'genesis: one registration event per agent');
SELECT pg_temp.check((SELECT prev_hash FROM nerve.events ORDER BY id LIMIT 1) = 'genesis', 'chain starts at genesis');
SELECT nerve.emit('salem', 'signal.price_move', 'agent', '{"symbol": "BTCUSDT", "move": -0.05}', '[{"url": "https://example.org/raw"}]');
SELECT pg_temp.check((SELECT ok FROM nerve.verify_chain()), 'chain verifies after new events');
SELECT pg_temp.check(pg_temp.fails($$UPDATE nerve.events SET payload = '{}' WHERE id = 1$$, 'append-only'), 'events cannot be edited');
SELECT pg_temp.check(pg_temp.fails($$DELETE FROM nerve.events WHERE id = 1$$, 'append-only'), 'events cannot be deleted');
SELECT pg_temp.check(pg_temp.fails($$TRUNCATE nerve.events CASCADE$$, 'append-only'), 'events cannot be truncated');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.emit('salem', 'human.approved', 'agent')$$, 'only the owner'), 'agents cannot write human.* events');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.emit('salem', 'signal.x', 'owner')$$, 'only for events written by the owner'),
                     'agents cannot claim owner trust');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.emit('nobody', 'signal.x', 'agent')$$, 'unknown agent'), 'unknown agents cannot write');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.emit('salem', 'BAD KIND', 'agent')$$, 'check constraint'), 'event kinds are validated');

-- Tampering is detected: bypass the guard trigger (only a superuser can), edit a row, verify.
BEGIN;
ALTER TABLE nerve.events DISABLE TRIGGER events_no_update;
UPDATE nerve.events SET payload = '{"symbol": "BTCUSDT", "move": 0.50}' WHERE kind = 'signal.price_move';
SELECT pg_temp.check(NOT (SELECT ok FROM nerve.verify_chain())
                     AND (SELECT broken_at FROM nerve.verify_chain()) = (SELECT id FROM nerve.events WHERE kind = 'signal.price_move'),
                     'a tampered row breaks the chain at that row');
ROLLBACK;
SELECT pg_temp.check((SELECT ok FROM nerve.verify_chain(5)), 'partial verify of the last 5 events');

-- ── Tool gateway ──
SELECT pg_temp.check((nerve.tool_call('salem', 'market.read', 'agent') ->> 'allowed')::boolean, 'a tool in the toolbelt is allowed');
SELECT pg_temp.check(NOT (nerve.tool_call('salem', 'proposals.add', 'agent') ->> 'allowed')::boolean, 'a tool outside the toolbelt is refused');
SELECT pg_temp.check((nerve.tool_call('fahd', 'proposals.add', 'tainted') ->> 'reason') = 'tainted input cannot drive a write tool',
                     'tainted input cannot drive a write tool');
SELECT pg_temp.check((nerve.tool_call('maha', 'web.read', 'tainted') ->> 'allowed')::boolean, 'tainted input may still drive a read tool');
SELECT pg_temp.check((SELECT count(*) FROM nerve.events WHERE kind = 'guard.refused') = 2, 'every refusal is logged');

-- ── Pause / resume ──
SELECT nerve.pause_agent('haris', 'maha', 'injection pattern in fetched page');
SELECT pg_temp.check((SELECT status FROM nerve.agents WHERE id = 'maha') = 'paused', 'Haris can pause an agent');
SELECT pg_temp.check((nerve.tool_call('maha', 'web.read', 'agent') ->> 'reason') = 'agent is paused', 'a paused agent cannot use tools');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.pause_agent('salem', 'fahd', 'x')$$, 'may not pause'), 'Salem cannot pause agents');
SELECT nerve.resume_agent('maha');
SELECT pg_temp.check((SELECT status FROM nerve.agents WHERE id = 'maha') = 'active'
                     AND EXISTS (SELECT 1 FROM nerve.events WHERE kind = 'human.resumed'), 'the owner resumes and it is logged');

-- ── Queues ──
SELECT nerve.send('owner', 'hakeem', '{"goal": "brief on oil"}', 'owner');
SELECT nerve.send('hakeem', 'maha', '{"question": "Brent supply news this week"}');
SELECT pg_temp.check((SELECT count(*) FROM nerve.read('maha', 30, 5)) = 1, 'the agent reads its message');
SELECT pg_temp.check((SELECT count(*) FROM nerve.read('maha', 30, 5)) = 0, 'a read message is hidden during its visibility timeout');
SELECT pg_temp.check((SELECT count(*) FROM nerve.read('salem', 30, 5)) = 0, 'agents only read their own queue');
SELECT pg_temp.check(NOT nerve.ack('salem', (SELECT msg_id FROM nerve.queue WHERE queue = 'maha')), 'agents cannot ack another queue');
SELECT pg_temp.check(nerve.ack('maha', (SELECT msg_id FROM nerve.queue WHERE queue = 'maha'), 'answered'), 'ack archives the message');
SELECT pg_temp.check((SELECT count(*) FROM nerve.queue_archive WHERE outcome = 'answered') = 1, 'archive keeps the outcome');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.send('salem', 'fahd', '{"x": 1}')$$, 'send refused'), 'agents without queue.send cannot send');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.send('hakeem', 'fahd', '{"x": 1}', 'tainted')$$, 'send refused'),
                     'tainted input cannot start a task');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.send('hakeem', 'fahd', '{"x": 1}', 'owner')$$, 'does not match sender'),
                     'an agent cannot raise a message to owner trust');
-- Visibility timeout: a message read with vt=1 comes back after it.
SELECT nerve.send('hakeem', 'badr', '{"review": "plan 1"}');
SELECT pg_temp.check((SELECT count(*) FROM nerve.read('badr', 1, 1)) = 1, 'first read');
SELECT pg_sleep(1.2);
SELECT pg_temp.check((SELECT read_ct FROM nerve.read('badr', 30, 1)) = 2, 'an unacked message reappears after its timeout');
-- Expiry
SELECT nerve.send('hakeem', 'salem', '{"x": 1}', 'agent', NULL, interval '1 millisecond');
SELECT pg_sleep(0.05);
SELECT nerve.expire() AS expired \gset
SELECT pg_temp.check(:expired = 1 AND (SELECT count(*) FROM nerve.queue_archive WHERE outcome = 'expired') = 1, 'expired tasks are archived');

-- ── Agent logins cannot impersonate the owner or touch tables ──
CREATE ROLE test_agent LOGIN IN ROLE nerve_agent;
SET SESSION AUTHORIZATION test_agent;
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM nerve.events$$, 'permission denied'), 'agent logins cannot read tables directly');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO nerve.queue (queue, sender, trust, run_id, message, deadline) VALUES ('fahd', 'x', 'owner', gen_random_uuid(), '{}', now())$$, 'permission denied'),
                     'agent logins cannot write tables directly');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.send('owner', 'fahd', '{"x": 1}', 'owner')$$, 'cannot send as owner'), 'agent logins cannot send as the owner');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.emit('owner', 'human.approved', 'owner')$$, 'may only write its own events'), 'agent logins cannot write as the owner');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.emit('salem', 'signal.x', 'system')$$, 'may only write its own events'), 'agent logins cannot claim system trust');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.pause_agent('owner', 'haris', 'x')$$, 'cannot act as the owner'), 'agent logins cannot pause as the owner');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve.resume_agent('maha')$$, 'permission denied'), 'agent logins cannot resume agents');
SELECT pg_temp.check(pg_temp.fails($$SELECT nerve._emit('owner', 'human.x', 'owner')$$, 'permission denied'), 'agent logins cannot call the internal writer');
SELECT pg_temp.check(nerve.emit('salem', 'signal.ok', 'agent') > 0, 'agent logins can log their own steps');
RESET SESSION AUTHORIZATION;

-- ── Ops Room views as PostgREST sees them ──
SET ROLE web_anon;
SELECT pg_temp.check((SELECT count(*) FROM api.nerve_agents) = 10, 'web_anon reads the agents view');
SELECT pg_temp.check((SELECT count(*) FROM api.nerve_events) > 20, 'web_anon reads the events view');
SELECT pg_temp.check((SELECT ok FROM api.nerve_chain), 'web_anon reads the chain status');
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM nerve.agents$$, 'permission denied'), 'web_anon cannot read nerve tables');
RESET ROLE;

SELECT pg_temp.check((SELECT ok FROM nerve.verify_chain()), 'whole chain still verifies at the end');
\echo 'nerve tests passed'

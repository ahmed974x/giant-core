-- Tests for the paper proposal gate (db/init/09-market.sh, ADR-083). Run with scripts/test-nerve.sh after brain_test.sql.
-- Two keys and an owner: فهد adds, راشد checks, only the owner decides, and nothing in this schema places an order.
SET client_min_messages = warning;
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

-- Logins named after the agents (fahd exists from brain_test.sql). Guards check session_user = the agent id.
SELECT format('CREATE ROLE salem LOGIN IN ROLE nerve_agent') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salem') \gexec
SELECT format('CREATE ROLE rashid LOGIN IN ROLE nerve_agent') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rashid') \gexec

SELECT coalesce(max(id), 0) AS event_mark FROM nerve.events \gset

-- ── Toolbelts: only فهد adds, only راشد checks, and no one else holds the gate tools ──
SELECT pg_temp.check((SELECT 'proposals.add' = ANY (tools) FROM nerve.agents WHERE id = 'fahd'), 'fahd holds proposals.add');
SELECT pg_temp.check((SELECT 'risk.check' = ANY (tools) FROM nerve.agents WHERE id = 'rashid'), 'rashid holds risk.check');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM nerve.agents WHERE id NOT IN ('fahd') AND 'proposals.add' = ANY (tools)),
                     'no other agent holds proposals.add');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM nerve.agents WHERE id NOT IN ('rashid') AND 'risk.check' = ANY (tools)),
                     'no other agent holds risk.check');
SELECT pg_temp.check(pg_temp.fails($$UPDATE nerve.agents SET tools = tools || '{risk.check}' WHERE id = 'fahd'$$, 'belongs only to rashid'),
                     'fahd cannot give itself the check');

-- ── Fahd adds: refusals first (each one must leave nothing behind) ──
SET SESSION AUTHORIZATION salem;
SELECT pg_temp.check(pg_temp.fails($$SELECT prop.add('salem', 'Zeta setup', 'a long idea', '[{"url": "https://example.org/a"}]', 100, 95, 115, 100)$$,
                                  'proposal refused'), 'salem cannot add a proposal (not in its toolbelt)');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION ameen;
SELECT pg_temp.check(pg_temp.fails($$SELECT prop.add('ameen', 'Zeta setup', 'a long idea', '[{"url": "https://example.org/a"}]', 100, 95, 115, 100)$$,
                                  'proposal refused'), 'ameen cannot add a proposal');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION hakeem;
SELECT pg_temp.check(pg_temp.fails($$SELECT prop.add('hakeem', 'Zeta setup', 'a long idea', '[{"url": "https://example.org/a"}]', 100, 95, 115, 100)$$,
                                  'proposal refused'), 'hakeem cannot add a proposal');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION fahd;
SELECT pg_temp.check(pg_temp.fails($$SELECT prop.add('fahd', 'Zeta setup', 'a long idea', '[]', 100, 95, 115, 100)$$,
                                  'needs evidence'), 'a proposal without evidence is refused');
SELECT pg_temp.check(pg_temp.fails($$SELECT prop.add('fahd', 'Zeta setup', 'a long idea', '[{"note": "trust me"}]', 100, 95, 115, 100)$$,
                                  'needs evidence'), 'evidence must be a link or an event id');
SELECT pg_temp.check(pg_temp.fails($$SELECT prop.add('fahd', 'Zeta setup', 'a short idea', '[{"url": "https://example.org/a"}]', 100, 105, 90, 100)$$,
                                  'long setups only'), 'a short setup is refused (long only in this version)');
SELECT pg_temp.check(pg_temp.fails($$SELECT prop.add('fahd', 'Zeta setup', 'a long idea', '[{"url": "https://example.org/a"}]', 100, 95, 115, 49)$$,
                                  'size_usdt'), 'a size below 50 USDT is refused');
SELECT pg_temp.check(pg_temp.fails($$SELECT prop.add('fahd', 'Zeta setup', 'a long idea', '[{"url": "https://example.org/a"}]', 100, 95, 115, 201)$$,
                                  'size_usdt'), 'a size above 200 USDT is refused');
SELECT pg_temp.check(prop.add('fahd', 'Key leak attempt', 'my key is sk-ant-api03-abcdefghijklmnopqrstuv', '[{"url": "https://example.org/a"}]', 100, 95, 115, 100) IS NULL,
                     'a key pasted into a rationale is refused and nothing is stored');

-- The good one (rr 3) and the weak one (rr 1), both long, both with evidence.
SELECT prop.add('fahd', 'Zeta breakout setup', 'a long idea on a clean breakout', '[{"url": "https://example.org/a"}]', 100, 95, 115, 100) AS good \gset
SELECT prop.add('fahd', 'Zeta weak setup', 'a long idea with a thin target', '[{"event": "42"}]', 100, 95, 105, 100) AS weak \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM prop.proposals WHERE title = 'Key leak attempt'), 'the refused key never reaches the table');
SELECT pg_temp.check(:good IS NOT NULL AND :weak IS NOT NULL, 'fahd adds two proposals with evidence');
SELECT pg_temp.check((SELECT rr = 3 AND status = 'pending_risk' FROM prop.proposals WHERE id = :good), 'the reward-to-risk is computed in SQL (3.0) and the proposal waits for the check');
SELECT pg_temp.check((SELECT rr = 1 FROM prop.proposals WHERE id = :weak), 'the weak setup computes rr 1.0');

-- ── Rashid checks: a fahd proposal cannot be checked by fahd, and a weak setup cannot pass ──
SET SESSION AUTHORIZATION fahd;
SELECT pg_temp.check(pg_temp.fails(format('SELECT prop.risk_check(''fahd'', %s, ''self check'')', :good), 'risk check refused'),
                     'fahd cannot check its own proposal');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION rashid;
SELECT pg_temp.check(pg_temp.fails(format('SELECT prop.add(''rashid'', ''x'', ''y'', ''[{"url": "https://example.org/a"}]'', 100, 95, 115, 100)'), 'proposal refused'),
                     'rashid cannot add a proposal');
SELECT prop.risk_check('rashid', :weak, 'the reward-to-risk is too thin') AS weak_verdict \gset
SELECT prop.risk_check('rashid', :good, 'the reward-to-risk is 3 and the size is inside the band') AS good_verdict \gset
SELECT pg_temp.check(pg_temp.fails(format('SELECT prop.risk_check(''rashid'', %s, ''again'')', :good), 'already'),
                     'a checked proposal cannot be checked twice');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:'weak_verdict' = 'risk_fail' AND :'good_verdict' = 'risk_pass', 'rashid fails the thin setup and passes the rr 3 setup');
SELECT pg_temp.check((SELECT risk_reason LIKE '%below 2%' FROM prop.proposals WHERE id = :weak), 'the failed check says why');

-- ── The owner decides; agents cannot even call it ──
SET SESSION AUTHORIZATION fahd;
SELECT pg_temp.check(pg_temp.fails(format('SELECT prop.decide(%s, ''approved'')', :good), 'permission denied'), 'fahd cannot decide');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION rashid;
SELECT pg_temp.check(pg_temp.fails(format('SELECT prop.decide(%s, ''approved'')', :good), 'permission denied'), 'rashid cannot decide');
RESET SESSION AUTHORIZATION;

-- Owner (the admin login, not an agent): a failed check cannot be approved, a checked one can.
SELECT pg_temp.check(pg_temp.fails(format('SELECT prop.decide(%s, ''approved'')', :weak), 'is not checked yet'),
                     'the owner cannot approve a setup that failed the check');
SELECT pg_temp.check(pg_temp.fails(format('SELECT prop.decide(%s, ''maybe'')', :good), 'approved or rejected'),
                     'a decision must be approved or rejected');
SELECT prop.decide(:good, 'approved');
SELECT pg_temp.check((SELECT status = 'approved' AND decided_at IS NOT NULL FROM prop.proposals WHERE id = :good),
                     'the owner approves on paper and the time is kept');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM nerve.events WHERE id > :event_mark AND kind = 'human.decided' AND trust = 'owner'),
                     'the owner decision is in the event log, as the owner');

-- ── A decided proposal is final and never rewritten ──
SELECT pg_temp.check(pg_temp.fails(format('UPDATE prop.proposals SET status = ''rejected'' WHERE id = %s', :good), 'final'),
                     'an approved proposal cannot be changed to rejected');
SELECT pg_temp.check(pg_temp.fails(format('UPDATE prop.proposals SET entry = 99, stop = 94 WHERE id = %s', :weak), 'not rewritten'),
                     'the numbers of a proposal are never rewritten');
SELECT pg_temp.check(pg_temp.fails(format('DELETE FROM prop.proposals WHERE id = %s', :weak), 'kept'), 'proposals are kept: no delete');

-- ── Nothing in the schema can move money or place an order ──
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                 WHERE n.nspname = 'prop' AND p.proname ~* '(order|fill|trade|exchange|transfer|withdraw|send|buy|sell|pay)'),
                     'no function in the prop schema places, fills or moves anything');
SELECT pg_temp.check((SELECT count(*) FROM pg_tables WHERE schemaname = 'prop') = 1, 'the prop schema holds one table: the proposals, nothing else');

-- ── The queue: rashid reads it, and the public page reads only the view ──
SET SESSION AUTHORIZATION rashid;
SELECT pg_temp.check((SELECT count(*) >= 2 FROM prop.queue('rashid')), 'rashid reads the queue');
RESET SESSION AUTHORIZATION;
SET ROLE web_anon;
SELECT pg_temp.check((SELECT count(*) >= 2 FROM api.prop_queue), 'the public view lists the queue');
SELECT pg_temp.check(pg_temp.fails('SELECT 1 FROM prop.proposals', 'permission denied'), 'web_anon cannot read the table');
RESET ROLE;

-- ── The audit trail: events carry ids and numbers, never a title or a rationale; the chain still verifies ──
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM nerve.events WHERE id > :event_mark AND kind LIKE 'proposal.%'
                                 AND (payload::text LIKE '%Zeta%' OR payload::text LIKE '%long idea%')),
                     'proposal events carry no title or rationale');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM nerve.events WHERE id > :event_mark AND kind = 'proposal.checked'), 'the checks are logged');
SELECT pg_temp.check((SELECT bool_and(ok) FROM nerve.verify_chain()), 'the event chain still verifies after the market work');

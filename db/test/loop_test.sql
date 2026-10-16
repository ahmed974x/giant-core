-- Tests for the brain loop (db/init/08-loop.sh, ADR-082). Run with scripts/test-nerve.sh after brain_test.sql.
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

-- Who may run the loop: only the planner
SELECT pg_temp.check(pg_temp.fails($$SET SESSION AUTHORIZATION fahd; SELECT loop.start('fahd', 'is oil rising?')$$, 'loop refused'),
                     'fahd (proposals clerk) cannot run the loop');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check((SELECT 'loop.run' = ANY (tools) FROM nerve.agents WHERE id = 'hakeem') AND
                     NOT EXISTS (SELECT 1 FROM nerve.agents WHERE id <> 'hakeem' AND 'loop.run' = ANY (tools)),
                     'only the planner holds loop.run');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO nerve.agents (id, name_ar, name_en, role, disclosure_ar, disclosure_en, tools, container)
                                     VALUES ('zy', 'ز', 'Z', 'x', 'أنا ز، وكيل ذكاء اصطناعي.', 'I am Z, an AI agent.', '{loop.run}', 'agent-core')$$,
                                  'belongs only to hakeem'), 'loop.run stays with the planner (sole holder)');

-- A run, as the planner
SET SESSION AUTHORIZATION hakeem;
SELECT loop.start('hakeem', 'is Brent likely to stay above 80 this month?', 3, 1000, NULL) AS run1 \gset
SELECT pg_temp.check(:'run1' IS NOT NULL, 'the planner starts a run');
SELECT (loop.step('hakeem', :'run1', 'plan', '{"subq": ["brent price this month"]}', 100, NULL)) ->> 'ok' AS s1 \gset
SELECT (loop.step('hakeem', :'run1', 'research', '{"sources": [{"url": "https://example.org/a"}]}', 200, NULL)) ->> 'ok' AS s2 \gset
SELECT (loop.step('hakeem', :'run1', 'analyse', '{"answer": "partly supported"}', 100, NULL)) ->> 'ok' AS s3 \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:'s1' = 'true' AND :'s2' = 'true' AND :'s3' = 'true', 'steps inside the budget are checkpointed');

SET SESSION AUTHORIZATION hakeem;
SELECT loop.step('hakeem', :'run1', 'critique', '{"gaps": []}', 10, NULL) ->> 'reason' AS over \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:'over' = 'budget reached', 'a fourth step past max_steps stops the run');
SELECT pg_temp.check((SELECT status FROM loop.runs WHERE id = :'run1') = 'incomplete', 'the run is marked incomplete, not done');
SET SESSION AUTHORIZATION hakeem;
SELECT pg_temp.check(pg_temp.fails(format($$SELECT loop.step('hakeem', %L, 'plan', '{}', 0, NULL)$$, :'run1'), 'already incomplete'),
                     'an incomplete run takes no more steps');
RESET SESSION AUTHORIZATION;

-- Token budget
SET SESSION AUTHORIZATION hakeem;
SELECT loop.start('hakeem', 'a second question about gold', 10, 300, NULL) AS run2 \gset
SELECT (loop.step('hakeem', :'run2', 'plan', '{"ok": 1}', 200, NULL)) ->> 'ok' AS t1 \gset
SELECT (loop.step('hakeem', :'run2', 'research', '{"ok": 2}', 200, NULL)) ->> 'reason' AS t2 \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:'t1' = 'true' AND :'t2' = 'budget reached', 'a token budget stops the run too');

-- Resume after a restart: the last checkpoint is the state to continue from
SET SESSION AUTHORIZATION hakeem;
SELECT loop.resume('hakeem', :'run1', NULL) ->> 'node' AS resume_node \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:'resume_node' = 'analyse', 'resume returns the last checkpointed node');

-- Secrets never enter a checkpoint: the run fails, nothing is stored
SET SESSION AUTHORIZATION hakeem;
SELECT loop.start('hakeem', 'check the key handling for groq', 5, 1000, NULL) AS run3 \gset
SELECT loop.step('hakeem', :'run3', 'plan', '{"note": "gsk_abcdefghijklmnopqrstuvwxyz0123"}', 0, NULL) ->> 'reason' AS sec \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:'sec' = 'secret refused' AND (SELECT status FROM loop.runs WHERE id = :'run3') = 'failed'
                     AND NOT EXISTS (SELECT 1 FROM loop.checkpoints WHERE run_id = :'run3'), 'a secret in a step fails the run and is not stored');

-- The planner cannot propose, order or touch the proposal queue
SET SESSION AUTHORIZATION hakeem;
SELECT pg_temp.check((SELECT (nerve.tool_call('hakeem', 'proposals.add', 'agent') ->> 'allowed')::boolean IS FALSE), 'hakeem cannot add a proposal');
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM loop.runs$$, 'permission denied'), 'the loop tables are not readable directly');
SELECT pg_temp.check(pg_temp.fails($$SELECT loop.finish('hakeem', $$ || quote_literal(:'run1') || $$, 'done', '{}', NULL)$$, 'not running'), 'a finished run cannot be finished again');
RESET SESSION AUTHORIZATION;

-- Append-only: nothing rewrites a checkpoint or a finished run
SELECT pg_temp.check(pg_temp.fails($$UPDATE loop.checkpoints SET state = '{}' WHERE run_id = $$ || quote_literal(:'run1'), 'append-only'),
                     'a checkpoint is never rewritten');
SELECT pg_temp.check(pg_temp.fails($$UPDATE loop.runs SET goal = 'changed' WHERE id = $$ || quote_literal(:'run1'), 'append-only'),
                     'a finished run is never rewritten');

-- Events carry ids and budgets, never the goal
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM nerve.events WHERE kind LIKE 'loop.%' AND (payload::text LIKE '%Brent%' OR payload::text LIKE '%gold%')),
                     'the event log never contains a goal');
SELECT pg_temp.check((SELECT count(*) FROM nerve.events WHERE kind = 'loop.budget') >= 2, 'budget stops are logged');
SELECT pg_temp.check((SELECT bool_and(ok) FROM nerve.verify_chain()), 'the event chain still verifies after the loop work');

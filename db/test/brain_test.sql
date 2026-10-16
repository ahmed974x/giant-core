-- Tests for the second brain (db/init/07-brain.sh, ADR-081). Run with scripts/test-nerve.sh after memory_test.sql.
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

-- Logins named after the agents: guard_session needs session_user = the agent id.
CREATE ROLE fahd LOGIN IN ROLE nerve_agent;
CREATE ROLE hakeem LOGIN IN ROLE nerve_agent;

-- ── Toolbelts: only أمين writes; hakeem may read; fahd and salem may not touch the brain ──
SELECT pg_temp.check((SELECT 'brain.write' = ANY (tools) AND 'brain.link' = ANY (tools) AND 'brain.read' = ANY (tools) FROM nerve.agents WHERE id = 'ameen'),
                     'ameen holds read, write and link');
SELECT pg_temp.check((SELECT 'brain.read' = ANY (tools) AND NOT ('brain.write' = ANY (tools)) FROM nerve.agents WHERE id = 'hakeem'),
                     'Hakeem may read the brain but not write it');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM nerve.agents WHERE id IN ('fahd', 'salem', 'maha', 'rashid', 'noura', 'badr', 'haris', 'khazen')
                                 AND tools && ARRAY['brain.read', 'brain.write', 'brain.link']), 'no other agent holds a brain tool');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO nerve.agents (id, name_ar, name_en, role, disclosure_ar, disclosure_en, tools, container)
                                     VALUES ('zz', 'ز', 'Z', 'x', 'أنا ز، وكيل ذكاء اصطناعي.', 'I am Z, an AI agent.', '{brain.write}', 'agent-core')$$,
                                  'belongs only to ameen'), 'the sole holder rule keeps brain.write with ameen');

-- ── Capture as ameen (the worker), with the write gate and the secret refusal ──
SELECT coalesce(max(id), 0) AS event_mark FROM nerve.events \gset
SET SESSION AUTHORIZATION ameen;
SELECT brain.capture('ameen', 'lamp idea: a reading lamp that follows the book', 'text', NULL, false, 'owner', NULL) AS raw1 \gset
SELECT brain.capture('ameen', 'Brent will break 90 and I am worried about it', 'text', NULL, false, 'owner', NULL) AS raw2 \gset
SELECT pg_temp.check(brain.capture('ameen', 'my key is sk-ant-api03-abcdefghijklmnopqrstuv', 'text', NULL, false, 'owner', NULL) IS NULL,
                     'a pasted key is refused and nothing is stored');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:raw1 IS NOT NULL AND :raw2 IS NOT NULL, 'ameen captures notes');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM brain.raw WHERE text LIKE '%sk-ant%'), 'the refused key never reaches the table');

-- Atoms (as ameen) with embeddings of the right length
SET SESSION AUTHORIZATION ameen;
SELECT brain.add_node('ameen', :raw1, 'a reading lamp that follows the book', 'idea', '{lamp}',
                      ARRAY[0.9,0.1,0,0,0.2,0,0.1,0]::real[], 'hashing-384', 'owner', NULL) AS n1 \gset
SELECT brain.add_node('ameen', :raw1, 'build a prototype with a cheap sensor', 'task', '{prototype}',
                      ARRAY[0.8,0.2,0,0,0.1,0,0.1,0]::real[], 'hashing-384', 'owner', NULL) AS n2 \gset
SELECT brain.add_node('ameen', :raw2, 'Brent will break 90', 'worry', '{Brent}',
                      ARRAY[0,0,0.9,0.8,0,0.1,0,0.2]::real[], 'hashing-384', 'owner', NULL) AS n3 \gset
SELECT brain.suggest_edge('ameen', :n1, :n2, 'leads_to', 0.7, 'a lamp idea that leads to a task', 'owner', NULL) AS e1 \gset
SELECT brain.suggest_edge('ameen', :n1, :n3, 'similar_to', 0.5, 'shared words', 'owner', NULL) AS e2 \gset
SELECT brain.add_human_edge('ameen', :n2, :n1, 'part_of', 'owner', NULL) AS h1 \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:n1 IS NOT NULL AND :n2 IS NOT NULL AND :n3 IS NOT NULL, 'atoms are added with their embeddings');
SELECT pg_temp.check(:e1 IS NOT NULL, 'a suggested link is stored');
SELECT pg_temp.check(brain.suggest_edge('ameen', :n1, :n2, 'leads_to', 0.9, 'duplicate', 'owner', NULL) IS NULL, 'the same link is not stored twice');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM brain.edges WHERE id = :e2 AND src < dst AND type = 'similar_to'), 'symmetric links are stored with the smaller id first');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM brain.edges WHERE id = :h1 AND origin = 'human' AND state = 'accepted'), 'a link the owner typed is accepted at once');

-- ── Agent logins: gateway, impersonation, direct access ──
SET SESSION AUTHORIZATION fahd;
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM brain.snapshot('fahd')$$, 'brain read refused'), 'fahd (proposals) cannot read the second brain');
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM brain.search('fahd', 'lamp')$$, 'brain read refused'), 'fahd cannot search the second brain');
SELECT pg_temp.check(pg_temp.fails($$SELECT brain.capture('fahd', 'hello')$$, 'brain write refused'), 'fahd cannot capture into the brain');
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM brain.nodes$$, 'permission denied'), 'no agent reads brain tables directly');
SELECT pg_temp.check((SELECT (nerve.tool_call('fahd', 'brain.read', 'agent') ->> 'allowed')::boolean IS FALSE), 'fahd cannot even ask the gateway for brain.read');
SELECT pg_temp.check(pg_temp.fails($$SELECT brain.evidence('fahd', 1)$$, 'brain read refused'), 'fahd cannot open evidence');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION hakeem;
SELECT pg_temp.check((brain.snapshot('hakeem') ->> 'nodes') IS NOT NULL, 'hakeem reads the brain snapshot (brain.read)');
SELECT pg_temp.check(pg_temp.fails($$SELECT brain.capture('hakeem', 'x')$$, 'brain write refused'), 'hakeem cannot write to the brain');
SELECT pg_temp.check(pg_temp.fails($$SELECT brain.capture('ameen', 'x')$$, 'may only act as itself'), 'hakeem cannot write under ameen''s name');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION ameen;
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM brain.nodes$$, 'permission denied'), 'ameen reads the brain only through functions');
SELECT pg_temp.check((SELECT (nerve.tool_call('ameen', 'proposals.add', 'agent') ->> 'allowed')::boolean IS FALSE), 'ameen cannot add trade proposals (sole holder fahd)');
SELECT pg_temp.check(pg_temp.fails($$SELECT brain.forget_user('owner')$$, 'permission denied'), 'ameen cannot erase the brain');
SELECT pg_temp.check((SELECT count(*) FROM brain.search('ameen', 'lamp')) >= 1, 'ameen finds atoms by words');
SELECT pg_temp.check((SELECT count(*) FROM brain.search('ameen', 'book', ARRAY[0.9,0.1,0,0,0.2,0,0.1,0]::real[])) >= 1, 'search also ranks by meaning');
SELECT brain.apply_clusters('ameen', '[{"key": 0, "name": "lamp and prototypes", "size": 2}]',
                            format('[{"id": %s, "cluster": 0}, {"id": %s, "cluster": 0}]', :n1, :n2)::jsonb, 'owner', NULL) AS clustered \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:clustered = 2 AND (SELECT cluster FROM brain.nodes WHERE id = :n1) = 0, 'clusters are named and applied');

-- ── The owner's taps ──
SET SESSION AUTHORIZATION ameen;
SELECT brain.decide_edge('ameen', :e1, 'accepted', 'owner', NULL);
SELECT pg_temp.check(pg_temp.fails($$SELECT brain.decide_edge('ameen', 1, 'accepted')$$, 'no suggested link'), 'an unknown link cannot be decided');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check((SELECT state FROM brain.edges WHERE id = :e1) = 'accepted', 'an accepted link is kept');
SELECT pg_temp.check(pg_temp.fails($$UPDATE brain.edges SET state = 'rejected' WHERE id = $$ || :e1, 'decided link is final'), 'a decision is final');
SET SESSION AUTHORIZATION ameen;
SELECT brain.decide_edge('ameen', :e2, 'rejected', 'owner', NULL);
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check((SELECT value FROM brain.settings WHERE key = 'similar_min') > 0.55, 'a rejected similarity raises the threshold');
SET SESSION AUTHORIZATION ameen;
SELECT pg_temp.check(brain.suggest_edge('ameen', :n1, :n3, 'similar_to', 0.6, 'again', 'owner', NULL) IS NULL, 'a rejected link is never suggested again');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check((SELECT count(*) FROM jsonb_array_elements((SELECT brain.snapshot('ameen') -> 'edges'))) = 2, 'the map shows accepted and suggested links, not rejected ones');

-- ── Append-only: nothing rewrites a captured thought (even the superuser) ──
SELECT pg_temp.check(pg_temp.fails($$UPDATE brain.nodes SET text = 'changed' WHERE id = $$ || :n1, 'never rewritten'), 'an atom is never rewritten');
SELECT pg_temp.check(pg_temp.fails($$UPDATE brain.raw SET text = 'changed' WHERE id = $$ || :raw1, 'append-only'), 'a raw note is never edited');
SELECT pg_temp.check(pg_temp.fails($$DELETE FROM brain.raw WHERE id = $$ || :raw1, 'append-only'), 'a raw note is never deleted');
SELECT pg_temp.check(pg_temp.fails($$UPDATE brain.edges SET confidence = 1 WHERE id = $$ || :e2, 'keeps its meaning'), 'a link keeps its meaning');

-- ── Events carry ids and counts, never the owner's words ──
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM nerve.events WHERE id > :event_mark
                                 AND (payload::text LIKE '%lamp%' OR payload::text LIKE '%Brent%' OR evidence::text LIKE '%lamp%')),
                     'the event log never contains a thought');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM nerve.events WHERE id > :event_mark AND kind = 'brain.captured'),
                     'captures are logged as ids and counts only');
SELECT pg_temp.check((SELECT bool_and(ok) FROM nerve.verify_chain()), 'the event chain still verifies after the brain work');

-- ── Right to forget: only the owner, and the rows go ──
SELECT pg_temp.check((brain.forget_user('owner') ->> 'raw')::int >= 2, 'the owner can erase the second brain');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM brain.raw) AND NOT EXISTS (SELECT 1 FROM brain.nodes) AND NOT EXISTS (SELECT 1 FROM brain.edges),
                     'after forgetting, no raw note, atom or link is left');
SELECT pg_temp.check((SELECT bool_and(ok) FROM nerve.verify_chain()), 'the event chain still verifies after forgetting');

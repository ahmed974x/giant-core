-- Tests for long-term memory (db/init/06-memory.sh). Run with scripts/test-nerve.sh after nerve_test.sql.
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

-- ── Write gate ──
SELECT pg_temp.check(pg_temp.fails($$SELECT mem.assert_fact('salem', 'Brent', 'price_band', '80-85', 'Brent trades 80-85', '[{"url": "https://example.org/a"}]')$$,
                     'memory write refused'), 'only Ameen writes facts (gateway)');
SELECT pg_temp.check(pg_temp.fails($$SELECT mem.assert_fact('ameen', 'Brent', 'price_band', '80-85', 'Brent trades 80-85', '[]')$$, 'needs evidence'),
                     'a fact without evidence is refused');
SELECT pg_temp.check(pg_temp.fails($$SELECT mem.assert_fact('ameen', 'Brent', 'price_band', '80-85', 'Brent trades 80-85', '[{"url": "javascript:alert(1)"}]')$$, 'needs evidence'),
                     'evidence must be an http(s) link or an event id');
SET client_min_messages = error;
SELECT pg_temp.check(mem.assert_fact('ameen', 'groq', 'key', 'gsk_abcdefghijklmnopqrstuvwxyz0123', 'the key is gsk_abcdefghijklmnopqrstuvwxyz0123', '[{"url": "https://example.org/a"}]') IS NULL
                     AND NOT EXISTS (SELECT 1 FROM mem.facts WHERE subject = 'groq'), 'a key-shaped string never enters memory');
SELECT pg_temp.check(mem.log_episode('salem', 'pasted sk-ant-api03-abcdefghijklmnopqrstuv by mistake') IS NULL
                     AND NOT EXISTS (SELECT 1 FROM mem.episodes), 'episodes refuse secrets too');
SET client_min_messages = notice;
SELECT pg_temp.check(EXISTS (SELECT 1 FROM nerve.events WHERE kind = 'guard.secret_refused'), 'a refused secret is logged (without the secret)');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM nerve.events WHERE payload::text LIKE '%gsk_abc%' OR payload::text LIKE '%sk-ant-api03%'), 'the secret itself is not in the log');
SELECT pg_temp.check(mem.looks_secret('AIzaSyA1234567890abcdefghijklmnopqrstu') AND mem.looks_secret('-----BEGIN RSA PRIVATE KEY-----')
                     AND NOT mem.looks_secret('سعر برنت بين 80 و 85 دولار'), 'secret detector: keys yes, normal Arabic text no');

-- ── Facts: verify, confirm, supersede (bitemporal) ──
SELECT mem.assert_fact('ameen', 'Brent', 'price_band', '80-85', 'Brent crude trades between 80 and 85 USD',
                       '[{"url": "https://example.org/brent-1"}]', 0.9, 'agent', now() - interval '2 days') AS f1 \gset
SELECT pg_temp.check((SELECT status FROM mem.facts WHERE id = :f1) = 'verified', 'a fact from a trusted source is verified');
SELECT mem.assert_fact('ameen', 'brent', 'PRICE_BAND', '80-85', 'Brent 80-85 again', '[{"url": "https://example.org/brent-2"}]', 0.95) AS f1b \gset
SELECT pg_temp.check(:f1b = :f1 AND (SELECT sources FROM mem.facts WHERE id = :f1) = 2 AND (SELECT confidence FROM mem.facts WHERE id = :f1) > 0.94,
                     'the same belief from a new source confirms it (no duplicate)');
SELECT mem.assert_fact('ameen', 'Brent', 'price_band', '80-85', 'same link again', '[{"url": "https://example.org/brent-2"}]') AS f1c \gset
SELECT pg_temp.check((SELECT sources FROM mem.facts WHERE id = :f1) = 2, 'repeating the same link is not a new source');

SELECT now() AS before_change \gset
SELECT pg_sleep(0.01);
SELECT mem.assert_fact('ameen', 'Brent', 'price_band', '90-95', 'Brent crude jumped to 90-95 USD', '[{"url": "https://example.org/brent-3"}]', 0.7) AS f2 \gset
SELECT pg_temp.check((SELECT superseded_by FROM mem.facts WHERE id = :f1) = :f2 AND (SELECT valid_to FROM mem.facts WHERE id = :f1) IS NOT NULL,
                     'a new belief supersedes the old one, which is kept with its dates');
SELECT pg_temp.check((SELECT count(*) FROM mem.facts WHERE lower(subject) = 'brent' AND superseded_at IS NULL) = 1, 'only one current belief per subject+predicate');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM nerve.events WHERE kind = 'memory.contradiction' AND (payload ->> 'old_fact')::bigint = :f1),
                     'overturning a strong belief raises a contradiction for Badr');
SELECT pg_temp.check((SELECT text FROM mem.search('Brent crude', NULL, 5, 'owner', :'before_change') WHERE kind = 'fact' LIMIT 1) = 'Brent crude trades between 80 and 85 USD',
                     'as-of recall: what we believed before the change');
SELECT pg_temp.check((SELECT text FROM mem.search('Brent crude', NULL, 5) WHERE kind = 'fact' LIMIT 1) = 'Brent crude jumped to 90-95 USD',
                     'current recall: what we believe now');
SELECT pg_temp.check(pg_temp.fails($$UPDATE mem.facts SET statement = 'edited' WHERE id = 1$$, 'never edited'), 'a fact''s content cannot be edited');
SELECT pg_temp.check(pg_temp.fails($$DELETE FROM mem.facts WHERE id = 1$$, 'never deleted'), 'facts cannot be deleted');

-- Tainted sources stay unverified until a second independent source.
SELECT mem.assert_fact('ameen', 'Hormuz', 'status', 'closed', 'A post says the Strait of Hormuz is closed',
                       '[{"url": "https://social.example/post/1"}]', 0.4, 'tainted') AS t1 \gset
SELECT pg_temp.check((SELECT status FROM mem.facts WHERE id = :t1) = 'unverified', 'a fact from tainted input is unverified');
SELECT pg_temp.check((SELECT score FROM mem.search('Hormuz') WHERE id = :t1) < (1.0 / 61 + 0.3 / 61), 'unverified facts rank lower');
SELECT mem.assert_fact('ameen', 'Hormuz', 'status', 'closed', 'Port authority confirms', '[{"url": "https://gov.example/notice"}]', 0.8) AS t1b \gset
SELECT pg_temp.check((SELECT status FROM mem.facts WHERE id = :t1) = 'verified', 'a second independent source verifies it');

-- ── Episodes and hybrid search ──
SELECT mem.log_episode('maha', 'بحثت عن أخبار شحن النفط في الخليج، ثلاثة مصادر متفقة', '{"sources": 3}') AS e1 \gset
SELECT mem.log_episode('salem', 'Gold moved with the dollar index this week') AS e2 \gset
SELECT pg_temp.check((SELECT id FROM mem.search('النفط الخليج') LIMIT 1) = :e1, 'Arabic words find the Arabic episode');
SELECT pg_temp.check((SELECT kind FROM mem.search('gold dollar') LIMIT 1) = 'episode', 'English words find the English episode');
-- Meaning: give two rows embeddings, search with a vector close to one of them and no matching words.
SELECT mem.set_embedding('episode', :e2, array_fill(0.0::real, ARRAY[8]) || ARRAY[1,1,0,0,0,0,0,0]::real[], 'test');
SELECT mem.set_embedding('episode', :e1, ARRAY[1,1,0,0,0,0,0,0]::real[] || array_fill(0.0::real, ARRAY[8]), 'test');
SELECT pg_temp.check((SELECT id FROM mem.search('zzz-no-words', ARRAY[0,0,0,0,0,0,0,0, 0.9,1,0.1,0,0,0,0,0]::real[]) LIMIT 1) = :e2,
                     'embeddings find by meaning when no words match');
SELECT pg_temp.check(mem.cosine(ARRAY[1,0]::real[], ARRAY[1,0,0]::real[]) IS NULL, 'vectors of different sizes never compare');
SELECT pg_temp.check((SELECT count(*) FROM mem.search('', NULL)) = 0, 'an empty query returns nothing');
SELECT pg_temp.check((SELECT count(*) FROM mem.pending_embeddings(100)) >= 3, 'rows without embeddings are queued for the worker');

-- ── Skills ──
SELECT mem.save_skill('ameen', 'oil-brief', 'Morning oil brief', '["read Brent", "read World Pulse", "write 5 lines with links"]');
SELECT pg_temp.check((SELECT status FROM mem.skills WHERE name = 'oil-brief') = 'draft', 'a new skill starts as a draft');
SELECT pg_temp.check(pg_temp.fails($$SELECT mem.review_skill('salem', 'oil-brief', true)$$, 'only بدر'), 'only Badr reviews skills');
SELECT mem.review_skill('badr', 'oil-brief', true);
SELECT mem.skill_used('oil-brief', false) FROM generate_series(1, 4);
SELECT mem.skill_used('oil-brief', true);
SELECT mem.sleep() AS sleep1 \gset
SELECT pg_temp.check((SELECT status FROM mem.skills WHERE name = 'oil-brief') = 'retired', 'sleep retires a skill that keeps failing');

-- ── Calibration ledger ──
SELECT mem.forecast('salem', 'BTC closes above 100k on Friday', 0.8, now() + interval '1 day') AS fc1 \gset
SELECT mem.forecast('salem', 'Gold closes higher this week', 0.3, now() + interval '1 day') AS fc2 \gset
SELECT pg_temp.check(pg_temp.fails(format($$SELECT mem.resolve_forecast('salem', %s, true, '[{"url": "https://example.org/close"}]')$$, :fc1), 'cannot grade its own'),
                     'an agent cannot grade its own forecast');
SELECT pg_temp.check(pg_temp.fails(format($$SELECT mem.resolve_forecast('system', %s, true, '[]')$$, :fc1), 'needs evidence'), 'resolving needs evidence');
SELECT pg_temp.check(abs(mem.resolve_forecast('system', :fc1, true, '[{"url": "https://example.org/close"}]') - 0.04) < 1e-6, 'Brier score (0.8 said, it happened) = 0.04');
SELECT mem.resolve_forecast('system', :fc2, false, '[{"url": "https://example.org/gold"}]');
SELECT pg_temp.check((SELECT resolved FROM mem.calibration WHERE agent = 'salem') = 2 AND (SELECT brier FROM mem.calibration WHERE agent = 'salem') = 0.065,
                     'calibration per agent: mean Brier over resolved forecasts');
SELECT pg_temp.check((SELECT skill_vs_coin FROM mem.calibration WHERE agent = 'salem') > 0, 'Salem beats a coin flip so far');

-- ── Agent logins and the owner ──
CREATE ROLE test_mem_agent LOGIN IN ROLE nerve_agent;
SET SESSION AUTHORIZATION test_mem_agent;
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM mem.facts$$, 'permission denied'), 'agent logins cannot read memory tables directly');
SELECT pg_temp.check((SELECT count(*) FROM mem.search('Brent')) >= 1, 'agent logins recall through mem.search');
SELECT pg_temp.check(pg_temp.fails($$SELECT mem.forget_user('owner')$$, 'permission denied'), 'agent logins cannot erase memory');
SELECT pg_temp.check(pg_temp.fails($$SELECT mem.sleep()$$, 'permission denied'), 'only the keeper role runs the nightly sleep');
SELECT pg_temp.check(pg_temp.fails($$SELECT mem.log_episode('salem', 'x', '{}', 'owner')$$, 'agent or tainted'), 'agent logins cannot log with owner trust');
SELECT pg_temp.check(pg_temp.fails(format($$SELECT mem.resolve_forecast('owner', %s, true, '[{"url": "https://e.org"}]')$$,
                                          mem.forecast('rashid', 'drawdown stays under 5 pct', 0.6, now() + interval '2 days')), 'cannot act as the owner'),
                     'agent logins cannot grade as the owner');
RESET SESSION AUTHORIZATION;

SET ROLE web_anon;
SELECT pg_temp.check((SELECT facts FROM api.mem_stats) >= 2 AND (SELECT count(*) FROM api.mem_facts) >= 2, 'Ops Room views work for web_anon');
RESET ROLE;

-- ── Right to forget ──
SELECT mem.log_episode('noura', 'explained paper trading to a guest', '{}', 'agent', NULL, '[]', 'guest-1');
SELECT mem.assert_fact('ameen', 'guest-1', 'level', 'beginner', 'guest-1 is new to trading', '[{"event": "1"}]', 0.6, 'agent', NULL, 'guest-1');
SELECT pg_temp.check((mem.forget_user('guest-1') ->> 'episodes')::int = 1, 'a user''s memories can be erased on request');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM mem.facts WHERE user_id = 'guest-1') AND EXISTS (SELECT 1 FROM mem.facts WHERE user_id = 'owner'),
                     'forgetting one user leaves the others');
SELECT pg_temp.check(pg_temp.fails($$DELETE FROM mem.facts WHERE user_id = 'owner'$$, 'never deleted'), 'the delete switch is off again afterwards');
SELECT pg_temp.check((SELECT ok FROM nerve.verify_chain()), 'event chain still verifies after all memory writes');
\echo 'memory tests passed'

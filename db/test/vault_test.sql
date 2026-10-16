-- Tests for the paper Vault (db/init/10-vault.sh, ADR-085). Run with scripts/test-nerve.sh after market_test.sql.
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

-- The keeper's login (khazen exists in the agent registry from 05; its login is created here for the test).
SELECT format('CREATE ROLE khazen LOGIN IN ROLE nerve_agent') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khazen') \gexec

SELECT coalesce(max(id), 0) AS event_mark FROM nerve.events \gset

-- ── Paper only, by construction ──
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO vault.accounts (id, kind, name_ar, name_en, mode) VALUES ('bank:real', 'asset', 'بنك', 'Bank', 'live')$$, 'violates check'),
                     'an account cannot be live (only paper)');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO vault.accounts (id, kind, name_ar, name_en, currency) VALUES ('cash:eur', 'asset', 'يورو', 'Euro', 'EUR')$$, 'violates check'),
                     'an account cannot hold another currency');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO vault.accounts (id, kind, name_ar, name_en) VALUES ('Bank:Real', 'asset', 'x', 'x')$$, 'violates check'),
                     'an account id has the lower-case form only');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.accounts WHERE mode <> 'paper' OR currency <> 'USDT'), 'every account is paper USDT');

-- ── Posting: the owner only ──
SET SESSION AUTHORIZATION khazen;
SELECT pg_temp.check(pg_temp.fails($$SELECT vault.post('khazen', 'a made-up deposit', '[{"account":"cash:paper","debit":500},{"account":"equity:owner","credit":500}]')$$,
                                  'permission denied'), 'khazen cannot post an entry');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION fahd;
SELECT pg_temp.check(pg_temp.fails($$SELECT vault.post('fahd', 'a made-up deposit', '[{"account":"cash:paper","debit":500},{"account":"equity:owner","credit":500}]')$$,
                                  'permission denied'), 'fahd cannot post an entry');
RESET SESSION AUTHORIZATION;

-- ── Double entry (checked at commit) ──
SELECT pg_temp.check(pg_temp.fails($$SELECT vault.post('owner', 'one sided', '[{"account":"cash:paper","debit":500},{"account":"equity:owner","credit":400}]')$$,
                                  'not balanced'), 'an unbalanced journal is refused at commit');
SELECT pg_temp.check(pg_temp.fails($$SELECT vault.post('owner', 'one line only', '[{"account":"cash:paper","debit":500}]')$$,
                                  'at least two lines'), 'a journal needs two lines');
SELECT pg_temp.check(pg_temp.fails($$SELECT vault.post('owner', 'both sides', '[{"account":"cash:paper","debit":5,"credit":5},{"account":"equity:owner","credit":0}]')$$,
                                  'violates check'), 'a line has one side only');
SELECT pg_temp.check(pg_temp.fails($$SELECT vault.post('owner', 'unknown account', '[{"account":"bank:real","debit":5},{"account":"equity:owner","credit":5}]')$$,
                                  'foreign key'), 'an unknown account is refused');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.journal WHERE memo IN ('one sided', 'one line only', 'both sides', 'unknown account')),
                     'refused journals leave nothing behind');

-- A balanced opening entry and a paper gain, as the owner.
SELECT vault.post('owner', 'opening paper capital', '[{"account":"cash:paper","debit":1000},{"account":"equity:owner","credit":1000}]') AS open_j \gset
SELECT vault.post('owner', 'paper gain on a closed paper setup', '[{"account":"cash:paper","debit":40},{"account":"income:paper_pnl","credit":40}]') AS gain_j \gset
SELECT vault.post('owner', 'paper fee', '[{"account":"expense:paper_fees","debit":2},{"account":"cash:paper","credit":2}]') AS fee_j \gset
SELECT pg_temp.check(:open_j IS NOT NULL AND :gain_j IS NOT NULL AND :fee_j IS NOT NULL, 'the owner posts balanced entries');
SELECT pg_temp.check((SELECT balance = 1038 FROM api.vault_balances WHERE account = 'cash:paper'), 'the paper cash is 1038 after the three entries');
SELECT pg_temp.check((SELECT balance = 40 FROM api.vault_balances WHERE account = 'income:paper_pnl'), 'the paper gain shows as income');

-- ── Append-only ──
SELECT pg_temp.check(pg_temp.fails('UPDATE vault.lines SET debit = 9999', 'append-only'), 'a line cannot be changed');
SELECT pg_temp.check(pg_temp.fails('DELETE FROM vault.journal', 'append-only'), 'a journal cannot be deleted');
SELECT pg_temp.check(pg_temp.fails('UPDATE vault.accounts SET name_en = ''x''', 'append-only'), 'an account cannot be renamed');

-- ── Reconcile: the keeper through the gateway, and the owner directly ──
SET SESSION AUTHORIZATION khazen;
SELECT vault.reconcile('khazen') AS kz \gset
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check((:'kz'::jsonb ->> 'balanced')::boolean AND (:'kz'::jsonb ->> 'equation_ok')::boolean, 'khazen reconciles: balanced and the paper books agree');
SET SESSION AUTHORIZATION fahd;
SELECT pg_temp.check(pg_temp.fails($$SELECT vault.reconcile('fahd')$$, 'reconcile refused'), 'fahd cannot reconcile (not in its toolbelt)');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check((SELECT (vault.reconcile('owner') ->> 'balanced')::boolean), 'the owner reconciles the same way');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM vault.reconciliations WHERE by_who = 'khazen' AND balanced),
                     'each reconciliation is kept');

-- ── The public view: paper labels, no journal internals ──
SET ROLE web_anon;
SELECT pg_temp.check((SELECT count(*) = 4 AND bool_and(mode = 'paper') FROM api.vault_balances), 'the public balances are four paper accounts');
SELECT pg_temp.check((SELECT count(*) >= 6 FROM api.vault_statement), 'the public statement lists the lines');
SELECT pg_temp.check(pg_temp.fails('SELECT 1 FROM vault.journal', 'permission denied'), 'web_anon cannot read the journal');
SELECT pg_temp.check(pg_temp.fails('SELECT vault.post(''owner'', ''x'', ''[]'')', 'permission denied'), 'web_anon cannot post');
RESET ROLE;

-- ── Nothing here moves money; the words say what it is ──
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                 WHERE n.nspname = 'vault' AND p.proname ~* '(order|fill|transfer|withdraw|send|buy|sell|pay|exchange|convert|deposit)'),
                     'no function in the vault places, moves, pays or converts anything');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM api.vault_balances WHERE note LIKE '%not a bank%'), 'the public view says it is not a bank');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM nerve.events WHERE id > :event_mark AND kind = 'vault.posted' AND trust = 'owner'),
                     'postings are logged as the owner');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM nerve.events WHERE id > :event_mark AND kind LIKE 'vault.%'
                                 AND (payload::text LIKE '%opening paper capital%' OR payload::text LIKE '%paper fee%')),
                     'vault events carry ids and counts, never a memo');
SELECT pg_temp.check((SELECT bool_and(ok) FROM nerve.verify_chain()), 'the event chain still verifies after the vault work');

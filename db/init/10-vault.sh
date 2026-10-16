#!/bin/sh
# The paper Vault (ADR-085; design docs/agents/ARCHITECTURE-AGENTS.md section 8). Needs 05 to 09.
# A double-entry ledger for PAPER numbers only. It is not a bank: it holds no money, has no bank or exchange account,
# and no function here moves, pays, withdraws or converts anything. Every account is paper (mode = 'paper', USDT units).
# Every journal must balance when its transaction commits. Rows are append-only: a mistake is a reversing entry.
# Only the owner posts entries; خازن (khazen) may only reconcile and read.
set -eu

PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

if ! $PSQL -tA -c "SELECT 1 FROM pg_namespace WHERE nspname = 'vault'" | grep -q 1; then
$PSQL --single-transaction <<'SQL'
-- The event log learns the vault family (same pattern as 07 and 08).
ALTER TABLE nerve.events DROP CONSTRAINT events_kind_check;
ALTER TABLE nerve.events ADD CONSTRAINT events_kind_check
  CHECK (kind ~ '^(signal|task|tool|memory|proposal|human|guard|agent|brain|loop|vault)\.[a-z_]+$');

CREATE SCHEMA vault;

-- The chart of accounts. Paper only: the mode and the currency are fixed by CHECK, and no account can say otherwise.
CREATE TABLE vault.accounts (
  id       text PRIMARY KEY CHECK (id ~ '^[a-z]+:[a-z_]+$'),          -- e.g. cash:paper, equity:owner
  kind     text NOT NULL CHECK (kind IN ('asset', 'liability', 'equity', 'income', 'expense')),
  name_ar  text NOT NULL,
  name_en  text NOT NULL,
  mode     text NOT NULL DEFAULT 'paper' CHECK (mode = 'paper'),
  currency text NOT NULL DEFAULT 'USDT' CHECK (currency = 'USDT')
);
INSERT INTO vault.accounts (id, kind, name_ar, name_en) VALUES
  ('cash:paper',      'asset',   'الصندوق الورقي',   'Paper cash'),
  ('equity:owner',    'equity',  'رأس مال المالك الورقي', 'Owner paper capital'),
  ('income:paper_pnl','income',  'أرباح ورقية',       'Paper gains'),
  ('expense:paper_fees','expense','رسوم ورقية',        'Paper fees');

CREATE TABLE vault.journal (
  id      bigserial PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  memo    text NOT NULL CHECK (length(memo) BETWEEN 3 AND 200),
  by_who  text NOT NULL,
  run_id  uuid
);

CREATE TABLE vault.lines (
  id         bigserial PRIMARY KEY,
  journal_id bigint NOT NULL REFERENCES vault.journal (id),
  account_id text NOT NULL REFERENCES vault.accounts (id),
  debit      numeric NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit     numeric NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0) <> (credit > 0))                                   -- exactly one side per line
);

CREATE TABLE vault.reconciliations (
  id           bigserial PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  by_who       text NOT NULL,
  balanced     boolean NOT NULL,
  equation_ok  boolean NOT NULL,
  journals     bigint NOT NULL,
  lines        bigint NOT NULL,
  total_debit  numeric NOT NULL,
  total_credit numeric NOT NULL,
  differences  jsonb NOT NULL DEFAULT '[]'
);

-- Append-only: nothing is updated or deleted. A wrong entry gets a reversing entry.
CREATE FUNCTION vault.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'the paper ledger is append-only (post a reversing entry instead)'; END $$;
CREATE TRIGGER journal_append_only BEFORE UPDATE OR DELETE ON vault.journal FOR EACH ROW EXECUTE FUNCTION vault.append_only();
CREATE TRIGGER lines_append_only BEFORE UPDATE OR DELETE ON vault.lines FOR EACH ROW EXECUTE FUNCTION vault.append_only();
CREATE TRIGGER accounts_append_only BEFORE UPDATE OR DELETE ON vault.accounts FOR EACH ROW EXECUTE FUNCTION vault.append_only();
CREATE TRIGGER reconciliations_append_only BEFORE UPDATE OR DELETE ON vault.reconciliations FOR EACH ROW EXECUTE FUNCTION vault.append_only();

-- Double entry: vault.post refuses an unbalanced entry before writing. This trigger is the backstop for any direct insert:
-- it runs when the transaction commits, so a whole entry lands or nothing does.
CREATE FUNCTION vault.check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO d, c FROM vault.lines WHERE journal_id = NEW.journal_id;
  IF d <> c THEN RAISE EXCEPTION 'journal % is not balanced (debit % credit %)', NEW.journal_id, d, c; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lines_balanced AFTER INSERT ON vault.lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vault.check_balanced();

-- The owner posts an entry. Agents are refused here and have no grant on this function.
-- p_lines: [{"account": "cash:paper", "debit": 100}, {"account": "equity:owner", "credit": 100}]
CREATE FUNCTION vault.post(p_by text, p_memo text, p_lines jsonb, p_run uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, nerve, pg_temp AS $$
DECLARE jid bigint; l jsonb; sd numeric; sc numeric;
BEGIN
  IF nerve.caller_is_agent() THEN RAISE EXCEPTION 'only the owner posts to the paper ledger'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN RAISE EXCEPTION 'a journal needs at least two lines'; END IF;
  SELECT coalesce(sum((e ->> 'debit')::numeric), 0), coalesce(sum((e ->> 'credit')::numeric), 0) INTO sd, sc
    FROM jsonb_array_elements(p_lines) AS e;
  IF sd <> sc THEN RAISE EXCEPTION 'journal is not balanced (debit % credit %)', sd, sc; END IF;   -- refused before any row
  INSERT INTO vault.journal (memo, by_who, run_id) VALUES (p_memo, p_by, p_run) RETURNING id INTO jid;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO vault.lines (journal_id, account_id, debit, credit)
    VALUES (jid, l ->> 'account', coalesce((l ->> 'debit')::numeric, 0), coalesce((l ->> 'credit')::numeric, 0));
  END LOOP;
  PERFORM nerve._emit(p_by, 'vault.posted', 'owner', jsonb_build_object('journal', jid, 'lines', jsonb_array_length(p_lines)), '[]', p_run);
  RETURN jid;
END $$;

-- Reconcile: every journal balances, and the paper books satisfy assets = liabilities + equity + income - expenses.
-- The owner calls it directly; خازن calls it through the tool gateway (vault.reconcile, sole holder khazen).
CREATE FUNCTION vault.reconcile(p_by text, p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, nerve, pg_temp AS $$
DECLARE gate jsonb; d numeric; c numeric; nj bigint; nl bigint; lhs numeric; rhs numeric; diffs jsonb; ok boolean; eq boolean;
BEGIN
  IF nerve.caller_is_agent() THEN
    IF p_by IS DISTINCT FROM session_user THEN RAISE EXCEPTION 'an agent may only act as itself'; END IF;
    gate := nerve.tool_call(p_by, 'vault.reconcile', 'agent', '{}', p_run);
    IF NOT (gate ->> 'allowed')::boolean THEN RAISE EXCEPTION 'reconcile refused: %', gate ->> 'reason'; END IF;
  END IF;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, nl FROM vault.lines;
  SELECT count(*) INTO nj FROM vault.journal;
  SELECT coalesce(jsonb_agg(jsonb_build_object('journal', x.journal_id, 'difference', x.dd - x.cc)), '[]') INTO diffs
    FROM (SELECT journal_id, sum(debit) AS dd, sum(credit) AS cc FROM vault.lines GROUP BY journal_id HAVING sum(debit) <> sum(credit)) x;
  SELECT coalesce(sum(CASE WHEN a.kind = 'asset' THEN l.debit - l.credit END), 0),
         coalesce(sum(CASE WHEN a.kind IN ('liability', 'equity', 'income', 'expense') THEN l.credit - l.debit END), 0)
    INTO lhs, rhs FROM vault.lines l JOIN vault.accounts a ON a.id = l.account_id;
  ok := d = c AND diffs = '[]'::jsonb;
  eq := lhs = rhs;
  INSERT INTO vault.reconciliations (by_who, balanced, equation_ok, journals, lines, total_debit, total_credit, differences)
  VALUES (p_by, ok, eq, nj, nl, d, c, diffs);
  PERFORM nerve._emit(p_by, 'vault.reconciled', CASE WHEN p_by = 'owner' THEN 'owner' ELSE 'agent' END, jsonb_build_object('balanced', ok, 'equation_ok', eq, 'journals', nj, 'lines', nl), '[]', p_run);
  RETURN jsonb_build_object('balanced', ok, 'equation_ok', eq, 'journals', nj, 'lines', nl,
                            'total_debit', d, 'total_credit', c, 'differences', diffs);
END $$;

-- Public, read-only, and labelled as paper in every row.
CREATE VIEW api.vault_balances AS
  SELECT a.id AS account, a.name_ar, a.name_en, a.kind, a.currency, a.mode,
         CASE WHEN a.kind IN ('asset', 'expense') THEN coalesce(sum(l.debit - l.credit), 0)
              ELSE coalesce(sum(l.credit - l.debit), 0) END AS balance,
         'ورقي فقط. ليس حساباً بنكياً ولا يحفظ أموالاً. Paper only: not a bank account, holds no funds.' AS note
  FROM vault.accounts a LEFT JOIN vault.lines l ON l.account_id = a.id
  GROUP BY a.id, a.name_ar, a.name_en, a.kind, a.currency, a.mode;

CREATE VIEW api.vault_statement AS
  SELECT j.id AS journal, j.ts, j.memo, l.account_id AS account, l.debit, l.credit, 'paper' AS mode
  FROM vault.journal j JOIN vault.lines l ON l.journal_id = j.id
  ORDER BY j.id, l.id;

REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vault FROM PUBLIC;
GRANT USAGE ON SCHEMA vault TO nerve_agent;
GRANT EXECUTE ON FUNCTION vault.reconcile(text, uuid) TO nerve_agent;
-- vault.post keeps no grant: the owner's login only.
GRANT SELECT ON api.vault_balances, api.vault_statement TO web_anon;
SQL
echo "paper vault created"
else
  echo "paper vault already present"
fi

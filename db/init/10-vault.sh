#!/bin/sh
# The paper Vault (ADR-085; design docs/agents/ARCHITECTURE-AGENTS.md sections 8 and 9). Needs 05 to 09.
# A double-entry ledger for PAPER numbers only. It is not a bank: it holds no money, has no bank or exchange account,
# and no function here moves, pays, withdraws or converts anything. Every account is paper (mode = 'paper', USDT units).
# Every journal must balance; sub-ledgers (one per strategy or user) keep their own books; money crosses between
# sub-ledgers only through a recorded transfer. Rows are append-only: a mistake is a reversing entry.
# Only the owner posts entries; خازن (khazen) may only reconcile and read. A reconciliation that finds a difference
# freezes new proposals (prop.freeze) until the books agree again.
set -eu

PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

if ! $PSQL -tA -c "SELECT 1 FROM pg_namespace WHERE nspname = 'vault'" | grep -q 1; then
$PSQL --single-transaction <<'SQL'
-- The event log learns the vault family (same pattern as 07 and 08).
ALTER TABLE nerve.events DROP CONSTRAINT events_kind_check;
ALTER TABLE nerve.events ADD CONSTRAINT events_kind_check
  CHECK (kind ~ '^(signal|task|tool|memory|proposal|human|guard|agent|brain|loop|vault)\.[a-z_]+$');

CREATE SCHEMA vault;

-- Sub-ledgers: one book per strategy or user. 'owner' is the main book.
CREATE TABLE vault.ledgers (
  id         text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{2,30}$'),
  label      text NOT NULL CHECK (length(label) BETWEEN 2 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO vault.ledgers (id, label) VALUES ('owner', 'Owner paper book');

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
  ('cash:paper',        'asset',   'الصندوق الورقي',         'Paper cash'),
  ('equity:owner',      'equity',  'رأس مال المالك الورقي',  'Owner paper capital'),
  ('equity:transfer',   'equity',  'تحويل بين الدفاتر الورقية', 'Paper transfer clearing'),
  ('income:paper_pnl',  'income',  'أرباح ورقية',            'Paper gains'),
  ('expense:paper_fees','expense', 'رسوم ورقية',             'Paper fees');

CREATE TABLE vault.journal (
  id      bigserial PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  ledger  text NOT NULL REFERENCES vault.ledgers (id) DEFAULT 'owner',
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
CREATE TRIGGER ledgers_append_only BEFORE UPDATE OR DELETE ON vault.ledgers FOR EACH ROW EXECUTE FUNCTION vault.append_only();
CREATE TRIGGER journal_append_only BEFORE UPDATE OR DELETE ON vault.journal FOR EACH ROW EXECUTE FUNCTION vault.append_only();
CREATE TRIGGER lines_append_only BEFORE UPDATE OR DELETE ON vault.lines FOR EACH ROW EXECUTE FUNCTION vault.append_only();
CREATE TRIGGER accounts_append_only BEFORE UPDATE OR DELETE ON vault.accounts FOR EACH ROW EXECUTE FUNCTION vault.append_only();
CREATE TRIGGER reconciliations_append_only BEFORE UPDATE OR DELETE ON vault.reconciliations FOR EACH ROW EXECUTE FUNCTION vault.append_only();

-- Double entry: each journal's debits equal its credits, checked when the transaction commits (a backstop for any direct insert).
CREATE FUNCTION vault.check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO d, c FROM vault.lines WHERE journal_id = NEW.journal_id;
  IF d <> c THEN RAISE EXCEPTION 'journal % is not balanced (debit % credit %)', NEW.journal_id, d, c; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lines_balanced AFTER INSERT ON vault.lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vault.check_balanced();

-- The owner opens a sub-ledger (one per strategy or user). Agents cannot.
CREATE FUNCTION vault.open_ledger(p_by text, p_id text, p_label text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, nerve, pg_temp AS $$
BEGIN
  IF nerve.caller_is_agent() THEN RAISE EXCEPTION 'only the owner opens a paper sub-ledger'; END IF;
  INSERT INTO vault.ledgers (id, label) VALUES (p_id, p_label);
  PERFORM nerve._emit(p_by, 'vault.ledger_opened', 'owner', jsonb_build_object('ledger', p_id), '[]');
END $$;

-- The owner posts an entry to one sub-ledger. Agents are refused here and have no grant on this function.
-- p_lines: [{"account": "cash:paper", "debit": 100}, {"account": "equity:owner", "credit": 100}]
-- An unbalanced entry is refused before anything is written.
CREATE FUNCTION vault.post(p_by text, p_memo text, p_lines jsonb, p_run uuid DEFAULT NULL, p_ledger text DEFAULT 'owner')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, nerve, pg_temp AS $$
DECLARE jid bigint; l jsonb; sd numeric; sc numeric;
BEGIN
  IF nerve.caller_is_agent() THEN RAISE EXCEPTION 'only the owner posts to the paper ledger'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.ledgers WHERE id = p_ledger) THEN RAISE EXCEPTION 'unknown paper sub-ledger %', p_ledger; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN RAISE EXCEPTION 'a journal needs at least two lines'; END IF;
  SELECT coalesce(sum((e ->> 'debit')::numeric), 0), coalesce(sum((e ->> 'credit')::numeric), 0) INTO sd, sc
    FROM jsonb_array_elements(p_lines) AS e;
  IF sd <> sc THEN RAISE EXCEPTION 'journal is not balanced (debit % credit %)', sd, sc; END IF;   -- refused before any row
  INSERT INTO vault.journal (ledger, memo, by_who, run_id) VALUES (p_ledger, p_memo, p_by, p_run) RETURNING id INTO jid;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO vault.lines (journal_id, account_id, debit, credit)
    VALUES (jid, l ->> 'account', coalesce((l ->> 'debit')::numeric, 0), coalesce((l ->> 'credit')::numeric, 0));
  END LOOP;
  PERFORM nerve._emit(p_by, 'vault.posted', 'owner', jsonb_build_object('journal', jid, 'ledger', p_ledger, 'lines', jsonb_array_length(p_lines)), '[]', p_run);
  RETURN jid;
END $$;

-- Paper cash in one sub-ledger (what the books say it holds).
CREATE FUNCTION vault.cash(p_ledger text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vault, pg_temp AS $$
  SELECT coalesce(sum(l.debit - l.credit), 0)
  FROM vault.lines l JOIN vault.journal j ON j.id = l.journal_id
  WHERE j.ledger = p_ledger AND l.account_id = 'cash:paper'
$$;

-- Money crosses between sub-ledgers only here, as two recorded journals through the transfer clearing account.
-- The sending book must hold the paper cash (no overdraft on paper).
CREATE FUNCTION vault.transfer(p_by text, p_from text, p_to text, p_amount numeric, p_memo text, p_run uuid DEFAULT NULL)
RETURNS bigint[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, nerve, pg_temp AS $$
DECLARE j_out bigint; j_in bigint;
BEGIN
  IF nerve.caller_is_agent() THEN RAISE EXCEPTION 'only the owner moves paper between sub-ledgers'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'a transfer needs two different sub-ledgers'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'a transfer needs a positive amount'; END IF;
  IF vault.cash(p_from) < p_amount THEN RAISE EXCEPTION 'not enough paper cash in % for this transfer', p_from; END IF;
  j_out := vault.post(p_by, p_memo || ' (out)', jsonb_build_array(
             jsonb_build_object('account', 'equity:transfer', 'debit', p_amount),
             jsonb_build_object('account', 'cash:paper', 'credit', p_amount)), p_run, p_from);
  j_in := vault.post(p_by, p_memo || ' (in)', jsonb_build_array(
            jsonb_build_object('account', 'cash:paper', 'debit', p_amount),
            jsonb_build_object('account', 'equity:transfer', 'credit', p_amount)), p_run, p_to);
  RETURN ARRAY[j_out, j_in];
END $$;

-- Reconcile: every journal balances, the paper books satisfy assets = liabilities + equity + income - expenses, and no
-- sub-ledger shows negative paper cash. A difference freezes new proposals (prop.freeze) until the books agree.
-- The owner calls it directly; خازن calls it through the tool gateway (vault.reconcile, sole holder khazen).
CREATE FUNCTION vault.reconcile(p_by text, p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, prop, nerve, pg_temp AS $$
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
  SELECT diffs || coalesce(jsonb_agg(jsonb_build_object('ledger', g.id, 'negative_cash', vault.cash(g.id))), '[]')
    INTO diffs FROM vault.ledgers g WHERE vault.cash(g.id) < 0;
  SELECT coalesce(sum(CASE WHEN a.kind = 'asset' THEN l.debit - l.credit END), 0),
         coalesce(sum(CASE WHEN a.kind IN ('liability', 'equity', 'income', 'expense') THEN l.credit - l.debit END), 0)
    INTO lhs, rhs FROM vault.lines l JOIN vault.accounts a ON a.id = l.account_id;
  ok := d = c AND diffs = '[]'::jsonb;
  eq := lhs = rhs;
  INSERT INTO vault.reconciliations (by_who, balanced, equation_ok, journals, lines, total_debit, total_credit, differences)
  VALUES (p_by, ok, eq, nj, nl, d, c, diffs);
  UPDATE prop.freeze SET frozen = NOT (ok AND eq),
                         reason = CASE WHEN ok AND eq THEN NULL ELSE 'paper books do not agree (see the reconciliation)' END,
                         changed_at = now()
  WHERE id = 1;
  PERFORM nerve._emit(p_by, 'vault.reconciled', CASE WHEN p_by = 'owner' THEN 'owner' ELSE 'agent' END,
                      jsonb_build_object('balanced', ok, 'equation_ok', eq, 'journals', nj, 'lines', nl, 'frozen', NOT (ok AND eq)), '[]', p_run);
  RETURN jsonb_build_object('balanced', ok, 'equation_ok', eq, 'journals', nj, 'lines', nl,
                            'total_debit', d, 'total_credit', c, 'differences', diffs, 'frozen', NOT (ok AND eq));
END $$;

-- One month of one sub-ledger, every line with the journal it belongs to (traceable). The owner's tool.
CREATE FUNCTION vault.monthly_statement(p_ledger text, p_month date)
RETURNS TABLE (journal bigint, ts timestamptz, memo text, by_who text, run_id uuid, account text, debit numeric, credit numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vault, pg_temp AS $$
  SELECT j.id, j.ts, j.memo, j.by_who, j.run_id, l.account_id, l.debit, l.credit
  FROM vault.journal j JOIN vault.lines l ON l.journal_id = j.id
  WHERE j.ledger = p_ledger
    AND j.ts >= date_trunc('month', p_month::timestamp) AND j.ts < date_trunc('month', p_month::timestamp) + interval '1 month'
  ORDER BY j.id, l.id
$$;

-- Public, read-only, and labelled as paper in every row.
CREATE VIEW api.vault_balances AS
  SELECT g.id AS ledger, a.id AS account, a.name_ar, a.name_en, a.kind, a.currency, a.mode,
         CASE WHEN a.kind IN ('asset', 'expense') THEN coalesce(sum(l.debit - l.credit), 0)
              ELSE coalesce(sum(l.credit - l.debit), 0) END AS balance,
         'ورقي فقط. ليس حساباً بنكياً ولا يحفظ أموالاً. Paper only: not a bank account, holds no funds.' AS note
  FROM vault.ledgers g
       CROSS JOIN vault.accounts a
       LEFT JOIN vault.journal j ON j.ledger = g.id
       LEFT JOIN vault.lines l ON l.journal_id = j.id AND l.account_id = a.id
  GROUP BY g.id, a.id, a.name_ar, a.name_en, a.kind, a.currency, a.mode;

CREATE VIEW api.vault_statement AS
  SELECT j.id AS journal, j.ledger, j.ts, to_char(j.ts, 'YYYY-MM') AS month, j.memo, l.account_id AS account,
         l.debit, l.credit, 'paper' AS mode
  FROM vault.journal j JOIN vault.lines l ON l.journal_id = j.id
  ORDER BY j.id, l.id;

-- The wallet view (section 8): per sub-ledger, the paper cash, the realised paper result, and the proposal queue counts.
-- Counts only; no titles, no rationale. Public, labelled paper.
CREATE VIEW api.vault_wallet AS
  SELECT g.id AS ledger, g.label,
         vault.cash(g.id) AS paper_cash,
         coalesce((SELECT sum(l.credit - l.debit) FROM vault.lines l JOIN vault.journal j ON j.id = l.journal_id
                   WHERE j.ledger = g.id AND l.account_id IN ('income:paper_pnl', 'expense:paper_fees')), 0) AS realised_paper_result,
         (SELECT count(*) FROM prop.proposals p WHERE p.status IN ('pending_risk', 'risk_pass')) AS open_proposals,
         (SELECT count(*) FROM prop.proposals p WHERE p.status = 'approved') AS approved_proposals,
         (SELECT f.frozen FROM prop.freeze f WHERE f.id = 1) AS new_proposals_frozen,
         'ورقي فقط. ليس حساباً بنكياً ولا يحفظ أموالاً. Paper only: not a bank account, holds no funds.' AS note
  FROM vault.ledgers g;

REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vault FROM PUBLIC;
GRANT USAGE ON SCHEMA vault TO nerve_agent;
GRANT EXECUTE ON FUNCTION vault.reconcile(text, uuid) TO nerve_agent;
-- post, open_ledger, transfer and monthly_statement keep no grant: the owner's login only.
GRANT EXECUTE ON FUNCTION vault.cash(text) TO web_anon;   -- read-only: the wallet view's paper cash per book (already public)
GRANT SELECT ON api.vault_balances, api.vault_statement, api.vault_wallet TO web_anon;
SQL
echo "paper vault created"
else
  echo "paper vault already present"
fi

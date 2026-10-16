# ADR-085: Agents phase 7: the paper Vault (double entry, paper only, not a bank)

Date: 2026-10-16 · Status: Proposed (draft PR, not merged)

## Context
Phase 7 of ADR-077 section 8. Ahmad asked for a professional banking-style ledger. This phase builds the paper
version only, which the design allows: "paper only, with 'not a bank' wording, licence review first". The licence
review for anything beyond paper is open (launch-drafts/LAWYER-QUESTIONS.md) and is not started here.

## Decision
- **Schema `vault`** (`db/init/10-vault.sh`): a chart of four accounts (paper cash, owner paper capital, paper gains,
  paper fees), a journal, lines (one side per line), reconciliations.
- **Paper only, by construction.** Each account must be `mode = 'paper'` and `currency = 'USDT'` (CHECK). There is no
  bank, custody or exchange table, and no function that moves, pays, withdraws, converts or deposits (the test checks
  the names).
- **Double entry.** `vault.post` refuses an unbalanced entry before writing. A deferred constraint trigger on the
  lines checks the same thing at commit as a backstop for any direct insert. A line has one side only.
- **Append-only.** Journal, lines, accounts and reconciliations refuse UPDATE and DELETE. A mistake is a reversing
  entry.
- **Who does what.** Only the owner posts (`vault.post` has no agent grant). خازن (khazen) holds `vault.reconcile`
  through the gateway (sole holder, already in the seed). Reconcile checks that every journal balances and that the
  paper books satisfy assets = liabilities + equity + income − expenses, stores the result, and logs an event with
  counts only.
- **Public statement.** `api.vault_balances` and `api.vault_statement` (web_anon) show each row labelled
  "ورقي فقط. ليس حساباً بنكياً ولا يحفظ أموالاً. Paper only: not a bank account, holds no funds."
- **Events** carry ids and counts, never a memo. The family `vault` joins the event regex.

## Deviations
- The design had khazen post entries for fills. There are no fills yet (the paper-trading MVP is not merged), so
  posting stays with the owner until that link exists.
- Statement and reconciliation are database views and functions, not a PDF. A printable statement can follow.

## Not in this phase (needs a licence review first)
- Any money, any real account, any custody, any exchange link. The words "bank", "deposit" and "account" in the
  product must stay tied to "paper" until the review says otherwise.

## Consequences
- Suite: 233 checks pass (`scripts/test-nerve.sh`, exit 0), including `db/test/vault_test.sql`.
- Not live on the laptop: no Docker in the cloud sandbox.

# ADR-076: Audit log for every paper proposal, and AI disclosure wording for the agent phase

Date: 2026-10-16 · Status: Proposed (branch feat/paper-trading-mvp, not merged)

## Context
Ahmad (2026-10-16 01:20Z) required: a human approves each proposal and it is the only path to a paper record; each
proposal keeps an audit trail (what the system saw, what it concluded, when, and who approved); every agent discloses
that it is an AI; the execution agent only queues proposals; no agents, pgvector, WebSocket, Supabase or Alpaca until
the local test passes; Google OAuth values are stored only in the encrypted file.

## Decision
- **Reasoning on every proposal.** `Proposal.reasoning` is set when a signal becomes a proposal, e.g.
  "trend rule on 1d candles says BUY (sma20 101, sma50 99)". Empty reasoning is refused.
- **Audit log** (`paper/audit.jsonl`, append-only, beside the queue). One line for each:
  - `proposed` (actor `system:scan`): the evidence the system read (source, numbers, price seen, time, link) and the reasoning;
  - `approved` (actor: the signed-in user or the owner): the same data and reasoning, the price at the moment of approval,
    and the fill id;
  - `rejected` (actor, reason): the same data and reasoning.
  Writes happen in the same serial section as the decision, so a refused decision (already decided, expired, price moved)
  leaves no audit line. `approveAndRecord` and `rejectAndRecord` are the only functions that write decisions.
- **AI disclosure wording** is in `docs/AGENT-DISCLOSURE.md`: one disclosure sentence per agent (Arabic and English) and a
  fixed chat banner. Nothing is built into a chat UI yet.
- **Local setup**: `docs/LOCAL-SETUP-AR.md` now says the Google values are set only with `npm run secrets:set` (encrypted),
  never a plain `.env`. Step 6 shows where the audit log is.

## Consequences
- Tests: 134 pass, including audit entries for scan, approval and rejection, a refused decision leaving no line, and the
  log only growing.
- Audit lines hold the evidence and the price, so they are personal-trading records of a paper account. They stay on
  Ahmad's machine under the data folder and are not sent anywhere.
- Undo: delete `paper/audit.jsonl` (the queue and the paper ledger are unaffected, but the trail is lost).

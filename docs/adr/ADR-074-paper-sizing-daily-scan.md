# ADR-074: Paper proposal sizing rule and the 09:00 daily scan with briefing

Date: 2026-10-16 · Status: Proposed (branch feat/paper-trading-mvp, not merged; Ahmad tests locally first)

## Context
Ahmad's decisions on ADR-073 (2026-10-16 00:03Z): keep 100 USDT, but resize on paper results (200 after +5% over
two weeks, 50 after -5%); scan daily at 09:00 Kuwait time and send him a briefing with the top 3 proposals, their
numbers and links; approval stays manual; no merge until it works on his laptop; Brazil ideas as research only.

## Decision
- **Sizing** (`proposalSize`): looks only at closed paper trades (sell fills) of the last 14 days. Return =
  realized ÷ cost basis of those sells. Needs at least 5 closed trades, otherwise 100 USDT (a couple of lucky trades
  must not resize). ≥ +5% → 200, ≤ -5% → 50, else 100. Any proposal is clamped to 50–200 USDT.
- **Daily scan** (`web/scripts/paper-scan.ts`, `npm run paper:scan`; `phoenix.py paper-scan`; Windows task
  "OMEGA Paper Scan" daily 09:00 via `ops/phoenix/install-paper-scan.ps1`): reads signals from the local web app,
  queues proposals, writes `paper/briefings/YYYY-MM-DD.md` (top 3 by backtest edge over buy-and-hold, with their
  numbers and raw-data links) and pushes one phone alert through the existing Web Push path (ADR-037).
- **No fill without a tap.** Scan and approve now live in the library as `scan()` and `approveAndRecord()`;
  `approveAndRecord` is the only function that writes the paper ledger, and tests check that the route and the
  daily script never call `appendEvent`, `fillOrder` or `approveAndRecord`.
- **Email:** there is no email-sending path in OMEGA today (no SMTP or mail API configured), so the briefing goes
  to the file and the phone push. Email to Ahmad's own address needs a mail sender he chooses.
- **Local trial:** `docs/LOCAL-SETUP-AR.md` runs the branch in a separate worktree on port 3101 with its own paper
  data; the 09:00 task is installed only after merge.
- **Brazil / Alpaca:** `docs/ROADMAP-BRAZIL.md`, research notes only, claims marked verified/unverified. No code.

## Consequences
- The size can change only through paper results, inside a fixed 50–200 band, and only on proposals Ahmad still
  approves one by one.
- The scan needs the web app running (it reads `/api/strategies`); if it is down, the briefing says no proposals.
- Undo: `schtasks /Delete /TN "OMEGA Paper Scan" /F`; delete `paper/briefings/`.

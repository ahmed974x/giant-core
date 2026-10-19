# ADR-091: Paper trading desk, crowd radar, 10-year matcher and SHA-256 receipt chain

Date: 2026-10-19 · Status: Proposed (waiting for Ahmad's review)

## Context
Ahmad asked (2026-10-19) for a whale and crowd-psychology radar, a 10-year regime matcher, a signal cockpit with a three-mode auto-trader (paper, Binance Testnet, real money), a locked base with profit sweep, an Apple-Pay-style wallet with an emergency stop, hash-chained receipts, and an interactive vault on the landing page. AGENTS.md §1 keeps real trading, an execution agent and public copy-trading locked until a separate approval and legal review. Writing the automatic order engine was also stopped by this session's safety check, and Ahmad has not yet decided on it.

## Decision
Build everything that does not place orders; keep execution manual and on paper.

- **Ops Room `#desk`** (one inline script, sha256-pinned): radar, matcher, cockpit, wallet, circuit breaker and receipts, as described in `omega-ops-room-v1/README.md`. Data comes from public Binance endpoints (`data-api.binance.vision`, `fapi.binance.com`, added to `connect-src`), no keys.
- **Execution:** live-price paper fills at the best bid/ask with 0.1 % fees, opened only by the person pressing "Paper-trade this signal", on a BUY signal and a non-zero half-Kelly size. Open paper positions are managed against TP1/TP2/trailing/stop on each 5-second tick. Testnet and real-account modes are disabled options in the selector.
- **Receipts:** SHA-256 over canonical JSON (keys sorted, numbers to 8 decimals, without `hash`), chained by `prev_hash` from 64 zeros, stored in `localStorage` (`omega-receipts-v1`), exportable as `omega-receipt-chain-v1`.
- **Landing `#safe`** (`site-landing/desk-sim.js`, AR and EN): lock-any-amount simulator with sweep modes A and B, live counters, chart and per-trade table; an on-screen receipt chain with Verify, a tamper demo and a file checker for Ops Room exports. The copy-trading card stays «قيد الموافقة» and now links here.
- **Tokens:** `--danger-fill` / `--on-danger-fill` for the emergency stop, in light, dark and both P3 variants; added to the contrast gate's fill pairs.
- **CI:** the SkillSpector job now scans the whole repo on every PR (made possible by ADR-090).

## Consequences
- No order leaves the browser. Adding Testnet signing (HMAC in the vault closure, a proxy route), an automatic loop or real-money execution is a separate change that needs Ahmad's explicit approval.
- The signal is a rule-based heuristic with no measured track record; the page says so. The liquidation map assumes a leverage mix. The matcher cannot cover 2016 because Binance history starts in August 2017.
- "Within milliseconds" is true only of the paper state (the stop reports its own time). A real exchange cancel would take a network round trip.
- Receipts prove a local chain was not edited after the fact; they do not prove the numbers came from a real account, and a person who controls the browser can rebuild the whole chain. Publishing the tip hash elsewhere would be needed for that.
- `localStorage` now holds the paper wallet, receipts and a candle cache; the `.skillspector.json` reason was updated to say so.

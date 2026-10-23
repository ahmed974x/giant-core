# ADR-111: Agent wiring card (the agents drawn against the eight neural decision heads) and adsb.lol call spacing

Date: 2026-10-23 · Status: Accepted (Ahmad's request of 2026-10-23 02:33Z: publish, verify, and show the agents in a drawing wired to the neural network)

## Context
After Phase 14 (ADR-110) went live, Ahmad asked to see the agents drawn and connected to his neural network and agents, and to check it. The Ops Room already had the 139 → 8 neural flow (ADR-109, ADR-110) and the Brain 2 synaptic web (ADR-108), but no single picture showed which agent each decision head learns from, which agents vote in the court, and which ones act on the paper desk.

The live Pages run of ADR-110 (run 39890031722) also showed adsb.lol answering HTTP 429 to the snapshot's seven back-to-back calls (18 of 20 sources live; RIPEstat timed out once).

## Decision

### Agent wiring card (`#agentwire`, views 1, 3 and 5)
A canvas with four columns (rows on a phone):
1. The eight tanh decision heads, filled cyan or pink by sign with a ring for |value|, hollow with no reading.
2. The desk agents that teach them, each level with its head:
   - Market, next 30 s → head 1
   - Kelly sizer → head 2
   - Levels TP/SL → heads 3 and 4
   - Circuit breaker → head 5
   - $20 base guard → head 6
   - Profit sweeper → head 7
   - Risk judge → head 8
3. The court voices (bull, red-team bear, OSIRIS shock voice) and the Brain 2 gym agents (researcher, modeler, auditor).
4. The paper auto engine and the vault with its receipt chain.

That is 23 nodes (8 heads, 15 agents) and 21 links, each a link the code has:
- **Teaching (8):** the rule value is the head's training target. The colour is the gap between rule and network: green ≤ 0.25, amber ≤ 0.6, red beyond, grey with no reading. Head 1 is orange because its teacher is the market itself.
- **Court (3):** each voice to the judge, with width from the court's learned weight.
- **Gym (3, dashed):** the gym agents inform the Brain 2 web only and have no effect on the ruling.
- **Acting (7, blue):**
  - The judge's OPEN, the Kelly size, the levels and the breaker reach the paper auto engine.
  - The engine, the sweeper and the base guard reach the vault.
  - A link is drawn bold only while it acts: OPEN with the engine on auto, the breaker tripped, or a paper position open.

The heads feed nothing on this card. The text under it says so, and that the judge rules and the engine is paper only.

Drawing happens on demand: on a new reading (`omega:neural`, a new event from the neural flow's render), on an `omega:desk` or `omega:osiris` event, every 5 s while the card is on screen and the tab is visible, and on hover, tap, resize or theme change. There is no animation loop. Canvas DPR is capped at 3. The glass inspector card reuses the Brain 2 styles; arrow keys and Escape work.

New read-only hooks:
- `OMEGA_NEURAL.heads()`: the eight heads as shown, live or scrubbed, each with its rule value and decoded text.
- `OMEGA_PROBE.desk.engine()`: auto, halted, open position and signal.
- `window.OMEGA_AGENTS`: `state()`, `inspect(id)` and `ids()`.

Self-test check 19 now also asserts 8 heads, 15 agents, 21 links (8 teaching) and 8 heads from the hook. The count stays at 24 checks.

### adsb.lol call spacing
- The snapshot fetcher gains a per-source `gapMs`. adsb.lol uses 3000 ms between its seven calls, inside the 30 s attempt limit.
- The proxy's minimum gap for `api.adsb.lol` goes from 1100 to 3000 ms.

## Not verified
The sandbox blocks outbound data, so the coloured screenshots were taken with a mocked Binance feed (a seeded random walk served through Playwright routes). That data is a test fixture, not market data. With live data the same card fills from the real book on the laptop and on the public site.

## Consequences
- One more canvas in views 1, 3 and 5, drawn in about 1 to 30 ms per redraw in headless Chromium (more while the mocked feed was running).
- The snapshot takes about 18 s longer for adsb.lol.

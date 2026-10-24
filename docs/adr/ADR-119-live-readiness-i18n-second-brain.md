# ADR-119: Live trading readiness plan and gate, an Arabic / English switch on every page, and the second brain

Date: 2026-10-24 · Status: Proposed (Ahmad's message of 2026-10-24 03:50Z; merge waits for his go). Stacked on ADR-118 (PR #38), which sits on #37 and #36; none is merged yet.

## Context
Ahmad asked for four things:
- the site should trade with real money, professionally;
- free, trusted open-source research, borrowing what is useful;
- a second brain that arranges, merges, develops and orders ideas;
- Arabic and English everywhere, with no errors.

Real trading and an execution agent are locked until a separate explicit approval and a legal review (AGENTS.md §1). The paper desk rule of 2026-10-19 also stands: no code signs or sends an order to any exchange, Binance or Testnet. So this ADR does the parts that move no money. Real trading becomes a written plan, a decision for Ahmad with concrete limits, and a measured paper gate. No order code is written.

## Decision

### 1. Live trading readiness plan (no order code)
`docs/LIVE-TRADING-READINESS.md` is written in Arabic and English. It contains:
- **Engine comparison.** Freqtrade (GPL-3.0), Hummingbot (Apache-2.0), CCXT (MIT), NautilusTrader (LGPL-3.0), Jesse (MIT) and OctoBot (GPL-3.0) are compared on licence, dry run, Binance spot support and the kill switch. The recommendation is Freqtrade on the laptop only, bound to 127.0.0.1, run in dry run first. The site would only read its status through the proxy. Nothing is installed: installing needs Ahmad's approval and a security review.
- **Nine hard guards:**
  - his own Binance key, trade-only, with withdrawals off;
  - an IP allow-list and an Ed25519 key, stored with dotenvx (ADR-042) and never sent to the site;
  - caps on size, daily loss and positions;
  - a kill switch;
  - hand confirmation of each order at first;
  - spot only, with no leverage;
  - the paper gate;
  - the legal review.
- **Three sets of limits.** Ahmad picks one, in his own words:

  | Set | Capital (USDT) | Order (USDT) | Daily loss (USDT) | Total loss (USDT) | Positions | Hand-confirmed orders | Markets |
  |---|---|---|---|---|---|---|---|
  | Careful | 20 | 2 | 1 | 4 | 1 | 50 | BTC |
  | Recommended | 50 | 5 | 2 | 10 | 2 | 30 | BTC + ETH |
  | Bolder | 100 | 10 | 5 | 20 | 3 | 15 | — |

- **Paper gate.** At least 100 round trips over at least 30 days, a profit factor of at least 1.20, a drawdown of at most 10 %, plan compliance of at least 90 %, and a verified receipt chain. After that comes a dry run of at least 14 days.
- **Legal position in Kuwait.** It is not verified, so it is written as «تعذر التحقق منها».
- **Honest expectations.** Most retail bots lose money, and a bot that passes the gate can still lose.

### 2. Live gate card in TRADE LAB
The gate card is `#live-gate`, titled «قيد الموافقة».
- `liveGate()` in `scripts/lib/trade-lab.mjs` measures the five gate checks plus the chain check.
- It counts only round trips rebuilt from the Ops Room ledger (`src === "ops"`), so a teaching example or an imported file cannot pass the gate.
- It always returns `locked: true`. Passing the gate opens nothing; it only says the paper record is ready for Ahmad's decision.
- The defaults are in `LIVE_GATE_DEFAULTS`.

### 3. Arabic / English everywhere (`omega-i18n-v1`)
`scripts/lib/i18n.mjs` is a small engine with one dictionary per page in `scripts/lib/i18n/`. Each dictionary is a list of `[arabic, english]` pairs with `{n}` slots for numbers and codes. `node scripts/build-i18n-inline.mjs` inlines the engine and the dictionaries into five pages, and `--check` runs in CI.
- **The button.** A `#langToggle` button sits beside the theme toggle. The Ops Room is written bilingual, so its button cycles through both languages, Arabic and English. The other pages switch between Arabic and English.
- **How the language is chosen.** `?lang=ar|en` wins, then the stored choice (`omega-lang`). The choice syncs over BroadcastChannel `omega-suite-lang`.
- **What it translates.** It swaps text nodes and the attributes `title`, `aria-label`, `placeholder` and `alt`. Dynamic lines are handled by a MutationObserver, batched in a microtask. The engine uses no `innerHTML`.
- **Paired halves.** Where a page already shows a `.ar` or `.en` half, it hides the other half instead of showing both.
- **Lines with a state.** A line such as "Auto paper engine: OFF" keeps its state when translated.
- **Arabic in Latin boxes.** Arabic written into a monospace or uppercase box gets letter-spacing 0 and plaintext bidi through the CSSOM.
- **Tags.** `[INFERENCE]` tags and tickers are never translated.

Coverage was measured in the browser with mocked feeds. In English mode: TRADE LAB 100 %, THE CHAIN 100 %, ORACLE 99.5 %, Ops Room 100 % and the second brain 92 %. In the Ops Room's Arabic mode it is about 78 %, because codes, tickers and units stay Latin.

### 4. The second brain · المخ الثاني
`omega-ops-room-v1/omega-second-brain.html` runs on `scripts/lib/second-brain.mjs`, inlined by `node scripts/build-brain-inline.mjs`. Its CSP has `connect-src 'none'`.

**Gather.** It reads what is already in this browser:
- your own ideas;
- TRADE LAB trade notes and plan rules;
- ORACLE's recent questions;
- the "my view", "what would prove me wrong" and "what changed" sections of THE CHAIN notes;
- imported .md or .txt files.

It keeps at most 600 items. It never reads a vault entry or a key.

**Clean.** It applies Arabic normalisation (hamza forms, taa marbuta, alif maqsura, diacritics) and light stemming in Arabic and English, and removes stop words.

**Organise:**
- TF-IDF weights with cosine similarity;
- a union-find merge at a similarity of 0.80 or more, which keeps every source;
- average-linkage themes down to 0.16, with map links from 0.12;
- a rank made of 0.4 × recency, 0.35 × links and 0.25 × source spread.

**Develop.** Fixed rules suggest the next step for each theme:
- research it in ORACLE, with a prefilled `?q=`;
- test trading ideas on paper in TRADE LAB;
- add evidence to a lone idea;
- write the takeaway when two or more sources agree;
- name what would answer an open question.

**Show and export.** It draws a seeded SVG map (no text inside the SVG) and exports Markdown and JSON. Grouping, names and ranks carry `[INFERENCE]`. It compares words, not meaning, and says so on the page.

The suite switcher lists the second brain on every page (ADR-107), and both service workers cache it.

## Consequences
- Real trading is still locked. The next step is Ahmad choosing a set of limits in his own words. After that come the legal and security reviews and a new ADR for a laptop-only engine, still in dry run.
- New CI step: `node scripts/test-brain.mjs` (engines, dictionaries and both inline `--check` runs).
- After editing `scripts/lib/i18n.mjs` or a dictionary, run `node scripts/build-i18n-inline.mjs` and re-pin the CSP. After editing `scripts/lib/second-brain.mjs`, run `node scripts/build-brain-inline.mjs`, then the tests, then re-pin the CSP.
- A new page text without a dictionary pair stays in its source language. The English coverage of the second brain (92 %) is the lowest and is the first to raise.
- In the cloud sandbox, the Ops Room's three-size check reports console errors only for blocked network fetches (Binance, RIS Live and the tile hosts). Overflow is 0 at every size, and live data is checked on the laptop.

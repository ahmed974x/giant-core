# ADR-116: TRADE LAB, a paper trading journal with a desk manager agent, and an OpenAPI document for the data proxy

Date: 2026-10-24 · Status: Proposed (Ahmad's Phase 18 message of 2026-10-24 02:44Z; merge waits for his go). Stacked on ADR-115 (PR #36), which is not merged yet.

## Context
Phase 18 arrived as one pasted conversation with another assistant, ending with Ahmad's ask: develop these for the site, research free and reliable open sources, upgrade the site, design the agent ("the super agent") and the whole site without errors, and do the maximum upgrade.

The conversation covered:
1. Documenting an API (OpenAPI with Widdershins or Redocly) before feeding it to LangGraph. It also named open deep-research tools: Ollama Deep Research, MiroThinker and OpenAlex.
2. Building a simulation-only trading platform. That meant market data, a paper trading engine, technical indicators (RSI, MACD, moving averages) and a system that learns. It said a real platform needs a licence; in Kuwait that is the Capital Markets Authority.
3. A personal "prop" platform. Its parts were a trade log, capital and risk rules, performance metrics (win rate, average return), notes and lessons, self-evaluation, a trading plan (strategy, money management, entry and exit rules, psychological rules, performance record) and continuous improvement from the data.
4. The role that joins all of this, which it called a "data-driven trading platform manager". It also described the six data layers that prop-firm analytics read: account state, trade data, behaviour, cross-account risk, identity and lifecycle.

Much of this already exists. The desk is paper only (ADR-091, ADR-092). Market data is keyless (Binance, CoinGecko). ORACLE (ADR-114, ADR-115) already reads OpenAlex and ten more open sources, and has a local-model brief.

What was missing:
- A place that reads the paper receipts as a trader's journal.
- A written plan to measure trades against.
- Notes and mistakes to learn from.
- An agent that turns the numbers into findings.
- A machine-readable description of the local proxy's API.

## Decision

### 1. TRADE LAB page
The new page is `omega-ops-room-v1/omega-trade-lab.html`. It works from `file://`, the local server and GitHub Pages, and joins the suite switcher on all five pages.

- **Read.** It reads the Ops Room's receipts from the same browser, using the same `omega-receipts-v1` and checkpoint keys. It can also import an exported `omega-receipt-chain-v1` file. Every hash and Merkle checkpoint is checked in the same canonical form as the Ops Room and NABD verifiers. A changed chain is refused and nothing from it is measured.
- **Round trips.** A trip starts at a `FILL_BUY` and closes when `FILL_SELL` receipts have sold its whole quantity, from the `exec` block. Partial exits (TP1, then TP2 or a stop) join into one trip. Older receipts with no `exec` treat any sell other than TP1 as full.
  - A trip closed by the emergency stop is left out of the numbers: the `KILL` receipt does not carry its exit price. The page says so in the gaps.
  - `SIM_TRADE` test trades count as trips with the source "test".
  - Hand-written paper trades can be added, long or short, with an optional first stop. They come, for example, from a broker's demo account or from chart practice.
- **Measure.** The page measures:
  - net P/L, win rate and breakeven win rate;
  - profit factor, expectancy in dollars and in R, and payoff;
  - max drawdown, losing and winning streaks, and hold time of winners against losers;
  - fees and average slippage.
  - Each of these is labelled `[INFERENCE - Quant Model]`: Van Tharp's SQN, the per-trade Sharpe, the Kelly fraction measured from the trips, and a seeded bootstrap. The bootstrap draws 2,000 paths of 100 trades from the trader's own returns and gives the chance of reaching the plan's drawdown limit.
  - 1R is equity before the trade × the plan's risk per trade, or (entry − stop) × quantity for a manual trade with a stop.
  - Charts are SVG with no text inside: the equity curve with its drawdown band, an R histogram and trades by UTC hour.
- **Plan.** The written plan has a strategy name, markets, setups, risk per trade, a position limit, a daily trade limit, a daily loss limit, an overall drawdown limit, a minimum R:R, a cool-down after a loss, UTC hours, BUY-signal-only entries for the desk, and psychological rules.
  - Every trip is checked against it. A trip breaks the plan when its size is too big, it loses more than 1R, it goes over the daily count, it trades after the daily loss limit, it opens inside the cool-down, it is outside the hours, or it enters without a BUY signal.
- **Paper discipline challenge.** This is a personal test shaped like the published evaluation rules of funded-trading firms: a profit target, a daily loss limit, an overall drawdown limit and a minimum number of trading days. It has no fee, no funding and no payout, and it accepts no money.
- **Journal notes.** Each closed trip can carry:
  - its setup, and the reason for the entry and the exit;
  - stress before entry (1–5), whether the plan was followed, and a grade;
  - the lesson learned;
  - mistake tags from a fixed list of ten (FOMO, early exit, moved stop, oversize, revenge, no written reason, against the trend, news, overtrading, hesitation).
  - The lessons card shows how often each mistake happened and what the tagged trips lost. That cost is labelled `[INFERENCE]`: it is not proof that the mistake alone caused the loss.
- **Market lens.** The page reads the last 300 Binance public candles (1h, 4h or 1d) for five symbols. They come through the proxy when it runs, or straight from `data-api.binance.vision`. It computes Wilder's RSI 14, MACD 12/26/9, SMA 50 and 200, EMA 20, Bollinger 20/2 and Wilder's ATR 14.
  - Fixed-rule readings flag overbought or oversold, the trend against SMA 200, a MACD cross, a Bollinger squeeze and high volatility. Each is labelled `[INFERENCE]` and none is an entry signal.
  - When the candles do not arrive, the page says "تعذر التحقق منها".
- **Six data layers.** The page shows which layers one paper account has. Identity is "not collected by design": no sign-up, no KYC, no subscribers. Cross-account risk does not apply.

### 2. The desk manager agent
This is "the super agent" of the message, built as the data-driven trading platform manager the conversation described. It runs in five stages: read, measure, audit, learn and propose.

- It uses fixed rules in `OMEGA_TRADELAB.coach`. They cover sample size under 30, negative expectancy, a win rate under breakeven, drawdown against the plan, the current losing streak, losers held longer than winners, fees above 30% of gross profit, slippage, plan compliance under 80%, stops not respected, journal coverage, the costliest mistake, stress against results, the challenge, the bootstrap and the lens.
- Findings are graded ok, watch, act or stop. Each carries its numbers and `[INFERENCE]`. A desk-health score out of 100 comes from the same rules.
- Proposals go to Director 00. Some change the paper plan: halve the position limit, halve the risk per trade, lengthen the cool-down or lower the daily limit. These have an "apply to plan" button that asks first and changes only the plan in this browser. The others are habits: pause the auto engine, take a day off, or write a rule against the costliest mistake.
- Opened from `http://127.0.0.1:8796` with the proxy running, the agent can send its facts to the local model through the existing `/llm/ollama/explain`. The answer is labelled `[INFERENCE - local LLM]` and changes nothing.

### 3. API document for the data proxy
`docs/api/omega-data-proxy.openapi.json` describes every route of `scripts/omega-data-proxy.mjs` in OpenAPI 3.1: 36 operations. For each route it gives the parameters with their allowlists, the upstream, the cache life, and the research and local-model bridges.

`scripts/build-api-docs.mjs` writes the Markdown reference `docs/api/OMEGA-DATA-PROXY-API.md` with no third-party generator. With `--check`, it reads the proxy's real route table and fails if:
- a route has no documented example;
- an example matches no route;
- the Markdown is stale.

The proxy gains one route, `/market/klines/<SYM>/<1h|4h|1d>`, cached for 60 s, and the short path `/omega-trade-lab.html`.

### 4. Not done, and why
- **Real trading, a broker demo account linked by API, funded or prop accounts, copy trading, profit split, subscribers.** These stay locked «قيد الموافقة» (AGENTS.md §1). On a funded-trading business, the pasted conversation itself said that taking client money needs a licence (the Kuwait CMA). Nothing here sends or signs an order.
- **LangGraph, Widdershins, Redocly, OpenAPI Generator, Docusaurus.** These are third-party frameworks and installers, and they need Ahmad's approval and a written security review (AGENTS.md §1). The API document is plain OpenAPI 3.1, so any of these tools can read it later if he approves one.
- **Ollama Deep Research and MiroThinker.** ORACLE already does plan, gather, evaluate and write over OpenAlex and ten more keyless sources, with a local model. The claim that MiroThinker 1.5 "rivals GPT-5" came from a video in the pasted text and was not checked against a primary source. No model was added.
- **Canva, Jotform, Visme, Venngage.** These are hosted services with accounts. The journal is built into the page and stays in the browser.
- **Private search engines (Torch, Ahmia, Haystak) and other dark-web search.** These were left out. OSINT here stays passive, over public keyless APIs (AGENTS.md §6a).

## Consequences
- New engine: `scripts/lib/trade-lab.mjs`, a pure ES module with no imports. It is inlined whole into the page by `scripts/build-tradelab-inline.mjs`. After editing it, run that script and `node scripts/test-tradelab.mjs`, then re-pin the CSP with `skillspector --fix`.
- `scripts/test-tradelab.mjs` has 19 tests and runs in CI next to the Brain 2 and research tests. It covers:
  - SHA-256 against `node:crypto`, the canonical form, chain and checkpoint checks, and the export parser;
  - trips, metrics, manual trips, compliance, the challenge and notes;
  - the indicators, the klines URL and the lens;
  - the bootstrap, the agent, the layers and the teaching example;
  - the inline copy and the API document.
- The page stores the plan, the notes, manual trips, the challenge rules and the lens symbol in `localStorage`. All of it is wrapped, and the page works without it. These are journal text, not secrets. "Export journal" writes an `omega-tradelab-journal-v1` file. "Import" asks before it replaces anything.
- CSP for the page: `connect-src 'self' http://127.0.0.1:8796 https://data-api.binance.vision`, with inline code pinned by sha256.
- The suite switcher gains TRADE LAB in NABD's `suite.js`, the Ops Room, THE CHAIN and ORACLE. The Pages build and the Ops Room service worker include the page.
- The teaching example ("مثال تعليمي — أرقام افتراضية", `?example=1`) is a valid made-up receipt chain of 18 trips with sample notes. A banner says so on screen, and the agent's facts tell the local model it is an example.

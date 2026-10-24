# ADR-118: PRIME, a lead agent with nine helpers and an operating system, and neural inspector v2

Date: 2026-10-24 · Status: Proposed (Ahmad's Phase 20 message of 2026-10-24 03:33Z; merge waits for his go). Stacked on ADR-117 (PR #38), which sits on #37 and #36; none is merged yet.

## Context
Ahmad asked for three things:
- take the thread inspector further;
- design a "super agent" with helper agents (one task each), its own tools ("weapons") and an operating system that organises the site, researches open-source tools, and trades professionally without stopping, "even for two days";
- research the best open-source tools, libraries and skills.

What already existed:
- a paper auto engine that opens only on the risk judge's OPEN (ADR-091, ADR-092);
- the court with its bull, bear, judge and veto line (ADR-093, ADR-117);
- the agent wiring map (ADR-111);
- ORACLE research (ADR-114, ADR-115);
- the TRADE LAB journal (ADR-116).

What was missing was one agent that runs all of these in a loop, says what each part did, and stops itself when something is wrong.

Real orders, signing, Testnet and real money stay locked (AGENTS.md §1).

## Decision

### 1. Inspector v2
- **Knock-out and sensitivity.** A selected thread now shows what each of the eight heads would do on the shown reading if the weight were 0 (Δ). It also shows how hard each head leans on the weight, ∂o/∂w, by central difference with ε = 1e-4. That takes three feed-forward passes of about 11,800 multiplications each on the shown weights. Nothing is changed. A silent path (dead ReLU) says so.
- **Strongest path.** For any neuron, a button (or the P key) traces a path from an input to a head:
  - backwards, each step takes the largest incoming |w·a|;
  - forwards, each step takes the largest outgoing |w| (a is the same for every outgoing thread).

  The path is drawn as one bright chain and listed as buttons.

### 2. PRIME · الوكيل الخارق
PRIME is a new card in views 1 and 5. It has a lead and nine helpers, each with one task and named tools:

| Agent | Task | Tools |
|---|---|---|
| PRIME lead | plans each cycle, runs the helpers in order, keeps the journal | scheduler, journal, risk gate |
| Scout | ranks 12 markets every minute | Binance public 24 h tickers (one request) |
| Technical analyst | reads 100 hourly candles of each desk market every 5 minutes | EMA 20/50, Wilder RSI 14, ATR 14, Bollinger %b |
| Quant | reads the desk's order flow and the neural direction head | microprice, VPIN, Hawkes, head 1 |
| Sentinel | watches the planet and the network | OSIRIS PWSI, source table |
| Risk officer | closes the gate | emergency stop, broken receipt chain, paper balance 10% under the locked base, auto engine switched off by hand |
| Paper executor | turns the desk's paper auto engine on or off; moves the desk to another of its four markets | `OMEGA_DESK_CTL` |
| Auditor | re-verifies the SHA-256 receipt chain every 10 minutes | the desk's verifier |
| Researcher | opens an ORACLE intel brief on the focus market; keeps the open-source library | ORACLE `?mode=intel&q=` |
| Organizer | reports the site's health | neural ring fill, last self-test, timer drift, file:// hint |

**Operating system.**
- A scheduler ticks every 15 s while the tab is open.
- Each helper's last output, status and measured time are shown.
- A journal of 300 entries and the run state persist in `omega-prime-v1`.
- After a reload the autopilot resumes and says so.
- A screen wake lock is available where the browser allows it. The card says plainly that the loop stops when the tab closes or the computer sleeps.

**Rules.**
- The scout score is the 24 h change as a z-score across the list (0.6) plus the position in the day's range (0.4), scaled by liquidity rank.
- The 1 h setup is trend (0.5), RSI momentum fading past 75 / 25 (0.3) and band position (0.2).
- A desk market's combined score is the mean of the two.
- **Focus** moves the desk only when another desk market leads by 0.25 for three cycles in a row, no paper position is open and 30 minutes have passed since the last move.

All of these are fixed rules labelled [INFERENCE], not predictions.

**Desk control.** `window.OMEGA_DESK_CTL` is new in the desk script. It has `markets`, `setAuto` (refuses with an emergency stop or no locked base) and `focus` (refuses while a paper position is open). These are the same guards as the buttons. PRIME never opens, sizes or closes a trade. The auto engine still opens a paper trade only on the judge's OPEN, and if a person switches it off, PRIME pauses instead of fighting them.

**Open-source library, ideas only.** These projects are listed with their licences:
- TradingAgents (Apache-2.0)
- FinRL (MIT)
- Qlib (MIT)
- freqtrade (GPL-3.0)
- vectorbt (Apache-2.0 with Commons Clause)
- backtrader (GPL-3.0)
- Hummingbot (Apache-2.0)
- LangGraph (MIT)
- CrewAI (MIT)
- TA-Lib (BSD-3-Clause)

Each entry says what idea we took. The team split follows TradingAgents and CrewAI, the persisted journal and loop follow LangGraph's checkpoints, and the drawdown stop follows freqtrade's protections, written here from scratch. RSI and ATR follow TA-Lib's Wilder smoothing. No code was copied, and nothing is installed. Installing any of these needs Ahmad's approval and a security review.

### 3. Self-test (still 24 checks)
- **"Three-agent court"** now also checks PRIME's tools on fixed input:
  - Wilder RSI 14 on the classic 15-close series is 70.46, and a rising series gives 100;
  - the scout ranks a fixture in the right order;
  - the gate closes on an emergency stop and on a 15% drawdown, and opens at 5%;
  - focus waits three cycles;
  - there are 10 agents.
- **"Neural flow"** now checks:
  - cutting a thread into head 1 moves head 1 by tanh(z − w·a) − tanh(z), to Float32 precision, and leaves every other head exactly unchanged;
  - ∂o/∂w equals a·(1 − tanh²z);
  - the strongest path runs through all seven layers in order.

### Not done, and why
- **No real or Testnet orders, no signing, no keys.** These are locked by AGENTS.md §1.
- **No "trade until it wins" loop that raises size after losses.** Size stays half-Kelly from the desk, the breaker and the $20 base rules are unchanged, and the gate can only stop.
- **No third-party agent framework installed.** Each would need a security review first.

## Consequences
- **New traffic.** One Binance public request a minute and four every 5 minutes, to a host already in the CSP. No new host, dependency or secret.
- **New storage key.** `omega-prime-v1` holds the journal and run state, not credentials. Its SkillSpector suppression reason was updated.
- **New controls.** OMEGA_DESK_CTL is the only new write path. It changes only paper state, through existing functions.

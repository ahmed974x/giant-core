# NABD Public / Private Split (proposal)

Status: **PROPOSAL, nothing here is approved or built.** Every row marked `Proposed` waits for Ahmad's yes or no.
Decision record: [ADR-066](adr/ADR-066-public-private-split.md).

Idea in one line: publish the frame, keep the treasure. "Show what builds trust, hide what builds wealth."

## 0. Hard rules (apply to every tier, already in force)

1. **No secret, API key, token, position, order, balance or PnL figure is ever published or committed to Git.**
   That covers this repo, any future public repo, screenshots, demo data, reports and commit messages.
   Secrets stay encrypted outside the repo as today (ADR-042, `docs/KEYS-VAULT.md`).
2. Data only flows **downward**: Vault → Pro → Public, never the other way, and only through an explicit,
   reviewed export step. Nothing in Public or Pro can read Vault.
3. The demo uses **synthetic data only**. No real price snapshot tied to a real decision, no real fills.
4. Nothing in this document authorises publishing, posting, deploying, payments or contacting anyone.
   Each of those is its own step with Ahmad's explicit go.
5. All figures below (prices, visitor counts, stars, paying users) are **unverified targets**, not facts or
   forecasts.

## 1. The four tiers

| Tier | Who sees it | Where it runs (proposed) | Access |
|---|---|---|---|
| **Public** | Anyone | Static site + a separate public GitHub repo | None |
| **Pro** | Paying subscribers | Separate hosted app, its own database | Login |
| **VIP** | Higher-tier subscribers | Same app as Pro, extra role | Login + role |
| **Vault** | Ahmad only | His laptop, local only | Local + Tailscale (ADR-063) |

### 1.1 Public (everyone)

| # | Item | Why public | Status |
|---|---|---|---|
| P1 | Landing page (AR + EN) with pricing | Marketing | Proposed |
| P2 | Vision: "Science Observatory for open markets" | Positioning | Proposed |
| P3 | Method doc (`docs/SCIENCE.md`) | Credibility | Proposed, not written |
| P4 | Failure reports (`docs/FAILURES.md`), e.g. the physics-lab result (ADR-065: no physics signal beat plain volatility) | Honest negatives are the strongest proof of method | Proposed, not written |
| P5 | ADRs, after a redaction pass | Engineering transparency | Proposed |
| P6 | Test suite and quality checks of the open framework | Quality evidence | Proposed |
| P7 | Open-source framework code (the "skeleton": bots, orchestration, screens) with no strategies | Trust + community | Proposed |
| P8 | Screen demo on synthetic data | Show the product | Proposed |
| P9 | Council of 5 Advisors: the method, not its live outputs | Unique idea | Proposed |
| P10 | Pricing tiers | Sales | Proposed |

### 1.2 Pro (paying subscribers)

| # | Item | Rule | Status |
|---|---|---|---|
| R1 | Live dashboard | Market data delayed (15 min proposed) | Proposed |
| R2 | Data feeds (public sources: GDACS, USGS, AIS, NASA FIRMS...) | Only sources whose licence allows redistribution | Proposed, licences not checked |
| R3 | Historical signals | Published 24 h after the fact, never ahead of a Vault decision | Proposed |
| R4 | Council session outputs | Generic analyses, not Vault's decisions | Proposed |
| R5 | Advanced analytics | No strategy parameters exposed | Proposed |
| R6 | Weekly report | Reviewed by Ahmad before release | Proposed |
| R7 | Portfolio performance | Only if Ahmad later chooses to disclose; default **off** | Proposed, default off |

### 1.3 VIP (higher tier)

| # | Item | Status |
|---|---|---|
| V1 | Private Council sessions on the subscriber's own question | Proposed |
| V2 | Real-time signals | **Needs a legal check first** (see section 4) |
| V3 | Custom analysis | Proposed |

### 1.4 Vault (Ahmad only, never leaves the laptop)

| # | Item | Status today |
|---|---|---|
| X1 | Director 00 decisions | Exists, paper/proposal only |
| X2 | Real positions | Do not exist (no live trading) |
| X3 | Real PnL | Does not exist (paper trading only, ADR-044) |
| X4 | Signals before any release | Exists (bots, World Pulse, Oil Watch) |
| X5 | Strategies that work, with their parameters | Backtests exist, none proven |
| X6 | Actual portfolio | Not connected |
| X7 | API keys and secrets | Encrypted, outside repo (ADR-042) |
| X8 | Personal data | Local |
| X9 | Real trading | Not built |
| X10 | Private fund | Idea only |

Golden rule for sorting anything new: if it reveals **how**, **how much**, or **from where** the money is made, it is Vault.

## 2. Technical separation (proposed)

```
 VAULT (laptop, today's stack)          PRO / VIP (new, hosted)            PUBLIC (new)
 ┌──────────────────────────┐          ┌───────────────────────┐          ┌──────────────────┐
 │ Director 00, bots, keys  │  export  │ own DB, own secrets   │  static  │ landing, demo,   │
 │ Postgres :5435, web :3100│ ───────▶ │ login required       │ ───────▶ │ docs, public repo│
 │ no inbound from internet │ one-way, │ no route back to Vault│  build   │ no backend       │
 └──────────────────────────┘ delayed, └───────────────────────┘          └──────────────────┘
                              reviewed
```

1. **Public is a different repo and a static build.** giant-core is never made public: its history holds
   private work and was never audited for secrets. A new public repo is assembled from an allow-list of
   files, scanned (secret scan + manual review) before its first push.
2. **Pro/VIP is a different deployment** with its own database and its own credentials. It holds no exchange
   keys, no Vault database credentials and no network path to the laptop.
3. **Vault stays local.** Reachable only from Ahmad's own devices over Tailscale (ADR-063); the planned
   Cloudflare Tunnel + Access + TOTP is for Ahmad's own access, not for subscribers.
4. **One export job is the only bridge.** It runs on the laptop, pushes out (never pulls in), applies the
   delay, strips any field on a deny-list (positions, sizes, prices of fills, PnL, strategy params, keys),
   and writes an audit log. Proposed: Ahmad approves each batch in the Review screen until it has a track record.
5. **Demo data is generated**, with a visible "synthetic" label, from a seed in the public repo.

## 3. Daily flow (proposed, simplified)

1. A bot or Director 00 flags something. It stays in Vault.
2. Ahmad sees it and decides himself (Human-in-the-Loop, as today).
3. After the delay, a generic version may go to Pro as a historical signal.
4. The public site may later publish a "what we learned" note, without numbers that reveal a position.

## 4. Open questions only Ahmad can answer (or that need outside advice)

- **Selling signals while trading on them first.** The pasted plan has the owner act on a signal before
  subscribers receive it. In many jurisdictions, paid trading signals or investment advice need a licence,
  and trading ahead of your own published recommendations can count as front-running or "scalping". A lawyer
  in his jurisdiction (Kuwait CMA, and wherever subscribers live) should confirm before any paid signal
  product (R3, V2). This document does not resolve it.
- Data licences: several feeds are free for personal use but not for resale (R2).
- Which price points, if any. The pasted text gives conflicting ranges ($29-99 for Public and for Pro,
  $49-199, $199-499); all are targets to validate, not decisions.
- Whether portfolio performance (R7) is ever disclosed.

## 5. Out of scope here

- No package, skill, MCP server or third-party repo is installed by this proposal. The TradingView MCP options
  and the "perpetual machine" tool list stay unreviewed under the external-tools rule (no install without Ahmad's approval and a prior isolated security review).
- No automatic withdrawal, transfer, exchange or live-trading code. Profit Sweeper stays proposal-only.
- No landing page deploy, launch post or outreach.

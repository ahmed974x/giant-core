# ADR-088: DESIGN.md, project skill rules and THE CHAIN finance research workbench

Date: 2026-10-18 · Status: Accepted (Phase 3 approved by Ahmad 2026-10-18 18:04Z, together with merging PR #19)

## Context
After ADR-087 Ahmad asked for one written design system (Apple HIG + Linear + Stripe + Replicate on a white canvas), rules from ten outside skills and plugins inside the project, a UI for three finance agents chained through a per-ticker notes.md, an update of site-landing, and a Vercel Web Interface Guidelines audit with a browser check. The coordinator's limits still hold: display only for trading, copy-trading and profit split; no invented data; free open-source only.

## Decision
- `DESIGN.md` at the repo root is the single design reference; `site-landing/style.css` stays the token source.
- Two project skills, text only: `.claude/skills/omega-design` (DESIGN.md + Vercel guidelines copy at `434b7f9`, MIT + three-size loop) and `.claude/skills/omega-finance-chain` (agent rules). No third-party scripts, hooks or installers were copied. claude-mem and find-skills stay rejected (2026-10-15 review); anydoc, awesome-claude-design and claude-code-setup were not read in this pass.
- `omega-ops-room-v1/the-chain.html`: one self-contained file, double-click works, fonts embedded, same tokens and contrast gate.
  - News: GDELT DOC 2.0 `artlist`, last 90 days, `credentials: "omit"`. Analyst targets, bull/bear arguments, management quotes and earnings expectations have no free open feed, so the user enters them with a source link and date; entries without both are shown as «تعذر التحقق منها» and excluded from every figure.
  - Heuristics (category, sentiment suggestions, wording shift, tone, dodge detection, thesis support) are tagged [INFERENCE].
  - Model: every constant lives in INPUTS (including sensitivity steps, ranking perturbation and the 30% break threshold). DCF with Gordon terminal value, comps by median peer multiples, two-way matrix, tornado ranking, bisection for the break level. The built-in example is labelled as invented numbers.
  - State in `localStorage` per ticker; URL carries `?t=TICKER#panel`.
- Ops Room links to THE CHAIN; site-landing gets a `#chain` section, a copy-trading portal card «قيد الموافقة», and a skip link.
- `scripts/ui-three-sizes.mjs`: Mobile 390×844 @3x, Laptop 1440×900, Ultra-wide 2560×1080, light and dark; fails on errors or overflow.

## Consequences
- Nothing new can trade, accept money or copy trades. Those cards stay locked until a separate explicit approval and legal review.
- GDELT could not be reached from the cloud sandbox, so the news fetch was tested with a mock there; first live check happens on Ahmad's laptop. If GDELT ever drops CORS, the panel shows the failure and the Information Gaps list says so.
- Audit and run results: `audits/VERCEL-WIG-AUDIT-phase3.md`.

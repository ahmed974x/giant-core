# ADR-086: One-brain page (/brain): a local chat that answers from the owner's notes

Date: 2026-10-16 · Status: Proposed (new draft PR, not merged)

## Context
Ahmad asked for a one-brain assistant (Claude/ChatGPT-style, free, local-first) and to add it to the site. The design
(`docs/agents/ONE-BRAIN-DESIGN.md`) recommends a thin shell we own, local model first, with no external provider by
default. The licence checks for the candidate bases are incomplete, so this step builds nothing from them.

## Decision
- **`/brain`** (`dashboard/brain/index.html`): a question box. It posts to the existing second-brain endpoint
  (`/mind/api/think`, ADR-081), which answers only from the owner's own atoms, cites them, and suggests a next question.
  Each citation links to its evidence (`/mind/api/evidence/<n>`).
- **Disclosure** on the page (Arabic and English), as on `/mind` and `/offices`.
- **No provider switch yet.** Nothing leaves the laptop. The free provider path from the Oracle design is a later step,
  behind a per-provider switch set by the owner.
- **Relay**: the page is a static route in the page map (`/brain`), under the same strict HTML CSP as the other pages.
  The question goes to `/mind/api/think`, which the relay already rate-limits.

## Consequences
- Checked in a headless browser at 390 px with the demo fixture: the answer and citation render, no horizontal scroll,
  no console errors. The live think call needs the mind service running (laptop).
- Answers are extractive for now (the phase 3 choice): no generated text, so nothing can invent a fact.

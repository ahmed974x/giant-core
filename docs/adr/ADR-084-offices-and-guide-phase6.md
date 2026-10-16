# ADR-084: Agents phase 6: the offices, the guide and the disclosure on every page

Date: 2026-10-16 · Status: Proposed (draft PR, not merged)

## Context
Phase 6 of ADR-077. Ahmad needs to see who the agents are, what each may use and what each may not, and whether
one is paused, in plain Arabic. Every agent says it is an AI (ADR-076), and every page should say so too.

## Decision
- **`/offices`** (`dashboard/offices/index.html`): one card per agent from `api.nerve_agents` (web_anon view): Arabic
  and English name, role, status (a paused agent shows in red with who paused it and why), tools, what it cannot do,
  its container, the queue depth, last activity and its own disclosure line. No CDN, no fonts, text set with
  `textContent` (no HTML from the database). `?demo` shows a fixture for review without the database.
- **`/offices/guide`** (`dashboard/offices/guide.html`): Noura's glossary in Arabic. It explains the agents, and the
  terms a beginner meets: owner, proposal, two keys, RR, paper, Vault, hash chain, budget, checkpoint, tainted input,
  evidence, pause, disclosure. It says what each term does not mean (for example, "paper" is not money).
- **Disclosure banner** on `/offices`, `/offices/guide` and `/mind`. It states in Arabic and English that the user is
  talking to AI agents, that none is a bank, and that none acts for the user. The loop has no page of its own; its
  answers appear on the second brain page, which carries the banner.
- **Relay**: the static page map (`PAGE_FILES`, renamed from `MIND_FILES`) serves the offices pages under the same
  strict CSP as the map (no inline style from outside, `connect-src 'self'`, `frame-ancestors 'none'`). The CSP now
  follows the content type (any HTML page), not the path.

## Deviations
- The offices page reads one view and does no writes. Pausing an agent stays with the owner's tools (ADR-079); the page
  shows the pause, it does not offer a button.
- Last-activity time is shown as a local date string; the view gives the raw time.

## Consequences
- Checked in a headless browser at a phone width (390 px): 3 cards with 1 paused, the guide renders, no horizontal
  scroll, no console errors. The map page renders with the banner.
- The compose stack serves the same `dashboard/` mount; no compose change is needed for these pages.

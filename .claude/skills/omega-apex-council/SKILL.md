---
name: omega-apex-council
description: Use when changing or using the OMEGA APEX council (omega-ops-room-v1/omega-apex.html, scripts/lib/apex-council.mjs), its fifteen field helpers, its paper-only PRIME plans, or the dark gold peak tone shared by every OMEGA page.
---

# OMEGA APEX council (ADR-127)

Text rules only; no scripts run from this skill. Read `omega-design` for the look and `supreme-software-ui-architect` before any UI or data change.

## 1. The council
- One field helper per domain of `scripts/lib/knowledge-domain.mjs` (`FIELD_HELPERS`, same ids). Each has a role, a `guard` it never breaks, an ORACLE `mode` and lens; its sources, pages and partners come from the domain tables through `fields(reg)`.
- A new domain needs a new helper here; `test-apex.mjs` fails when the counts differ or a partner is not a PRIME helper.
- Routing is shared words only: hits / sqrt(question tokens) plus one per source named, shares normalised to 1, seats at share >= `SEAT_MIN` (0.12), at most `SEATS` (5). No match: the knowledge keeper takes it and the verdict says so. Every route, brief, inbox and plan is [INFERENCE].

## 2. Plans
- Recall first, the seats' partner tools (never `exec`), research when sources answer, sentinel for world fields, audit and risk after every market reading for trading fields, note last waiting for all, at most 12 steps.
- Every plan must pass `OMEGA_CORE.checkPlan`. Keep plan `why` text free of the checker's forbidden words (for example "order", "sign", "live"); do not copy helper names or tool descriptions into it.
- The page leaves a plan only under `omega-know-plan-v1`, and the Ops Room runs it only when Ahmad presses Start.

## 3. Register
- `REGISTER` lists free, open-source tools per field as ideas only, each with licence, repo, the page the licence was read from and `REG_ASOF`. Never mark one installed; installing needs Ahmad's approval and a written security review.

## 4. Dark gold peak
- A tone over the dark theme: `:root[data-theme="dark"][data-tone="gold"]`, key `omega-tone`, synced by the suite as `tone: "gold" | "none"`, `?tone=gold` for one visit. Change accent, surfaces and text only; status and `--apple-*` colours keep their meaning.
- After any colour change run `node audits/verify-contrast.mjs <file>`; it checks `gold` and `gold-p3`.
- The suite script is copied in all eight Ops Room pages and `site-landing/suite.js`; change every copy together.

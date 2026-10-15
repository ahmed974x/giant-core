# ADR-071: NABD landing page, local draft

- Status: Accepted; published 2026-10-15 on GitHub Pages from branch gh-pages (Ahmad approved at 23:47Z)
- Date: 2026-10-15
- Decider: Ahmad (asked for Phase 1 "Landing Page" on 2026-10-15)

## Context
Ahmad asked for a bilingual (AR/EN) landing page, HTML + CSS only, GitHub Pages compatible, with three
sections: what NABD does, what we tested, and a waitlist. Payments are not set up, the legal scope (Kuwait CMA)
is not answered, and the waitlist form does not exist yet.

## Decision
Add `site-landing/` with `index.html` (Arabic, RTL), `en.html` (English) and one `style.css`. No framework,
no JavaScript, no external requests (fonts fall back to system fonts), `noindex` while it is a draft.
Content describes only what is in the repo:
- What NABD does: the paper practice account (ADR-044), the five-strategy lab (ADR-052), Deep Research and Newton (ADR-062).
- What we tested: the physics indicators experiment and its failed out-of-sample follow-up, numbers quoted from
  `physics_lab/results/REPORT.md` (ADR-065).
- Waitlist: a placeholder link marked TODO.
Not mentioned: prices, payments, TradingView, vision tools, Council Session or any consulting service (none decided).
Wording avoids trade-call, performance and promise language.

## Consequences
- Nothing is public. Enabling GitHub Pages, buying a domain, linking a form and publishing each need Ahmad's go.
- Open items are marked `TODO` in the pages: waitlist link, domain and contact, legal review of the disclaimer,
  public link to the physics report (it lives on branch `claude/project-thread-huo78r`, not merged), and a final
  check of the feature list.

## Addendum 2026-10-15: published
Ahmad approved publishing (Hero + What NABD does + Waitlist placeholder only). The public version drops the
"What we tested" section, the TODO markers and `noindex`; the waitlist is a disabled "opens soon" button with no
form. Served from an orphan branch `gh-pages` holding only the page files, so `main` is unchanged.

# ADR-072: NABD launch drafts (copy, waitlist, lawyer, Zenodo, checklist)

- Status: Proposed (drafts only; nothing published, sent or created)
- Date: 2026-10-15
- Decider: Ahmad (three-track launch plan, 2026-10-15 23:40Z)

## Context
Ahmad asked for five launch deliverables in Arabic and English: landing copy, a 3-question waitlist form,
lawyer questions, a Zenodo abstract for the physics negative result, and a launch checklist. The landing page
draft already exists (ADR-071, PR #12). The Daily Briefing is not built, no payment provider supports a Kuwaiti
business yet, and the CMA question is unanswered.

## Decision
Add five documents under `docs/`:
- `LAUNCH-COPY.md`: hero, three sections and waitlist text (AR/EN), plus the form design. The hero describes what
  exists; Ahmad's "5 minutes daily" line is kept as a candidate that needs the Daily Briefing behind it.
- `LAWYER-QUESTIONS.md`: describes the product as it is, asks the CMA question (including views on listed
  securities), whether labels change the classification, and the sole-proprietor commercial licence.
- `ZENODO-ABSTRACT.md`: abstract with the exact measured numbers from ADR-065, and which files may be uploaded
  given their data licences.
- `LAUNCH-CHECKLIST.md`: each outward action with its approval and blocker, and a check of the tools named in
  the plan (Lago, Formbricks verified; Arc CMS, Lightning Landing, Tally not verified).

## Consequences
- No form, account, post, upload, email or billing exists. Each is a checklist row for Ahmad to approve.
- Lago billing stays blocked until a payment provider and the lawyer's answer exist.
- PR #12 is unchanged; copy changes reach it only if Ahmad picks them.

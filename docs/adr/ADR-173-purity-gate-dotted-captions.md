# ADR-173: The purity gate reads dotted captions and every page a hook visits

Date: 2026-11-16 · Status: Proposed. In ADR-172, two locked-step labels on `#/release` and `#/architect` ("· Installing or running the model", "· Writing the bundle to a file") were first added to `i18n-ar.json` without their leading dot. In Arabic mode they stayed English next to «قيد الموافقة», and the bilingual purity gate (ADR-151) still reported 0 violations. PR #59 fixed the labels. This ADR closes the gap in the gate.

## What was found

The text was checked in Chromium, in the page, in Arabic mode.

1. **The rule did not skip `.subtle`, `.t-caption`, `.lock-line` or leading punctuation.** A dotted line injected into `#/release` was reported as "English words: · Writing the bundle to a file". The gate's `isolated()` test is true for almost every text, because the browser's default stylesheet gives every block (`div`, `p`, `li`, `ul`, `main`) `unicode-bidi: isolate`. So the line went to `prose()`, which flags a phrase of several words.
2. **The hook left the page before the gate ran.** `checkPurity` ran `PURITY` once, when an extra step ended. The "bundle export" step exported on `#/release`, then on `#/architect`, then went to `#/impact`, so only `#/impact` was read. Reproduced: with the two dictionary keys put back without the dot and the page rebuilt, the old hook reported 0. The same steps checked on each page reported 4: two lines on each page. The "campaign" step had the same shape (`#/architect`, then `#/impact`).
3. **A one-word dotted caption passed the rule.** `prose()` splits a line at `·` and flags a piece only when it has a space inside. So "· Publishing" left in English, inside the default block isolation, was not counted.

## Decision

1. **Dotted captions.** In Arabic mode, a visible text that starts with `·` or `•` is interface text. It is a violation ("English caption: …") when Latin words of two or more letters remain after the gate's name and identifier list (`KEEP`), whether it is one word or several. ADR-151's exemptions still apply: code (`code`, `pre`, `kbd`, `samp`, `textarea`), data marked `lang="en"` or `data-verbatim`, and a name isolated by `<bdi>` or `translate="no"`. The browser's default block isolation does not count as isolating a name here.
2. **Every page a hook visits.** An extra step receives `check()`. It runs the gate on the page as it stands and adds what it finds to that step's result. The gate still runs when the step ends. "bundle export" calls `check()` on `#/release` and `#/architect`, and "campaign" calls it on `#/architect`, in `test-app.mjs` and `test-live.mjs`.
3. **Flow test F33b** (`test-app.mjs`). In Arabic mode it puts a temporary list into `#/release`: a `.lock-line` with «قيد الموافقة» and a `.subtle.t-caption` "· Archiving the probe somewhere", and a one-word "· Archiving". It also adds the same kind of line in `code`, `lang="en"`, `data-verbatim` and `<bdi translate="no">`. It expects the first two to be flagged and none of the four exemptions. With the list removed, the page must be clean. A `checkPurity` step that adds the list, calls `check()` and then leaves for `#/impact` must still report it.

## Not done

- **The general `isolated()` test.** It still accepts the default isolation of block elements, so "not isolated" rarely fires. Narrowing it to `<bdi>`, `translate="no"` and inline isolation would re-judge every screen. That is a separate change with its own run. The multi-word `prose()` rule keeps covering sentences in the meantime.
- **The mutation run.** `bilingual-purity.mjs` is not in ADR-146's list, so nothing was rerun there.

## Consequences

- A new hook that visits more than one page calls `check()` before it leaves each one.
- An English caption that starts with `·` needs its Arabic line, dot included, or it fails F33 in sample and live mode.
- No dictionary line was added: with the fix, both runs found nothing new.
- Review: `docs/security/PURITY-GATE-DOTTED-CAPTIONS-REVIEW-2026-11-16.md`.

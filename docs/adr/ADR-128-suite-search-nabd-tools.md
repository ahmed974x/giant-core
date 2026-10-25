# ADR-128: suite search on every page, a tools grid on NABD, and a switcher that fits short screens

Date: 2026-10-25 · Status: Proposed (Ahmad's message of 2026-10-25 00:07Z, «ادمجهم وصمم الموقع وطور الادوات ورقيه», after PRs #44 to #47 were merged; this polish pass waits for his go).

## Context
After the merge of ADR-124 to ADR-127 the suite has eight Ops Room pages plus NABD, each with many sections. Moving between them meant opening the app switcher and scrolling. The switcher itself grew to eleven rows (search, gold tone, nine apps) with no height limit, so on a short or landscape phone its last rows fell below the screen. NABD, the public page, did not list the tools at all: they were reachable only from the app button.

## Decision
1. **Suite search.** The shared suite script (ADR-107) gains one search box, opened with Ctrl+K or ⌘K on any page or from a new first row «Search · ابحث» in the switcher. It lists:
   - the nine apps and the five Ops Room views (inside the Ops Room a view row presses that view's button; elsewhere it opens `?view=N`);
   - the sections shown on the current page (`main section[id]` and `main [data-view][id]` that are displayed, named by their `aria-labelledby` heading or first heading);
   - the light, dark and dark gold looks, and the language switch where the page has one.

   Words match in Arabic or English after folding case, marks, tatweel, hamza forms of alef, ta marbuta, alef maqsura, waw and ya hamza. Every word must match; a match at a word start ranks above one inside a word, apps rank above sections on a tie, and at most 24 rows show. The box is a modal dialog with a combobox and listbox (`aria-activedescendant`), arrows to choose, Enter to open, Esc or a tap on the scrim to close, and focus returns to where it was. Text goes in through `textContent` only. The Ops Room's own keys (1–5, K, S, X) ignore modified keys, so Ctrl+K never triggers the emergency stop.
2. **What it does not do.** It navigates only: it opens no trade, sends nothing, has no network and stores nothing. It is exposed as `OMEGA_SUITE.palette()` and `OMEGA_SUITE.rank()` for tests.
3. **Switcher.** `.suite-pop` gets `max-height: calc(100dvh − safe top − 76px)` and scrolls inside.
4. **NABD tools grid.** `#tools` on `index.html` and `en.html` lists the eight pages as card links (icon, name, one line, a green «يعمل · ورقي» / "Working · paper" status), four columns at ≥ 1200 px and one on a phone, with a header link. The links are written for the published layout and the suite rewrites any `a[data-suite-href]` with the same rules as the switcher, so they also work from `site-landing/` on disk.
5. Both service worker versions are bumped so installed copies pick up the new suite and style.

## Not done, and why
- Nothing was installed and no data source, rule or trading path changed. Trading stays paper only; real and Testnet routes stay locked.
- Hidden Ops Room sections (other views) are not listed as sections; the view rows reach them instead, so the search never scrolls to something that is not on screen.

## Consequences
- CI runs `node scripts/test-suite.mjs`: the matcher in a `node:vm` context, the search box and link fix in every suite copy, the styles in every stylesheet, and the tools grid in both languages with every link on disk.
- The suite script is still copied into each page; `test-apex.mjs` keeps checking that the eight page copies match.

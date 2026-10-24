# ADR-123: PRIME status table wraps on phones

Date: 2026-10-24 · Status: Accepted with the merge of #40, #41 and #42 (Ahmad's message of 2026-10-24 18:43Z: merge and make the site work at full strength).

## Context
After #40, #41 and #42 were merged, the built Pages site was loaded headless at 390 × 844 and 1440 × 900. Every page
loaded with no script error; one page overflowed: the Ops Room on a phone was 570 to 578 px wide. The cause was the
PRIME status table (`#prStatus`, ADR-118). Its value column uses the `.kv` rule `white-space: nowrap`, which suits
short numbers, but PRIME's rows are sentences ("12 in total · next in 40 s · every 60 s while this tab is open").
DESIGN.md §5 allows no horizontal page scroll at any width.

## Decision
A `.kv.wrap` modifier lets the value column wrap (`white-space: normal; overflow-wrap: anywhere; text-wrap: pretty`).
Only `#prStatus` uses it; the other `.kv` tables hold short figures and keep `nowrap`. The CSP hash is re-pinned.

## Consequences
- The Ops Room has no horizontal scroll on a phone again; numbers stay tabular and monospace.
- Other `.kv` tables are unchanged.

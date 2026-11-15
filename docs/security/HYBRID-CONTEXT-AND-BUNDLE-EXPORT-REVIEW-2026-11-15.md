# Security review: hybrid context memory, this laptop or a web host, the bundle export and campaigns (ADR-172)

Date: 2026-11-15 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) |
|---|---|---|
| `jarvis/server/lib/model-catalog.mjs` | @L1 | @H1 |
| `jarvis/server/lib/impact-analysis.mjs` | @L2 | @H2 |
| `jarvis/server/lib/release-gate.mjs` | @L3 | @H3 |
| `jarvis/server/lib/architect-studio.mjs` | @L4 | @H4 |
| `jarvis/server/lib/campaign-log.mjs` | @L5 | @H5 |

| File | Lines | SHA-256 (first 16) |
|---|---|---|
| `.claude/skills/replica-impact-analysis/impact_analysis.py` | @L6 | @H6 |
| `.claude/skills/replica-release-gate/release_gate.py` | @L7 | @H7 |
| `.claude/skills/replica-architect-studio/architect_studio.py` | @L8 | @H8 |

Also changed:

- `server.mjs`: the event text for the exports and campaigns, saving a campaign on request, and `GET …/architect/campaigns`;

- both schemas: the table `architect_campaigns`;

- `app.js`, `app.css` and `i18n-ar.json`;

- the golden files, and the server, flow, live and mutation tests.

## 2. What it can do

- **Read nothing new.** The two estimated cards and the 14 blocking lists come from the `config.json` files read for ADR-171, with the same SHA-256. No code path calls Hugging Face.

- **Run nothing.** The router compares two numbers and names a verdict; moving a model to a web host is a locked `publish` step. A campaign lists checkpoints and commands; it runs none of them.

- **Sign without unlocking.** A receipt needs the seal open (403 otherwise) and the exact hash of one locked step in this plan. It is SHA-256 of a fixed domain, the seal and that hash, so it cannot be made without the seal and does not fit another step or plan. The step keeps `locked: true` and `pending_approval`; the prover and every page still see it locked. Approving the action itself stays with Director 00 (AGENTS.md §1, ADR-141).

- **Keep the code out of storage.** The page stores the campaign request without the code. The server strips it before saving, and `architect_campaigns_no_code` refuses a row that still has one, in SQLite and PostgreSQL. The table is append-only in both. The tests check that the saved rows and the listing hold neither the code nor the full seal.

- **Write nothing else.** The export is text in the answer; copying it needs a press of Copy. Writing a file is a locked step.

- **Bound the arithmetic.** The hybrid product is at most 2 × 8 × 128 × (64 × 10⁸) ≈ 1.3 × 10¹³ values before the batch and bits, a whole number below 2⁵³. Requests are bounded: 64 done or failed checkpoints, reasons of 200 characters on one line, 32 signed hashes.

## 3. Honesty

- **Only stated layers are counted.** A card is estimated only when its file names every layer and gives one window and one head layout. For the other 14, the page shows the fields that stop it.

- **No verdict without a total.** With no context length, or a memory not estimated, the router says `undecided` and why.

- **The licence is read for both uses.** A site of your own is personal use while only you use it; once others use it, the serving rule and ADR-171's terms apply.

- **The export repeats, never adds.** Every field comes from the engines' own answers, with keys sorted, so Node and Python give the same text and hash (`tests/golden.json`).

## 4. Page safety

- Text is set with `.value` and `textContent`; nothing is parsed as HTML. The export box is read only and marked as data for the bilingual gate.

- The checkpoint bar is solid segments coloured by status only, with no text inside and no gradient.

- The CSP is unchanged: no new host, no inline handler, no style attribute.

## 5. Not added

The proposal's launch files were read as text and not added:

- a Caddyfile whose CSP allows `'unsafe-inline'`;

- a second SQL schema;

- Bitwarden CLI scripts.

The repository's `jarvis/deploy/Caddyfile` and schemas stand, and a new tool needs Ahmad's approval and a written review.

## 6. Checks

The commands and their results are in the pull request. Biome is not installed in this sandbox, so `npx @biomejs/biome lint` was not run.

## 7. Decision

Accepted. The change is safe to run on Ahmad's machine as written.

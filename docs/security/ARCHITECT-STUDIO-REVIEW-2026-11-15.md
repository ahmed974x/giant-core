# Security review: the architect studio (ADR-170)

Date: 2026-11-15 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/architect-studio.mjs` | 109 | 9901c2818846fffe | The seal, the preview scale, the composite draft and the radar, pure |
| `.claude/skills/replica-architect-studio/architect_studio.py` | 204 | bf6adbe6b56331aa | The same rules in Python |
| `.claude/skills/replica-architect-studio/tests/test_architect_studio.py` | 65 | cc37a8103c848c85 | 6 unit tests, one against the server's golden answers |
| `.claude/skills/replica-architect-studio/tests/golden.json` | — | 81e9b36dca49d7e1 | 96 requests with the server's answers |

Also changed:
- `server.mjs`: `POST /api/w/:slug/architect`, and the `architectSeal` start option, which defaults to `JARVIS_ARCHITECT_SEAL`;
- `runbook.mjs` and `runbook.py`: `#/architect` is the thirteenth page probe;
- `impact-analysis.mjs` and `impact_analysis.py`: `#/release` and `#/architect` in the page list;
- `build-app.mjs`, `app.js`, `app.css`, `shell.tmpl`, `i18n-ar.json`: the `#/architect` page;
- `bilingual-purity.mjs`: adds `architect` to the routes;
- the server, flow, live and mutation tests.

## 2. The seal

- **What it is.** A domain-separated SHA-256 of the NFC-normalised code. The prefix `aether-prime:architect-seal:v1:` keeps the hash from matching a plain SHA-256 of the same text elsewhere. A test checks the NFC rule: `e` + combining acute equals `é`.
- **Where the expected seal comes from.** The server's own option or environment variable; in the file page, this browser. **A seal in the request is never read.** A server test sends its own `seal` and `expected` fields with the hash of its own code, and the studio stays locked.
- **What leaves the engine.** Five characters of the hash. The full hash only when no seal is set up, so it can be saved, and never afterwards; a server test checks it is absent from the answer. The code is not stored, not logged and not kept in browser storage. A flow test reads every `localStorage` value and finds no code. The event log keeps the state only, and a server test checks it holds neither the code nor the hash.
- **Its strength, stated plainly.** This is a single SHA-256, not a password hash like the founder gate's scrypt (ADR-141), and there is no attempt limit. That is acceptable only because the seal guards nothing sensitive: the preview scale and the draft change nothing outside the page. Every action that does (installing, writing a skill, outbound connections, running a model, publishing) stays a locked approval whatever the seal says. In the file page the seal is a convenience lock in one browser: anyone with the file can clear that browser's storage. **It is not an access control and must not be used as one.**
- **The comparison** is plain string equality of two hex hashes. A timing difference would reveal only how many leading hex characters of the hash match, not the code, and the seal guards nothing sensitive.

## 3. What it can do

- **Read, nothing else.** The engine is pure: no network, no process and no file. A unit test checks the Python file for the words that would start a process, open a connection or run text as code.
- **Keep checks in one place.** The skills, the model and the notes are checked by release readiness, impact analysis and plan order. The studio checks only its own inputs:
  - the mode, the code, the scale, the density and the numerals;
  - the name: 2 to 48 lower-case letters, digits and hyphens;
  - the description: one line of at most 300 characters, so it cannot add lines to the draft's front matter;
  - at least two skills.
- **Write nothing.** The draft is text in the answer. Writing it to `.claude/skills` is a locked install step.
- **Page.** Text goes in with `textContent`. The draft is shown in a `<pre>` marked `data-verbatim`. The preview's variables are set with `style.setProperty` on one element, with no `style` attribute and no `innerHTML`. The CSP is unchanged.

## 4. Design rules

The preview scale cannot break DESIGN.md:
- nothing goes below 12 px (a test checks 90 percent: 13.5 px body, 12 px caption and footnote);
- spacing stays on the 4/8 scale;
- the outer radius is the inner radius plus the padding;
- no colour changes;
- proportional numerals apply only inside the preview card.

## 5. Cost

Measured on this sandbox:

| Mode | Time per call |
|---|---|
| seal | 0.25 ms |
| ui | 0.20 ms |
| radar | 1.5 ms |
| compose (two skills, through the release bundle and project search) | 54 ms |

## 6. Checks

The commands and their results are in the pull request. Biome is not installed in this sandbox, so `npx @biomejs/biome lint` was not run.

## 7. Decision

Accepted. The skill is safe to run on Ahmad's machine as written.

# Security review: the open-weight model catalog read again (ADR-167)

Date: 2026-11-15 · Reviewer: Claude Code, cloud sandbox.

## 1. What changed

| File | Change |
|---|---|
| `jarvis/server/lib/model-catalog.mjs` | 30 families, each with `card`, `created`, `params` and `read`; adds `CATALOG_READ` |
| `jarvis/app/src/app.js` | The Settings catalog adds the Parameters and Source columns |
| `jarvis/app/src/app.css` | `contain: inline-size` on the catalog's scroll box, so the open table no longer widens the page (it did on a phone before this change too, 541 px at 390) |
| `jarvis/app/src/i18n-ar.json` | Nine Arabic lines: the two page sentences and the seven new licence texts |
| `jarvis/scripts/bilingual-purity.mjs` | Adds the names Hugging, Face and Kimi to the names kept in Arabic mode, like GitHub and Qwen before them |
| `jarvis/server/test/test-server.mjs`, `jarvis/scripts/test-app.mjs` | Three server checks, and the flow test's count |

## 2. What it can do

- **Fetch nothing.** The catalog is a fixed table in the file. The records were read once, by hand, through `https://huggingface.co/api/models/<id>`; no code path in the repository calls that host.
- **Install nothing.** No model is pulled or started. `profileOf` only matches a name that a local engine on 127.0.0.1 already serves. The local bridges keep refusing any other host and `:cloud` models (ADR-136, ADR-140).
- **Make one kind of link.** The page's only new outbound element is a link to `https://huggingface.co/<card>`. `card` comes from the fixed table, never from input, and a server test checks that every `card` has the form `owner/name`. The link opens with `rel="noopener noreferrer"`; the CSP is unchanged (`connect-src 'self'`).
- **Write text only as text.** Every cell goes in with `textContent` through `h()`.
- **Stay unambiguous.** Matching is by fixed regular expressions with no nested quantifiers. A server test checks that each card's own name finds its own family, so a shorter pattern cannot capture a longer family's model.

## 3. Honesty

- **Licences.** Each licence is the record's `license` field. A custom licence (`other`) is named by the first line of its repository `LICENSE` file:
  - Qwen3.8-Max License and Qwen Community License 1.0;
  - GLM-5.3 License;
  - Kimi K3 License and Kimi K3.1-Pro License;
  - Llama 4 Community License (from the record's `license_name`);
  - Mistral Ecosystem Open-Weight License.

  The custom files were read only up to their conditions, so the conditions are not summarised. Mistral's licence is the exception: its condition was read in full and is stated (a Model-as-a-Service business needs a separate commercial licence).
- **Sizes** are the safetensors totals the records declare. Mistral Large 4's record gives none, so the page shows «تعذر التحقق منها»; the card's own 1T / 49B active figures stay in the note.
- **No ranking.** Benchmark numbers on the cards are the makers' claims; none is copied.
- **The network change was approved, and it is limited.** `huggingface.co` was blocked in this cloud session, and Ahmad approved a personal environment that allows that one host. The change affects cloud sessions only, not the laptop or the repository.

## 4. Checks

Check results are in the pull request description.

## 5. Decision

Accepted. The catalog stays a fixed, sourced table; nothing new runs, connects or installs.

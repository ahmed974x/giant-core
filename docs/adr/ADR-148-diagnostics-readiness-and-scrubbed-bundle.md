# ADR-148: Diagnostics — readiness of the five layers and a scrubbed bundle

Date: 2026-11-06 · Status: Proposed. Ahmad's message of 2026-11-06 asked for:
- a readiness page for Jarvis's five layers;
- a diagnostic bundle that cannot carry a secret out, after a pattern and Shannon-entropy scrubber.

Locked actions must stay locked, refused in the database and with 403 in the API.

## Decision

1. **`#/diagnostics`** checks each layer now, from the database, the evidence files and the running services (`jarvis/server/lib/readiness.mjs`, read-only). The checks per layer:

   | Layer | Checks |
   | --- | --- |
   | Memory | BM25 episodes and SHA-256 capsules in the workspace; the capsule tables are append-only (the trigger exists) |
   | Development and proof | the server and flow test logs show 0 failed; the UI-state gate is complete; the mutation run is [VERIFIED] (every tested file still has its hash); a plan with locks passes the formal proof |
   | Open search and SSRF shield | the official APIs are on fixed hosts; the shield refuses all 11 private addresses in the list, IPv6 spellings included |
   | Security | SkillSpector shows 0 critical and 0 high on the skills; the Merkle audit log verifies; all 10 lock constraints exist in this database (SQLite `sqlite_master` or PostgreSQL `pg_constraint`) |
   | Local model bridge | the model engine is on 127.0.0.1; no cloud model; the server itself is bound to 127.0.0.1 |

   Sample mode checks what the browser can: the build's evidence, the prover, the SSRF list and its own Merkle tree. It says which checks need the local server.
2. **`GET /api/w/:slug/diagnostics/bundle`** returns one JSON document with:
   - the layers;
   - the Merkle tree head;
   - approval counts by status and category;
   - the latest 50 events (kind, actor, target, time).

   It holds no request body, environment or file content. Before it leaves the server, `diagnostics.mjs`'s `scrub` replaces with `[REDACTED]`:
   - every value under a secret-like key name;
   - known key formats: OpenAI-style, GitHub, AWS, Slack and Google keys, private key blocks, bearer tokens, JWTs, and passwords inside URLs;
   - any run of 24 or more key-like characters with Shannon entropy of 4.5 bits per character or more.

   Hex digests top out at 4 bits a character, so SHA-256 hashes and the Merkle root are kept. The bundle reports how many values were removed, by which rule and where. The page saves it on this computer and sends nothing.
3. **The locks are unchanged.** Money, publishing, permissions, installs into `.claude/skills` and outbound messages wait for Director 00. The page repeats this, and the layer check proves the constraints are in the database.

Review: `docs/security/DIAGNOSTICS-BUNDLE-REVIEW-2026-11-06.md`.

## Consequences

- A broken layer shows at once: a stale mutation run, a missing constraint or a test log with failures turns its layer to "Needs attention".
- The scrubber is a safety net, not a licence: the bundle is built from fields chosen not to hold secrets in the first place.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Server tests** on SQLite and PostgreSQL 16, including a planted GitHub token and a password in a URL;
- **Flow tests:** F30 in `test-app.mjs`, and `test-live.mjs` (five layers ready, planted token removed);
- **Contrast**;
- **Three sizes** for `#/diagnostics`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.

# Security review: diagnostics and the scrubbed bundle (ADR-148)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/diagnostics.mjs` | 79 | 74d0686942a92035 | The scrubber (key names, key formats, entropy), lock and SSRF lists |
| `jarvis/server/lib/readiness.mjs` | 86 | 123adaedea8c7b35 | Layer checks and the bundle (read-only) |

## 2. What the routes do

- Both are `GET`, behind the same Host and founder-gate checks as every route, and read-only.
- **What they read:**
  - row counts;
  - `sqlite_master` or `pg_constraint` / `pg_trigger` names;
  - three evidence files under `jarvis/replica/evidence/` and `jarvis/app/data/skills-scan.json`;
  - the bridge's and search's status;
  - the Merkle head.
- **What they do not read:** request bodies, `process.env` or any other file.
- The SSRF probes are a fixed list checked with `isBlockedAddress`; no request is made.

## 3. The scrubber

- **Field names:** a value under a name matching password, secret, token, api key, private key, cookie, authorization, credential, session id or founder key is removed whatever it holds.
- **Key formats:** OpenAI-style `sk-`, GitHub (`ghp_` and its family, `github_pat_`), AWS (`AKIA`/`ASIA`), Slack (`xox?-`), Google (`AIza`), PEM private key blocks, `Bearer` tokens, JWTs, and `user:password@` in URLs (the password only).
- **Entropy:** a run of 24 or more characters from the base64 and URL-safe set with Shannon entropy of 4.5 bits per character or more is removed. Hex strings are kept: they top out at 4 bits a character, and here they are hashes.
- **Tests:**
  - every rule fires;
  - hex digests, UUIDs, plain words, numbers and booleans are kept;
  - each removal is reported with its path;
  - a GitHub token and a URL password planted in the event log never reach the bundle, on both engines and through the live page.

## 4. Limits, said plainly

- Patterns and entropy catch common secrets, not every one. A short, low-entropy password in free text with no secret-like key name would pass, so the bundle is built from fields that should never hold one.
- The page saves the file on this computer. Sharing it is the person's decision; Jarvis sends nothing.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict jarvis/server/lib/diagnostics.mjs jarvis/server/lib/readiness.mjs` | 0 critical, 0 high |
| server tests (SQLite and PostgreSQL 16) | in the PR body |

## 6. Decision

Added. A later change needs a new entry here.

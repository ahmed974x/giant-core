# Security review: purity coverage, schema catch-up and skill provisioning (ADR-173)

Date: 2026-11-16 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) |
|---|---|---|
| `jarvis/scripts/bilingual-purity.mjs` | 78 | 7476370ab83a3943 |
| `jarvis/server/lib/schema-sync.mjs` | 41 | ac6da1db9f2d07c5 |
| `jarvis/server/lib/db.mjs` | 104 | 6af70a0981634629 |
| `jarvis/server/lib/release-gate.mjs` | 173 | 61261d74d2739b05 |
| `jarvis/server/lib/architect-studio.mjs` | 195 | 34764f82ba9dbd69 |

| File | Lines | SHA-256 (first 16) |
|---|---|---|
| `.claude/skills/replica-release-gate/release_gate.py` | 299 | b5c4127c9bf64f30 |
| `.claude/skills/replica-architect-studio/architect_studio.py` | 330 | d7493066d4c4f7dd |

Also changed: `server.mjs` (the provisioning event), `app.js` and `i18n-ar.json`, the golden files, and the server, flow, live and mutation tests.

## 2. What it can do

- **The gate reads more, changes nothing.** It runs in the test browser only. A step that ends on another screen is reported; it opens no new host and changes no page.

- **The schema catch-up runs only `schema.sql`.** The file ships with the server, so the statements are the repository's own. Each is made safe to run again; none drops, alters or deletes. They run in one transaction, so a failure leaves the database as it was and the server does not start. The connection stays local (127.0.0.1, ::1 or a Unix socket), as before.

- **Provisioning reads files only.** It reads the skill-tree snapshot and the page list. It runs no test, installs nothing and writes nothing. Installing or changing a skill is a locked step. A skill name from the request is only compared and echoed, at most 64 names of 80 characters.

- **The export is text in the answer.** Copying it needs a press of Copy; writing a file stays locked.

## 3. Honesty

- **A missing part is named, never guessed.** It is the file or field the snapshot lacks: `SKILL.md`, `tests/`, `tests/golden.json`, `page route` or `SkillSpector clean scan`.

- **"Provisioned" means the five parts are there.** It does not say the skill's tests pass today; the release gate and the mutation run say that.

- **The catch-up does not change existing tables.** A column added to a table that already exists needs a reviewed migration, and the record says so.

## 4. Not added

The proposal's `schema-bootstrapper.mjs` and its test were read as text and not added:

- splitting on every `;` breaks the `$$` bodies of the schema's nine functions;

- it hid errors except "already exists";

- its test added `better-sqlite3`, a dependency the server does not use.

## 5. Checks

The commands and their results are in the pull request. Biome is not installed in this sandbox, so `npx @biomejs/biome lint` was not run.

## 6. Decision

Accepted. The change is safe to run on Ahmad's machine as written.

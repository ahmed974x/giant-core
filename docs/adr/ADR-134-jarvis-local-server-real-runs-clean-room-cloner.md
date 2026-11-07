# ADR-134: Jarvis local server, real runs, workspaces, agent editor and the clean-room cloner

Date: 2026-11-04 · Status: Proposed. Ahmad's messages of 2026-11-04 asked to:

1. close the three open must-haves (agent editor, multi-workspace switcher, real runs through `/replica-backend`);
2. add `replica-backend` and, if possible, `replica-entrepreneur` after a security review;
3. build the local server on `schema.sql`, PostgreSQL 16 with a zero-setup fallback;
4. add a one-click clean-room URL cloner to the Studio, with its network code in the local server only;
5. rerun `/replica-diff`, take retina screenshots, and update PR #52.

The merge waits for his go.

## Context
ADR-133 shipped the page with a sample store and simulated runs. Three must-haves were partial: agent editing, the workspace switcher, and real runs.

## Decision
1. **Skills.** `replica-backend` and `replica-entrepreneur` are vendored from `Jakeschincariol/replica-skill@77c9436` (MIT). `reviews.py` and `themes.json` are byte-identical to upstream. Each `SKILL.md` gained a giant-core section that locks payments and outward actions and keeps sources keyless. New tests: `tests/test_reviews.py` (3). Review: `docs/security/JARVIS-SERVER-AND-SKILLS-REVIEW-2026-11-04.md`.
2. **Server** (`jarvis/server`, Node 22).
   - **Listener.** One listener on `127.0.0.1:8798` serves the app, `/design` and a JSON API.
   - **Guards.**
     - The `Host` header must be this server's (blocks DNS rebinding).
     - Writes need `X-Jarvis: 1`, a same-origin `Origin` when one is sent, and a JSON body under the size cap.
     - No CORS headers are ever sent.
   - **Databases.**
     - **SQLite** (`node:sqlite`, zero setup) by default.
     - **PostgreSQL 16** with `JARVIS_DB=postgres` and a local `DATABASE_URL`. It uses `pg@8.23.0`, the version `web/` already pins, locked with sha512.
     - Remote databases are refused.
   - **Schemas.** `schema.sql` (PostgreSQL) and `lib/schema-sqlite.sql` hold the same named constraints, so the rules are the database's, not the page's:
     - `approvals_locked_never_approved`;
     - `approvals_decided_by_member`;
     - `approvals_reject_has_reason`;
     - `runs_one_active_per_agent`;
     - the append-only event log.

     `tools` and `skills` became `jsonb`, and runs gained `input` and `log`.
3. **Real runs** (`lib/runner.mjs`).
   - **Tools.**
     - **files.read** reads only under `docs/`, `jarvis/replica/` and the workspace's notes, re-checked after resolving symlinks.
     - **notes.read**, **runs.read** and **git.log** (`.git/logs/HEAD`, no process) also run for real.
     - **web.read** uses the public-page fetcher.
   - **Plans and summaries** follow fixed rules, and every run says "no model". Wiring in the loopback model bridge is a separate decision.
   - **Notes** are never written during a run. **notes.write** files a `file_write` approval; once a person approves it, the server writes the note inside that workspace's notes folder and never overwrites.
4. **Workspaces and the agent editor.**
   - The server seeds three workspaces: OMEGA PRIME, Jarvis Studio and giant-core. Each has its own agents and locked sample requests, labelled «Sample request».
   - The top bar's switcher is an APG menu button; switching reloads every screen.
   - The agent editor changes:
     - name, model, role and step limit;
     - tools, which set the agent's permissions;
     - linked skills from `.claude/skills`.

     Money, publish, permissions, install and outbound are shown as disabled, locked rows.
5. **Clean-room cloner** (`POST /api/studio/clean-clone`; code in `lib/fetch-public.mjs` and `lib/clean-clone.mjs`, outside `.claude/skills`).
   - **The fetcher** makes one GET with an honest user agent. It obeys `robots.txt`, allows only http(s) on ports 80 and 443, and caps the page at 2 MB, 10 s and 3 checked redirects. It refuses private, loopback, link-local and reserved addresses inside the socket's DNS lookup.
   - **The parser** reads the HTML as text and never runs it. It keeps only the layout shape: section order, card and column counts, nav link count, table size.
   - **The output** fills that shape with fixed Jarvis copy in English and Arabic.
   - **A sweep** checks the output against the source's brand terms and long phrases, and the report lists what was dropped (scripts, trackers, stylesheets, images, frames, text).
   - **In the Studio** the clone shows in the sandboxed preview, flips between AR RTL and EN LTR, and downloads as one HTML file with a pinned CSP. Publishing stays a locked card.
   - **The preview runtime** gained table and text blocks, up to six items per repeating block, and the column count from the source grid.
6. **App modes.**
   - **Live.** When the page is served by the server, `store` talks to the API and polls a cheap `/version` marker (every 1.5 s, only while a screen is listening). The CSP is `connect-src 'self'`.
   - **Sample.** From `file://` it keeps the labelled sample store, which now has the same three workspaces and editing. Runs there are still simulated and say so.
   - **Build fix.** `build-app.mjs` now takes the policy from the template and carries over only the pinned hash lists. Before, a template CSP change could not reach the built page.

## Results
- **Parity** (`/replica-diff`): **27 of 27 must-haves done**. That is the 24 from before, which are now all done, plus three new: the server, real runs and the cloner. The weighted feature score is **88.5**. The gap is should- and could-haves not in this request:
  - workflows (S06, S07);
  - the Arabic UI translation;
  - run comparison, templates, scheduled runs, webhooks and analytics;
  - plus three partial rows (members and roles, server push, model cost).
- **Screenshots.** 30 retina images (`deviceScaleFactor: 2`): Studio after a clean clone (EN and AR RTL), the Skill Mixer, the agent editor and the locked approvals; dark and light; 1440, 768 and 375. They are on branch `jarvis-screens-retina`, kept out of the PR's history.

## Not done, and why
- **No model in runs** (fixed rules only). That keeps `[INFERENCE - local LLM]` and the bridge's own review as a separate step.
- **No server push.** Pages poll.
- **No second user.** Roles are shown, not edited.
- **No live network test of the fetcher.** The cloud sandbox has no outbound network. The fetcher's refusal rules are unit-tested, and the cloner is tested through a stub fetch and pasted HTML; the real request is checked on the laptop.

## Checks run (2026-11-04)

| Check | Result |
| --- | --- |
| `node scripts/skillspector-audit.mjs --strict .` | 0 critical, 0 high (exit 0) |
| `node audits/verify-contrast.mjs` on OMEGA files | byte-identical to before |
| `node audits/verify-contrast.mjs` on Jarvis tokens, app, `/design` | all pairs pass |
| `contrast.py --apca 60` | 118 pass |
| `node jarvis/server/test/test-server.mjs` (SQLite and PostgreSQL 16) | 112 passed |
| `node jarvis/scripts/test-app.mjs` (sample mode) | 46 passed |
| `node jarvis/scripts/test-live.mjs` (live server) | 33 passed |
| `node scripts/ui-three-sizes.mjs`: 10 sample routes + `/design` | 99 / 99 |
| `node scripts/ui-three-sizes.mjs`: 8 live routes | 72 / 72 |
| Unit tests: replica-design, replica-diff, replica-entrepreneur | 17, 7, 3 |
| `node scripts/test-knowledge.mjs` after the rebuild | 19 passed |

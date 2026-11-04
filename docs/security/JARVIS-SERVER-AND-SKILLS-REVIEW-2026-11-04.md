# Security review: Jarvis local server, replica-backend, replica-entrepreneur, pg@8.23.0 (ADR-134)

Date: 2026-11-04 · Reviewer: Claude Code, cloud sandbox. Asked by Ahmad on 2026-11-04: «أضف مهارة replica-backend (ومهارة replica-entrepreneur إن أمكن) … بعد كتابة مراجعتها الأمنية» and «ابْنِ الخادم المحلي الخفيف واربِطه بـ schema.sql». This is his standing rule (AGENTS.md §1): no third-party skill, dependency or service without his approval **and** a written security review.

## 1. The two skills

Both come from [Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill) at `77c9436` (MIT; a copy of the licence is in each folder). Each was read in full in a scratch clone first.

| File | Status | SHA-256 (first 16) |
|---|---|---|
| replica-backend/SKILL.md | upstream + "In giant-core" section | 6cd20c2626c0f760 |
| replica-entrepreneur/SKILL.md | upstream + "In giant-core" section | 9349a4a25f792df3 |
| replica-entrepreneur/reviews.py | upstream, byte-identical | 4e48d770727d6229 |
| replica-entrepreneur/themes.json | upstream, byte-identical | 008d337c9dd3c33a |
| replica-entrepreneur/tests/test_reviews.py | new, written here | 78b008e2ac3b5ea2 |

**`replica-backend`** is text rules only.

- **Upstream.** It plans Stripe payments, outbound email and hosted services.
- **The giant-core section** locks payments and every outward action (AGENTS.md §1), puts local Postgres and SQLite first, and allows only dependencies the repo already pins.

**`reviews.py`**

- **Imports:** `argparse csv datetime json os re sys`.
- **No** network, processes, `eval`, `exec` or `pickle`.
- **Reads** the CSV and themes file it is given; **writes** only `--out`.
- **Drops** every row without an `http(s)` link and never invents a quote: each quote is a substring of a supplied row.

**The giant-core section** adds the repo's honesty rules: keyless public sources only, the proxy for any live fetch, and `[INFERENCE]` on themes.

**Results.** SkillSpector `--strict` on both folders: 0 critical, 0 high. Tests: 3 of 3.

## 2. The dependency: pg@8.23.0

`web/package.json` already pins this exact version. `jarvis/server/package-lock.json` locks 14 packages, all with sha512 integrity:

- pg 8.23.0
- pg-pool 3.14.0
- pg-protocol 1.16.1
- pg-types 2.2.0
- pg-connection-string 2.14.1
- pg-cloudflare 1.4.1
- pgpass 1.0.5
- pg-int8 1.0.1
- postgres-array 2.0.0
- postgres-bytea 1.0.1
- postgres-date 1.0.7
- postgres-interval 1.2.0
- split2 4.2.0
- xtend 4.0.2

**Licences:** all MIT or ISC.

**Installed packages:**

- none has an install, preinstall or postinstall script;
- a search of their `.js` files finds no `child_process`, `eval(` or `new Function`.

**Install** with `npm ci --ignore-scripts` in `jarvis/server`. **It is only needed for Postgres mode**: the default mode uses Node's built-in `node:sqlite` and installs nothing.

## 3. The server (written here)

| File | SHA-256 (first 16) |
|---|---|
| jarvis/server/server.mjs | 384b34afb2716f8d |
| jarvis/server/lib/db.mjs | 224d1126d5cb1395 |
| jarvis/server/lib/store.mjs | 2ff93f7c9f143e0d |
| jarvis/server/lib/runner.mjs | 70fd32b8468d958a |
| jarvis/server/lib/fetch-public.mjs | ffcb269a26194892 |
| jarvis/server/lib/clean-clone.mjs | 0fc7bd66378b5684 |
| jarvis/server/lib/schema-sqlite.sql | d2967f2c07418c7c |

### What it exposes

**One HTTP listener on `127.0.0.1`** (default port 8798). It serves `jarvis/app/index.html`, `jarvis/design/index.html` and a JSON API. No other file is served.

### Guards

Each guard below is tested in `jarvis/server/test/test-server.mjs`, on SQLite and PostgreSQL 16.

- **DNS rebinding.** The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`; anything else gets 421.
- **Cross-site writes.**
  - Every write needs the `X-Jarvis: 1` header, which a plain HTML form cannot send.
  - An `Origin`, when present, must be this server.
  - Bodies must be JSON.
  - No CORS headers are ever sent, so no other origin can read a response.
- **Size.** Bodies are capped at 64 KB (2.5 MB for pasted HTML).
- **Database.**
  - It must be local (`127.0.0.1`, `::1` or a Unix socket). A remote `DATABASE_URL` is refused before connecting.
  - Every query is scoped to one workspace.
- **The rules live in the schema**, so no API path or SQL client can skip them:
  - `approvals_locked_never_approved` (money, publish, permissions, install, outbound);
  - `approvals_decided_by_member`;
  - `approvals_reject_has_reason`;
  - `runs_one_active_per_agent`;
  - the append-only `events` table.
- **Tools**, run for real in `runner.mjs`:
  - **files.read** reads only under `docs/`, `jarvis/replica/` and the workspace's notes folder. Symlinks are resolved before the check.
  - **git.log** reads the `.git/logs/HEAD` file; no process is started.
  - **web.read** uses the public-page fetcher below.
  - **notes.write** never writes during a run. It creates a `file_write` approval, and the note is written only after a person approves it, and only inside the workspace's notes folder (`flag: "wx"`, never overwriting).
  - **Path escapes are refused.** `../../etc/passwd`, `/etc/hosts`, `docs/../.git/config` and `jarvis/server/server.mjs` are all refused (tested).
- **Public-page fetcher** (`fetch-public.mjs`), used by the Studio cloner and `web.read`:
  - one GET, `http(s)` only, ports 80 and 443 only, no credentials in the URL;
  - no cookies, an honest user agent, no anti-bot bypass;
  - `robots.txt` is read and obeyed;
  - at most 3 redirects, each checked again; 2 MB; 10 s; `text/html` only.
  - Private, loopback, link-local, CGNAT and reserved addresses (IPv4, IPv6 and IPv4-mapped) are refused inside the socket's own DNS `lookup`, so a name cannot switch to a private address between check and connect.
- **Clean-room cloner** (`clean-clone.mjs`):
  - It parses the HTML as text and never runs it. Scripts, styles, frames and images are dropped and counted.
  - It keeps only the layout shape: section order, card counts, nav link count, table size.
  - All output text is fixed Jarvis copy, and a sweep checks for brand terms and source phrases.

### What it never does

It never moves money, publishes, changes repository permissions, installs a skill or sends a message. Those exist only as approval rows that the database refuses to approve.

### SkillSpector `--strict` on `jarvis/server`

**0 critical, 0 high.** The mediums are reading `process.env` for the port, mode, data folder and database URL, and test-only `http://` fixtures. These are expected and contain no secrets.

## Verdict

**Pass** for all three: the two skills, the dependency, and the server.

**Conditions:**

- `DATABASE_URL` comes from the dotenvx-encrypted env file, never from git.
- Opening the server to the LAN or the internet needs a new review.
- Wiring in a model (the loopback Ollama bridge) needs a new review of its prompt and output handling.

# Security review: Jarvis platform features (ADR-137)

Date: 2026-11-05 · Reviewer: Claude Code, cloud sandbox.

ADR-137 opens three new kinds of surface in `jarvis/server`:
- an endpoint that local tools can post to (incoming webhooks);
- requests the server sends on its own (outgoing webhooks, scheduled runs);
- a long-lived stream (server-sent events).

It also adds data about money (draft subscriber plans, a token ledger). AGENTS.md §1 and §4 apply.

**What is not added:**
- no dependency;
- nothing under `.claude/skills/`;
- no new outbound host.

## Scope

| File | Role |
|---|---|
| `jarvis/server/lib/platform.mjs` | Workflows, members, schedules, webhooks, creator mode, plans, ledger, analytics |
| `jarvis/server/lib/workflow-graph.mjs` | Pure graph rules (Kahn's sort, locks), shared with the page |
| `jarvis/server/server.mjs` | Routes, `POST /api/hooks/:id`, `GET /api/w/:slug/stream`, the 30-second schedule timer |
| `jarvis/replica/schema.sql`, `jarvis/server/lib/schema-sqlite.sql` | Six tables, one index, the constraints and triggers below |
| `jarvis/app/src/app.js`, `i18n-ar.json` | Pages, Arabic dictionary, `MutationObserver` translator |

## Controls

### 1. Incoming webhooks (`POST /api/hooks/:id`)

- **Host.** The `Host` check still applies, and the server binds 127.0.0.1 only.
- **Browsers.** A request with an `Origin` header is refused, so no web page can post to a hook.
- **Body.** JSON only, 64 KB cap.
- **Signature.** `X-Jarvis-Signature: sha256=<hex>` must be the HMAC-SHA256 of the exact body, compared with `timingSafeEqual`. A missing or wrong signature, or a hook that is not active, gets 401.
- **Record.** Every delivery is logged with the body's SHA-256, never the body itself. The `webhook_deliveries` table is append-only, by trigger on both engines.

**Secrets.**
- Each hook's secret is the HMAC-SHA256 of its id under a 32-byte master key. The key sits in `jarvis/server/.data/webhook-master.key` (mode 0600), and `.data/` is gitignored.
- No secret is stored in the database, git or the browser.
- Sample mode (`file://`) has no webhooks at all, so no secret ever reaches `localStorage`.

**Test.** A signed delivery is verified. A wrong signature, a missing signature, a draft hook and a browser `Origin` are all refused.

### 2. Outgoing webhooks

- **Where they may go.** An outgoing hook may be active only towards `http://127.0.0.1:<port>/…`.
  - The server checks this with `URL` parsing: `127.0.0.1.evil.com`, `localhost` and `https` do not count.
  - The database checks it again with `webhooks_external_out_locked`, using a regex on PostgreSQL and `substr`/`glob` on SQLite.
- **An outside address** becomes a locked `outbound` approval, which `approvals_locked_never_approved` refuses.
  - Test: the API answers 403.
  - Test: `update webhooks set status = 'active'` is refused for both an outside URL and a look-alike host.
- **Sends** are signed and use `redirect: "error"` and a 5-second timeout. Only finished-mission events and the manual test event are sent.

### 3. Money (creator mode and plans)

- **`billing_settings_billing_locked`.** Billing can never be switched on in Jarvis.
- **`subscriber_tiers_draft_only`.** A plan is always a draft; its price is a number, never charged.
- **`token_ledger_creator_free`.** The creator's usage always costs 0. The ledger is append-only.
- **Asking.** "Turn on billing" and "Activate plan" create locked `money` approvals.
- **Tests:** each of these is tried in SQL and refused; the API approval is refused (403).
- **Token counts** are estimates (characters ÷ 4) and are labelled `[INFERENCE]`.

### 4. Members

- Adding a member creates a local row only. **No email is sent**: invitations are outbound messages, which stay locked.
- The owner cannot be demoted or removed. A second owner is refused by the unique index `members_one_owner` (tested).
- Repository permissions are not touched; they remain a locked approval.

### 5. Workflows

- A graph is checked on both sides with the same code (`workflow-graph.mjs`):
  - ids, at most 30 nodes;
  - tools only from the four read tools, checks only from the four gates;
  - a cycle is refused, naming the steps involved (Kahn's sort).
- **Running** a graph builds a mission through `createFromPlan`, which re-checks every step.
- **Locks:** a node is locked when its kind is a locked approval, **or** when its title mentions money, publishing, permissions, installs or outbound messages. A step "drawn as a tool" but titled "Email the team" is locked (tested). `mission_steps_locked_never_done` remains the last line.

### 6. Scheduled runs

- The interval is 5 minutes to 7 days (a check constraint).
- The timer starts only the agent's fixed-rule run, through the same runner, so the same tool and path checks apply.
- A busy agent is skipped and the reason is stored.
- Nothing is scheduled to run outside 127.0.0.1.

### 7. Live stream (`GET /api/w/:slug/stream`)

- **GET only**, same Host check, at most 20 streams at once.
- **Content.** It sends only the workspace's change marker, never data. The page then reads data through the normal routes.
- **Page side.** `EventSource` is covered by the page's `connect-src 'self'`.

### 8. Arabic translation

- **Text only.** The translator changes text nodes and three attributes (`aria-label`, `placeholder`, `title`), and nothing else.
- **No new channel.** The dictionary is build-time JSON inside the page's existing `application/json` data block. Translations are plain strings set with `nodeValue` or `setAttribute`, so there is no HTML path.
- **Data stays as written.** Data under `translate="no"`, code and `.mono` is skipped, for example skill descriptions read from `SKILL.md`.

## Results

| Check | Result |
|---|---|
| Server tests (SQLite and PostgreSQL 16) | see ADR-137 |
| `node scripts/skillspector-audit.mjs --strict .` | 0 critical, 0 high |
| Flow tests (sample and live) | every webhook, lock and Arabic check passes; see ADR-137 |

## Residual risks

- **Other local processes.** Any process on this computer that has a hook's secret can post to that hook. That is the purpose of the secret; keep it out of git and chats (the page says so).
- **The master key.** Anyone who can read `jarvis/server/.data/` can derive every hook secret. That folder already holds the database.
- **Keyword locks** over-lock. A person can skip a locked step; skipping approves nothing.

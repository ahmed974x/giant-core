# Security review: founder gate, locked access mode and locked hosted endpoints (ADR-141)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked for Jarvis to be his alone while he tries it, on this computer or on the internet. He wants:
- a key-based gate built on `node:crypto`;
- an access mode that cannot be switched to public without an approval;
- the hosted-endpoint locked card offered in ADR-140;
- a Caddyfile and a `render.yaml`.

All of it is new code with no dependency.

## Scope

| File | Role |
|---|---|
| `jarvis/server/lib/founder-gate.mjs` | Key stretching, login with lockout, signed session cookie, public-host pin, sign-in page |
| `jarvis/server/lib/access.mjs` | Access mode (status, locked request), hosted endpoints (draft, locked request, refused activation) |
| `jarvis/server/server.mjs` | Gate on every route; Host and Origin lists from the gate; `/login`, `/api/founder/*`, `/api/access`, `/api/w/:slug/model-endpoints` |
| `schema-sqlite.sql`, `jarvis/replica/schema.sql` | `access_settings` with `access_settings_founder_private_locked`; `model_endpoints` with `model_endpoints_external_locked` |
| `jarvis/app/src/app.js` | Settings: Access panel, Hosted model endpoints panel |
| `jarvis/deploy/Caddyfile`, `jarvis/deploy/README.md` | HTTPS in front of 127.0.0.1:8798 on the same machine |

## How the gate holds

1. **Key handling.**
   - The key comes from `JARVIS_FOUNDER_KEY`, at least 12 characters. It is never written anywhere.
   - At start it is stretched with scrypt (N 2^15, r 8, p 1) under a fresh random salt.
   - A login stretches the typed key the same way and compares with `timingSafeEqual`.
2. **Sessions.**
   - A session is `expiry.nonce.HMAC-SHA256(expiry.nonce)`, signed with a random 32-byte secret per start. Changing the expiry or the signature is refused; both are tested.
   - The cookie is `HttpOnly; SameSite=Strict; Path=/`, valid for 12 hours, and `Secure` when the request came through the proxy over HTTPS.
3. **Brute force.** Five wrong keys from one address in ten minutes means 429 until the window passes, even for the right key; this is tested.
4. **Scope of the gate.**
   - With the gate on, every page redirects to `/login` and every API route answers 401 without a session. This is tested for the workspaces, agents, model and search routes.
   - The only open paths are `/login`, `/api/founder/{status,login,logout}` and `/api/hooks/*`. Webhooks keep their own HMAC-SHA256 signature from ADR-137.
5. **Host and Origin.**
   - The server still binds 127.0.0.1.
   - `JARVIS_PUBLIC_HOST` adds exactly one public name to the accepted Host list, and `https://<name>` to the accepted Origins. It is refused at start without a founder key, so a public name is never served without the gate.
   - Any other Host gets 421, and a cross-origin write gets 403 even with a session; both are tested with raw requests, because `fetch` drops a custom Host header.
6. **The sign-in page.**
   - It has its own CSP: `default-src 'none'`, with one script and one style pinned by SHA-256.
   - The key field is `type=password` with `autocomplete=current-password`.
   - It is bilingual.

## The locks

- **Access mode.**
  - `access_settings.mode` can only be `founder_private`; the SQL constraint is tested on SQLite and PostgreSQL 16.
  - `PATCH /api/access` asking for anything else answers 403 and records a locked `publish` approval. The page's "Open to the public…" records the same card, with a 202.
  - The card cannot be approved inside Jarvis (`approvals_locked_never_approved`).
- **Hosted endpoints.**
  - `POST /api/w/:slug/model-endpoints` accepts only `https://` on a public name, with no credentials, query or private address.
  - It stores a `draft` and a locked `outbound` approval that names the host. `/activate` answers 403.
  - `model_endpoints.status` can only be `draft`.
  - The model bridge never reads this table; a test checks it still talks to 127.0.0.1.

## Deployment files

- **`Caddyfile`:** Caddy on the same machine terminates HTTPS (Let's Encrypt) and proxies to `127.0.0.1:8798`. It sets HSTS, `nosniff` and `no-referrer`.
- **`render.yaml`:** not added. Hosted platforms need the app to listen on `0.0.0.0`, which AGENTS.md §4 forbids, and putting Jarvis on the internet is a publish action for Director 00.

## Limits, said plainly

- **One key.** There is one founder key and no second factor; a TOTP code would be a separate change. Anyone who has the key is the founder.
- **Lockout is per address.** It is kept in memory and counted per client address (as Caddy reports it), so a restart clears it.
- **No identity layer.** Members and roles inside Jarvis (ADR-137) still describe workspace roles, not sign-in identities.

## Checks

| Check | Result |
|---|---|
| `node jarvis/server/test/test-server.mjs` (SQLite + PostgreSQL 16) | see `jarvis/replica/evidence/tests-server.log` |
| `node jarvis/scripts/test-app.mjs` F19, `test-live.mjs` | see `tests-app.log`, `tests-live.log` |
| `node scripts/skillspector-audit.mjs --strict .` | 0 critical, 0 high |

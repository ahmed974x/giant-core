# ADR-141: Founder-only gate, locked access mode and locked hosted model endpoints

Date: 2026-11-06 · Status: Proposed. Ahmad's messages of 2026-11-06 asked:
- that Jarvis work for him alone first, locally or on the internet;
- that opening it to the public, and any hosted model endpoint, be a locked violet approval refused by the API and the database;
- for a Caddyfile and a `render.yaml` to run it behind HTTPS.

## Decision

1. **`founder-gate.mjs`:**
   - The key comes from `JARVIS_FOUNDER_KEY`. It is stretched with scrypt and checked with `timingSafeEqual`.
   - Sessions are HMAC-SHA256 signed cookies (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS, 12 hours).
   - Five wrong keys in ten minutes lock that address for the window.
   - There is a bilingual `/login` page with a hash-pinned CSP.
   - Without the key, Jarvis answers on 127.0.0.1 as before. With it, every page and API route needs the session; webhooks keep their HMAC.
2. **`JARVIS_PUBLIC_HOST`** lets Caddy on the same machine reach Jarvis, which still binds 127.0.0.1. It is refused without the founder key.
3. **`access_settings`** holds the access mode. `access_settings_founder_private_locked` keeps it `founder_private`.
   - `PATCH /api/access` to anything else answers 403.
   - Asking (Settings → Access → "Open to the public…") records a locked `publish` card.
4. **`model_endpoints`** holds hosted endpoints. `model_endpoints_external_locked` keeps every row a `draft`.
   - Settings → "Hosted model endpoints" accepts a public `https://` address and records a locked `outbound` card that names the host.
   - `/activate` answers 403. The model bridge still talks to 127.0.0.1 only.
5. **`jarvis/deploy/Caddyfile`** and its README describe HTTPS on a server Ahmad controls. A `render.yaml` is not added: hosted platforms require a `0.0.0.0` bind (AGENTS.md §4), and going public is Director 00's publish decision.

Review: `docs/security/JARVIS-FOUNDER-GATE-REVIEW-2026-11-06.md`.

## Consequences

- Ahmad can try Jarvis on a public address with only himself able to enter, and nothing about that changes the database's founder-only mode.
- One shared key, no second factor yet; a restart signs him out.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Server tests** on SQLite and PostgreSQL 16;
- **Flow tests:** `test-app.mjs` F19 and `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/settings`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.

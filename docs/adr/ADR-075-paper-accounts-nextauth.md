# ADR-075: User accounts for the paper platform (NextAuth), briefing email placeholder

Date: 2026-10-16 · Status: Proposed (branch feat/paper-trading-mvp, not merged, not deployed)

## Context
Ahmad (2026-10-16 00:23Z) chose a "global SaaS tool" direction: users from any country sign up, get signals, and
would execute in their own broker accounts; OMEGA never touches their money. Until a lawyer approves that structure
in writing, everything stays paper only: no real keys, no real orders, no broker or B3 connection. He asked for user
sign-up and profiles now, NextAuth or Clerk, and a daily briefing email to a project address he will create.

## Decision
- **NextAuth 4.24.15** (open source, MIT), not Clerk (paid third-party service, no account opened). OAuth only
  (GitHub, Google), JWT session cookies, no user database, no passwords. Provider ids/secrets and
  `NEXTAUTH_SECRET` are placeholders in `web/.env.example`; real values only in the encrypted `web/.env.local`.
  Accounts stay **off** until a 32+ character secret and at least one provider are set.
- **Who is asking** (`access()` in `web/src/lib/accounts.ts`), used by `/api/paper` and `/api/paper/proposals`:
  the right PIN = the owner, whose data stays where it was; a signed-in user = an isolated folder
  `<data>/users/<key>/paper/` with their own paper account and proposal queue; anyone else = 401. Cross-site
  requests = 403. The folder key is a salted SHA-256 of provider + account id; the raw id, email, name and picture
  are never stored.
- **Profile** (`/[locale]/account`, `/api/profile`, signed-in users only): display name, two-letter country,
  language. Nothing else.
- **Briefing email** (`web/src/lib/mailer.ts`): works out the message and reports why it would not send; there is
  no transport. It needs `BRIEFING_EMAIL_TO` (the project address, not Ahmad's personal one), a sender, and
  `BRIEFING_EMAIL_APPROVED=yes` after Ahmad approves a test send; sending code is added only then.
- Not deployed or exposed: the web app still listens on 127.0.0.1 behind Tailscale + PIN (ADR-063).

## Consequences
- Tests prove unauthenticated, wrong-PIN, empty-PIN, accounts-off and malformed-key requests are refused, that the
  owner and each user get separate folders, and that every paper/profile handler checks access.
- The daily scan (ADR-074) still runs for the owner only; per-user scans wait until accounts are switched on.
- Lawyer questions for the SaaS model are listed in `docs/ROADMAP-BRAZIL.md` section 4.
- Undo: leave the auth variables empty (accounts off); delete `<data>/users/`.

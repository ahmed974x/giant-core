# ADR-069: Remote access through Cloudflare Tunnel + Access + TOTP (planned)

Date: 2026-10-15 · Status: Proposed (step list ready; nothing executed until Ahmad sends the domain name)

## Context
Tailscale (ADR-063) opens the site from Ahmad's own devices only. He wants it from any browser, with only him able
to get in and no inbound port on the home router. He is buying a domain; nabd.eu.org is pending and may be added
later. The repo is public, so the domain, team name and email are written as placeholders here.

## Decision
- `cloudflared` runs on the laptop as a Windows service (outbound-only tunnel `omega-laptop`). The web app keeps
  binding 127.0.0.1:3100; Caddy and Tailscale are unchanged.
- A Cloudflare Access self-hosted app on `omega.<domain>`, policy Allow with Include Emails set to Ahmad's address only.
- Login is an email one-time PIN plus Independent MFA with an authenticator app (TOTP), both at 24 h. Google OAuth
  was dropped because it needs a Google Cloud client secret pasted by hand.
- Order: tunnel without a route, then Access, then TOTP, and the published-application route last, so the hostname
  is never reachable without the lock.
- Zero Trust Free plan only. If Independent MFA is not offered on Free, stop: no paid upgrade.
- Step list: `docs/CLOUDFLARE-SETUP-AR.md` (Arabic).

## Consequences
- Until Windows sign-in after a reboot, the URL returns 502: cloudflared starts at boot, the web app at sign-in
  (ADR-064). Accepted.
- Requests arriving over the LAN or Tailscale do not pass through Access, by design.
- Rollback: delete the tunnel route; the hostname is closed immediately.

## Rejected
- Router port forward (exposes the laptop), `trycloudflare.com` quick tunnel and Tailscale Funnel (public, no login),
  any paid Cloudflare plan.

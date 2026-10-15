# ADR-063: Phone access over Tailscale (tailnet only)

Date: 2026-10-15 · Status: Accepted (verified on the phone 2026-10-15)

## Context
Ahmad wants to open the OMEGA site from his phone away from home (4G), not only on home Wi-Fi.
The existing Caddy setup (ops/caddy) only serves the LAN on https://<lan-ip>:8443 with a local CA that
the phone must trust. Opening a port on the router or exposing the site publicly is not acceptable.

## Decision
- Tailscale 1.104.1 on the laptop, signed in with Ahmad's Google account; the phone joins the same tailnet.
- `tailscale serve` publishes https://<laptop>.<tailnet>.ts.net -> http://127.0.0.1:3100,
  tailnet only. Tailscale issues a real Let's Encrypt certificate for the ts.net name, so the phone
  needs no custom CA.
- Funnel stays OFF: nobody outside the tailnet can reach the site.
- The web app keeps binding to 127.0.0.1 only; Caddy keeps serving the LAN path unchanged. Tailscale
  does not go through Caddy, so a Caddy outage does not break remote access (and vice versa).
- No repo code changes; Serve config lives in the Tailscale client, not in git.

## Verification (2026-10-15)
- `tailscale serve status`: `https://<laptop>.<tailnet>.ts.net (tailnet only) |-- / proxy http://127.0.0.1:3100`
- From the laptop: `/ar` -> 200, `ssl_verify_result=0`, `<title>القيادة</title>`, `dir="rtl"`.
- Caddy (ops/caddy/start-https.ps1): `https://localhost:8443/ar` -> 200.
- iPhone joined the tailnet; Ahmad opened the URL on it and the page loaded.

## Known gap (fixed by ADR-064)
Phoenix exited with code 1 on every run while Docker/Postgres was down, so it did not restart the web app or Caddy
after a reboot. ADR-064 fixes it.

## Rejected
- Port forwarding on the router: exposes the laptop to the internet.
- Tailscale Funnel: public URL; not needed for a single user.
- Cloudflare Tunnel: next step in the plan (with TOTP), decided separately.

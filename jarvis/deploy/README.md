# Running Jarvis for the founder only (ADR-141)

Jarvis is founder-only until Director 00 decides otherwise. The access mode in the database is `founder_private`, and the database refuses any other value. Asking to open Jarvis to the public makes a locked «قيد الموافقة» card.

## On this computer

```bash
node --disable-warning=ExperimentalWarning jarvis/server/server.mjs
```

This answers on `http://127.0.0.1:8798` only, for the person at this machine.

To require the key here too:

```bash
JARVIS_FOUNDER_KEY='<a long secret>' node --disable-warning=ExperimentalWarning jarvis/server/server.mjs
```

## On a server you control, over HTTPS

1. Install Caddy on the same machine as Jarvis.
2. Edit `jarvis/deploy/Caddyfile` with your DNS name.
3. Start Jarvis with `JARVIS_FOUNDER_KEY` and `JARVIS_PUBLIC_HOST`, as the Caddyfile says. Jarvis keeps binding `127.0.0.1`; only Caddy listens on 80 and 443.

What the gate does:
- Every page and API call needs the founder session. The sign-in page is at `/login`.
- The key is stretched with scrypt and compared with `timingSafeEqual`. It is never stored.
- The session cookie is HMAC-SHA256 signed: `HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS, valid for 12 hours.
- Five wrong keys in ten minutes lock that address for the rest of the window.
- A restart signs everyone out.

Not included: a hosted-platform file such as `render.yaml`. Those platforms need the app itself to listen on `0.0.0.0`, which AGENTS.md §4 does not allow (local services bind to 127.0.0.1). Putting Jarvis on the internet is also a publish action for Director 00.

# ADR-094: Local server short addresses, same-origin proxy and the file:// hint

Date: 2026-10-20 · Status: Accepted (Ahmad's Phase 8 directive in the project thread, 2026-10-20)

## Context
ADR-093 made `scripts/omega-data-proxy.mjs` serve the pages, but the addresses were long (`/omega-ops-room-v1/omega-ops-room.html`), both pages hard-coded `http://127.0.0.1:8796` for data, and a copy opened by double-click from disk gave no hint that the server exists. Ahmad asked for one server on port 8796 for all three pages, reachable from the laptop and from the iPhone, with a redirect when a page is opened from `file://`.

## Decision
1. **Short addresses.** `/omega-ops-room.html`, `/the-chain.html`, `/index.html` and `/en.html` answer 302 to the folder copies and keep the query string. The pages stay inside their folders, so relative links, the manifest and (later) the service worker keep one scope per folder.
2. **Bind address.** Still `127.0.0.1` by default (AGENTS.md §4). `--lan` or `OMEGA_BIND=lan` is an explicit opt-in that listens on `0.0.0.0` and prints the home-network addresses with a warning that anyone on that Wi-Fi can open the pages and the read-only data routes. The proxy stays GET-only with the same upstream allowlist, so `--lan` adds no write path.
3. **Same origin.** A page the proxy served itself (same `Host`, over http or https, for example the iPhone over `--lan` or Tailscale Serve) is allowed as same-origin. Other origins still get 403. Both pages now look for the proxy at `location.origin` first, then at `http://127.0.0.1:8796`, and use whichever answers `/health` with `{"ok":true}`. THE CHAIN adds `'self'` to `connect-src`.
4. **file:// hint.** A page opened from disk shows a status line with a link to the same page on `127.0.0.1:8796` (query and hash kept). If the proxy answers and this disk copy holds no paper wallet, receipts or notes, the page moves itself with `location.replace`. If the copy holds data it stays put and says to export a capsule (Ops Room) or the notes (THE CHAIN) first, because `file://` and `http://127.0.0.1` have separate storage.
5. **SEC contact without git.** `OMEGA_SEC_UA` falls back to the first line of `~/.omega/sec-ua.txt`, so the contact e-mail lives on the laptop, not in the repository.
6. A port already in use prints a plain message instead of a stack trace.

## Consequences
- `http://127.0.0.1:8796/omega-ops-room.html` works as Ahmad wrote it.
- Plain `http://` over the LAN is not a secure context, so WebCrypto is unavailable there; the vault and the capsule need 127.0.0.1, `file://` or Tailscale HTTPS.
- Tested in the sandbox with Playwright: a clean `file://` copy moved to the server, a copy with receipts stayed and showed the export hint, a foreign Origin got 403, `..` and dotfiles got 404.

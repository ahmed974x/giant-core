# Keys Vault

Paste data keys on the phone; the laptop stores them encrypted, keeps the personal Desktop copy, tests them and
answers the phone. ADR-043.

## Use it
1. On the laptop: `cd giant-core/web` then `npm run keys:vault`. It prints a link (or, with `--out <file>`, writes it
   to a file, e.g. to email it to yourself). The link works **once**, for **10 minutes**.
2. On the phone, connected to the home Wi-Fi, open the link: `https://<laptop-ip>:8443/ar/keys-vault?token=…`. The phone
   must trust the OMEGA root certificate (`http://<laptop-ip>:8480/omega-root.crt`, see ops/caddy/README.md).
3. Tap 📋 Paste next to each key (or long-press and paste), enter the PIN, and tap 💾 Save and encrypt.
4. The phone shows ✅ and each key's verdict: WORKING, REJECTED, or COULDN'T CONFIRM. The page wipes itself after
   60 seconds.

## What the laptop does
| Step | Where |
|---|---|
| Encrypts each key into `web/.env.local` with dotenvx | private key outside the project, `%USERPROFILE%\.omega\secrets\web.env.keys` |
| Writes the personal copy Ahmad asked for | `C:\Users\Hp\Desktop\المفاتيح.txt` (plain text, outside Git) |
| Loads the keys into the running site | no restart needed |
| Tests NASA FIRMS and AISStream | live calls to each service |
| Burns the link | a second save with the same link is refused |
| Appends an audit line | `services/director00/data/keys-vault-audit.jsonl`: time, phone IP, key names, verdicts; never values |

## Protection
- The link carries a random 192-bit token. Only its SHA-256 is stored, it expires after 10 minutes, and it works
  once. The PIN is required too (5 wrong tries lock for 15 minutes), and requests must be same-origin.
- HTTPS only: from another device the request must come through Caddy (`X-Forwarded-Proto: https`); plain HTTP from
  the LAN is refused. Only the laptop itself may use `http://127.0.0.1`.
- The page removes the token from the address bar on load, uses password fields, clears the fields the moment you
  tap save, and asks search engines not to index it. The `Referrer-Policy` is `no-referrer`.
- Values never reach a log: server logs are redacted (ADR-042), and the audit log stores names only. After saving,
  the server drops its references to the values. JavaScript cannot zero a string in memory, so this is
  best-effort.
- The commit guard blocks plain `.env` values and key files.

## The Desktop copy
`المفاتيح.txt` is a plain-text file by Ahmad's choice: anyone using the laptop can read it. The encrypted copy in
`web/.env.local` plus the Bitwarden backup of the private key is the safe pair. Deleting the Desktop file loses
nothing.

## Why not the WebSocket on port 3001 from the first sketch
An HTTPS POST through the existing Caddy listener (8443) is encrypted the same way and needs no new port, firewall
rule or certificate. A paste-and-save is a single request, so a persistent socket adds nothing.

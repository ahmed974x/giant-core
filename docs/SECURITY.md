# OMEGA security model

What is exposed, what protects it, and how it is checked. Keep this current when adding a service.

## Exposure
- Every published port binds to `127.0.0.1` (relay 8088, n8n 5678, cortex 8089, studio 5006). Nothing listens on the LAN.
- Only n8n, cortex, ollama (model pulls), agents (GitHub search) and cloud-sync (Supabase) have internet egress;
  timescale and postgrest sit on internal networks with no route out.

## Browser → relay
- The Ops Room is one self-contained file served with a strict CSP (`default-src 'none'`, no external scripts,
  `connect-src 'self'`, `frame-ancestors 'none'`) plus COOP/CORP, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: no-referrer` and a Permissions-Policy that denies camera, mic, location, payment and USB.
- Every browser POST (`/llm/chat`, `/brain/ask`, `/agents/decide`) is same-origin JSON only (a cross-site page
  cannot send it) and rate-limited per client (12, 6 and 30 per minute).
- Model and agent text is always inserted as text, never parsed as HTML; links are allow-listed (`https://github.com/…`).
- Read-only data goes through an allow-list of PostgREST views; ingest endpoints need `OMEGA_RELAY_TOKEN`.

## Secrets
- `.env` is git-ignored; CI fails if a `.env` or a key-shaped string (Anthropic, Supabase secret, GitHub, private key) is committed.

### Web app secrets: dotenvx (ADR-042)
- **What's encrypted.** `web/.env.local` holds the phone PIN, the Postgres URL and the data-feed keys. Every value is
  stored as dotenvx ciphertext (`encrypted:…`, ECIES on secp256k1 with AES-256-GCM). The file alone reveals nothing.
- **Where the private key lives.** `%USERPROFILE%\.omega\secrets\web.env.keys`, outside the project. You can point
  `OMEGA_ENV_KEYS` somewhere else. A second copy belongs in Bitwarden: open the file, copy the
  `DOTENV_PRIVATE_KEY_LOCAL=` line into a Bitwarden secure note named "OMEGA web private key", then close the file.
  Never paste it into chat, a ticket or a commit.
- **How the app gets its values.** `npm run dev | build | start` all go through `web/scripts/secure-run.mjs`, which
  runs dotenvx with the outside key file. Values are decrypted into the server process's memory only. Phoenix
  restarts the site the same way.
- **Adding or changing a key.** `npm run secrets:set NASA_FIRMS_KEY` asks for the value at a hidden prompt and stores
  it encrypted. Alternatively, type it into `.env.local` and run `npm run secrets:encrypt`. Then, on the phone, open
  Review, then Data keys, and tap Load and test keys; no restart is needed.
- **Startup check** (`web/src/lib/security/check-secrets.ts`, run from `instrumentation.ts`). The server refuses to
  start unless all of these hold:
  - every value in `.env.local` is encrypted;
  - every value is decrypted in memory;
  - the private key file exists outside the project;
  - Git ignores and does not track `.env.local` or any `.env.keys`;
  - no tracked file contains a live secret value.

  `npm run secrets:check` runs the same check by hand. `OMEGA_SECRETS_CHECK=report` (the end-to-end tests) logs
  without stopping. `off` is for emergencies only.
- **Logs.** `web/src/lib/logger.ts` routes every server `console` call through redaction. It hides the live values of
  secret-named variables (KEY, TOKEN, SECRET, PASSWORD, PIN, DB_URL and similar), the password inside any URL,
  Bearer and Basic headers, `x-api-key` and PIN parameters, JWTs, provider-prefixed keys and dotenvx ciphertext. Each
  one becomes `[REDACTED]`.
- **Commits.** `.githooks/pre-commit`, enabled with `git config core.hooksPath .githooks`, blocks any staged
  `.env.keys` file and any staged `.env*` file with a plain value. `.env.example` templates may carry settings but
  no secret-named values.

### If a key is lost or exposed
- **The private key is lost** (laptop wiped, file deleted). Restore `web.env.keys` from the Bitwarden note to
  `%USERPROFILE%\.omega\secrets\`. If there is no copy, the encrypted values can't be recovered; recreate them as
  follows:
  - **PIN:** choose a new one.
  - **`DIRECTOR_DB_URL`:** rebuild it from `DIRECTOR_DB_PASSWORD` in `giant-core/.env`.
  - **Feed keys:** get them again from the providers.

  Then run `npm run secrets:set …` for each one.
- **The private key leaked** (pasted somewhere, file copied off the laptop):
  1. Create a new key pair. Run `npx dotenvx rotate -f .env.local -fk <key file>` from `web/`, or decrypt and
     re-encrypt with a new key file.
  2. Change the PIN and the Postgres password (`ALTER USER omega_director PASSWORD …`, then update both env files).
  3. Regenerate every provider key at its site.
  4. Update the Bitwarden note.
- **A provider key leaked:** revoke it at the provider, create a new one, and store it with `npm run secrets:set`.
  Old copies in logs are already `[REDACTED]`.
- **The PIN leaked:** set a new one with `npm run secrets:set DIRECTOR_WEB_PIN`, then tap Load and test keys, or
  restart. Wrong-PIN attempts are throttled to 5 per 15 minutes.
- The Cortex gateway token stays inside the relay and the agents service; the browser never sees it.
- Supabase: the secret key is only in `.env` for cloud-sync; tables use RLS (signed-in read, no client writes).

## Containers
- `cap_drop: ALL`, `no-new-privileges`, read-only root filesystems where possible, non-root users,
  `mem_limit` + `cpus` + `pids_limit` on every service, log rotation.

## AI agents
- The Brain and the Scout propose; they never edit code, install packages or change settings.
- Brain requests are capped at 4,000 characters, 3 queued jobs and one pipeline at a time.

## Code quality gate
- `scripts/quality.sh` (and the CircleCI `quality` job): **Ruff** for Python (lint, imports, bandit security rules) and **Biome** for JS/TS (lint, security rules), plus a committed-secrets scan and plugin-registry validation.
- Findings from the first pass were fixed: URL opens reject non-http(s) schemes, DuckDB SQL identifiers are allow-listed, the plugin sandbox subprocess is documented, and the relay's deliberate control-char input filter is annotated rather than removed.

## Checks
- CircleCI: the quality gate, all test suites, `npm audit --audit-level=high`, committed-secrets scan, compose validation.
- Windows Defender scan of the project folder: clean on 2026-10-09.

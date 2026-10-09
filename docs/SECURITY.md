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

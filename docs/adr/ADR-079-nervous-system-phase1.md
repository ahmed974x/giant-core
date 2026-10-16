# ADR-079: Agents phase 1: the nervous system (event log, registry, tool gateway, queues) and Valkey

Date: 2026-10-16 · Status: Proposed (draft PR, not merged)

## Context
Ahmad approved phase 1 of the agent design (ADR-077) on 2026-10-16 ("موافق اكمله"). Phase 1 needs no LLM and no
keys: it builds the wiring every later agent uses.

## Decision
- `db/init/05-nerve.sh` adds schema `nerve` to the existing Timescale/Postgres (no new server):
  - `nerve.events`: append-only (update, delete and truncate refused by triggers) and hash-chained: each row stores
    `sha256(previous hash | row)`, with the id taken under one advisory lock so id order is chain order.
    `nerve.verify_chain(n)` recomputes the last n rows (or all) and names the first broken row.
  - `nerve.agents`: the ten Agent Cards from ADR-077. A row without the Arabic and English AI disclosure is refused
    (ADR-076). Toolbelts may only hold registered tools; a sole-holder tool (proposals.add → فهد, memory.write → أمين,
    agents.pause → حارس, vault.reconcile → خازن) cannot be given to anyone else.
  - `nerve.tools`: a constraint refuses any tool named approve, fill, order, withdraw, transfer, sign, execute, trade,
    wallet_key or custody, so a money-moving tool cannot even be registered (ADR-073).
  - `nerve.tool_call()`: the gateway. Refuses unknown tools, tools outside the toolbelt, paused agents, and tainted
    input driving a write tool; every allow and refusal is an event.
  - `nerve.send / read / ack / expire`: one queue per agent with a visibility timeout (at-least-once), `SKIP LOCKED`,
    `pg_notify('nerve_<agent>')` to wake workers, and an archive with the outcome. A message is never more trusted
    than its sender. Same semantics as pgmq without installing an extension in the Timescale image.
  - `nerve.pause_agent` (حارس or the owner) and `nerve.resume_agent` (owner only).
  - Role `nerve_agent`: execute on the agent functions only; no table access; cannot resume, cannot write or send
    as the owner or system, cannot claim owner/system trust.
  - `api.nerve_agents`, `api.nerve_events`, `api.nerve_chain` for the Ops Room (read-only, via the relay allowlist).
- Ops Room: a "Nervous system" block in the Agents panel: chain status, the ten agents (red when paused, disclosure
  on hover), the last 8 events (guard events in red). Demo data with `?demo`.
- Redis 7.4 (RSALv2/SSPL) replaced by Valkey 8.1.10 (BSD-3). The service keeps the name `redis`, so `REDIS_URL` and
  the maritime bus are unchanged; the binaries are `valkey-server` / `valkey-cli`, the user is `valkey`.
- Tests: `scripts/test-nerve.sh` builds a throw-away Postgres 16 and runs `db/test/nerve_test.sql` (57 checks,
  including tamper detection, append-only, money-tool refusal, gateway rules, queue timeouts and role limits).

## Consequences
- Agents do not exist as running processes yet; phases 2 (memory) and 3 (second brain) build on these functions.
- Known limit: all agents share the `nerve_agent` login, so one agent could pass another agent's id. The owner and
  system cannot be impersonated. Per-agent logins come with the agent runtime (phase 4).
- A superuser can still disable the triggers; the hash chain then shows exactly where history changed.
- Not tested here: the relay → PostgREST path and the Valkey container (no Docker daemon in the cloud session).
  Check on the laptop: `docker compose up -d` (db-migrate applies 05-nerve.sh), then the Ops Room Agents panel and
  `docker compose --profile geo up -d redis`.
- Undo: `DROP SCHEMA nerve CASCADE; DROP VIEW api.nerve_agents, api.nerve_events, api.nerve_chain; DROP ROLE nerve_agent;`
  and set the redis image back.

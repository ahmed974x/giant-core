# ADR-147: The time-series engine (Welford, EWMA, VPIN, LTTB) and the RFC 6962 Merkle audit tree

Date: 2026-11-06 · Status: Proposed. Ahmad's message of 2026-11-06 asked for:
- a pure in-process time-series engine for telemetry, with a matching Python skill;
- an LTTB chart with anomaly marks on `#/analytics`;
- a Merkle tree over sensitive events, after RFC 6962, with inclusion proofs checked in the page.

The pasted bridge that started Python with `child_process.spawn` was not used.

## Decision

1. **`jarvis/server/lib/timeseries.mjs`** (pure; runs in the server process and is inlined into the page) and **`.claude/skills/replica-timeseries-math/ts_math.py`** (standard library, the same formulas) provide:
   - **Welford** running mean and variance;
   - **EWMA**;
   - **an online z-score**, measured against the values before each point;
   - **a VPIN-style imbalance** (tick rule, equal buckets) [INFERENCE];
   - **LTTB.**
2. **Telemetry** (`telemetry.mjs`, tables `telemetry_points` and `telemetry_state`):
   - `POST /api/w/:slug/telemetry/record` takes 1 to 1,000 points. Names are checked and values must be finite. Each metric's Welford state and EWMA update in O(1) per point, and an anomaly is flagged as it arrives.
   - `GET /api/w/:slug/telemetry/series` reads up to 20,000 points, analyses them in one pass and returns them cut by LTTB (3 to 1,000 points).
   - `GET /api/w/:slug/telemetry/metrics` lists the metrics.
   - The server times every workspace request itself (`api.latency_ms`), so the chart shows real measurements on this computer.
   - Analytics draws the series in SVG, with every anomaly at its own place and the labels in HTML. Sample mode draws a seeded teaching series labelled «مثال تعليمي — أرقام افتراضية».
3. **The Merkle audit tree** (`merkle-audit.mjs` pure, `audit-log.mjs` on the server, table `audit_leaves`):
   - **Hashing:** leaf = SHA-256(0x00 ‖ entry), node = SHA-256(0x01 ‖ left ‖ right), as RFC 6962 defines them. A root is checked against Certificate Transparency's test vectors for 1 to 8 leaves.
   - **What becomes a leaf:** the store calls the audit log after every event, and these kinds are added — approvals and locked-step requests, agent changes, gate results (now written as `gate.passed` or `gate.failed`), skills, endpoints, access, Studio snapshots and exports, and mission milestones.
   - **Storage:** each row keeps the tree head after it. Appends use the frontier (O(log n) hashes) and are serialised per workspace. Rows cannot be updated or deleted, by trigger, in SQLite and PostgreSQL.
   - **Routes:** `GET /api/w/:slug/audit/merkle-proof?seq=` returns the audit path; `/audit/head`, `/audit/leaves` and `/audit/verify` (which recomputes every leaf and every stored head) complete the set. `POST /audit/record` accepts only the five Studio export kinds.
   - **Logs → Merkle audit tree:** the browser recomputes the leaf from the entry's fields and checks the path itself (RFC 9162 §2.1.3.2), so it does not have to trust the server.
4. **AGENTS.md §1 is unchanged.** Money, publishing, permissions, installs and outbound messages stay locked cards, and `mission_steps_locked_never_done` still refuses them. Their requests and decisions are now also in the audit tree.

Reviews:
- `docs/security/TIMESERIES-MERKLE-AUDIT-REVIEW-2026-11-06.md`;
- the skill's section in it.

## Consequences

- Any change to a past audit row breaks `verify` and every proof that runs through it. Removing the newest rows cannot be detected from inside the database alone, so keep a copy of the root (the ADR-148 diagnostics bundle carries it).
- Telemetry keeps the newest 50,000 points per metric; older points are dropped, and the running state keeps counting.
- Taking the phone shots showed that Logs had a sideways page scroll at 375 px, older than this change: the event table's box kept the default `min-width: auto`, so long ids widened the page. The box now has `min-width: 0`, and `test-live.mjs` checks it.
- An `at` column is turned into milliseconds when `db.mjs` reads it, so the audit table names its time column `logged` and hashes the exact text.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Unit tests and ruff** on `replica-timeseries-math`;
- **Server tests** on SQLite and PostgreSQL 16, including the RFC 6962 vectors, tampered proofs and append-only rows;
- **Flow tests:** F29 in `test-app.mjs`, and the telemetry and proofs in `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/analytics` and `#/logs`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.

# Security review: telemetry, the time-series skill and the Merkle audit tree (ADR-147)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

All files are **new code written in this repository**. The pasted `timeseries-bridge.mjs`, which started `python3` with `child_process.spawn` and fell back to a fixed standard deviation of 0.5, was not used: the server computes in its own process, and the numbers are real.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-timeseries-math/ts_math.py` | 155 | 963c2c10f5aabd04 | Welford, EWMA, z-score, VPIN-style imbalance, LTTB; JSON or CSV in |
| `.claude/skills/replica-timeseries-math/tests/test_ts_math.py` | 83 | 3763aa7b93082519 | 6 unit tests |
| `jarvis/server/lib/timeseries.mjs` | 75 | 44533a34b42a2e86 | The same formulas (server and page) |
| `jarvis/server/lib/telemetry.mjs` | 72 | 3291b2191714e9fb | Record, metrics, series |
| `jarvis/server/lib/merkle-audit.mjs` | 72 | 0e92e75cc65ae5c2 | RFC 6962 hashing, paths, RFC 9162 verification, frontier |
| `jarvis/server/lib/audit-log.mjs` | 84 | 1aa4dbc1b4d08f1b | Leaves, heads, proofs, verify |

## 2. The skill

- **Imports:** `argparse`, `csv`, `json`, `math`, `sys` (the tests add `contextlib`, `io`, `os`, `random`, `statistics`, `tempfile`, `unittest`). There is no network, `subprocess`, `exec` or `importlib`.
- **Input checks:** values must be finite (a test feeds `NaN`).
- **Writes:** nothing; it prints.

## 3. Telemetry

- Only `127.0.0.1` reaches the routes, under the same Host, Origin, `X-Jarvis` and size checks as every other write.
- **Names and values:** a metric name must match `^[a-z][a-z0-9_.]{0,63}$`, a value must be finite with |v| ≤ 10¹², and a batch holds at most 1,000 points.
- **SQL and size:** every value is a bound parameter; the only numbers built into SQL text are server-side integers. A series read is capped at 20,000 points, and storage at 50,000 points per metric.
- The latency recorder keeps numbers only (no paths, bodies or headers), flushes every 2 seconds and stops when the server closes.

## 4. The Merkle tree

- **Hashing and checks:**
  - RFC 6962's domain-separated hashes (0x00 for leaves, 0x01 for nodes) prevent a second-preimage mix-up between leaves and nodes.
  - The roots match Certificate Transparency's published test vectors for 1 to 8 leaves.
  - Tests prove that a wrong index, a wrong size, a missing path element, a different leaf or an edited entry fails.
- **Append-only:** triggers refuse `update` and `delete` on `audit_leaves` in SQLite and PostgreSQL; a test proves both on both engines.
- **What a leaf records:** each one is canonical JSON of the event's number, kind, actor, target and time, and nothing else. Event payloads are not copied into it.
- **What is written through the API:** `POST /audit/record` accepts only the five Studio export kinds; other kinds come only from the server's own events.
- **The page checks proofs itself.** It recomputes the leaf from the entry and verifies the path, with the same pure code.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict .claude/skills/replica-timeseries-math jarvis/server/lib` | 0 critical, 0 high |
| `ruff check .claude/skills/replica-timeseries-math` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-timeseries-math/tests` | 6 tests OK |

## 6. Limits, said plainly

- Someone who can write to the database file can drop the triggers and rewrite history. `verify` then shows the break, unless every row after the change is rebuilt too. Keeping a copy of the root outside the database (the diagnostics bundle carries it) closes that gap.
- VPIN here is an analogy for direction changes in a metric, labelled `[INFERENCE]`; it predicts nothing.

## 7. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.

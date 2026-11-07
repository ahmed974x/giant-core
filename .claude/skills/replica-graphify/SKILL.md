---
name: replica-graphify
description: A structural knowledge graph of Jarvis without a vector database - screens, API routes, server modules, SQL tables with their constraints, and skills with their Python tools, joined by what each one calls - read from the code with ast and plain text parsing, written as JSON for the Governance page's SVG map. Standard-library Python only; no network, no processes.
---

# replica-graphify

```bash
python3 .claude/skills/replica-graphify/graphify.py --root . --out jarvis/app/data/knowledge-graph.json
```

Rebuild the page afterwards (`node jarvis/scripts/build-app.mjs`, then `skillspector-audit.mjs --fix`).

| Node | Read from |
| --- | --- |
| screen | `pages.<name>` in `jarvis/app/src/app.js`, nav routes in `shell.tmpl` |
| route | `jarvis/server/server.mjs`: `R("GET", /^…$/)`, `rest === "/…"`, `(k = /^…$/.exec(rest))` blocks |
| module | `const x = createX(…)` in the server and the `./lib/` file it imports |
| table | `create table` in `schema-sqlite.sql`, with named constraints |
| skill, tool | `.claude/skills/*/SKILL.md`, and the public functions of each `.py` (by `ast`) |

The edges are:
- screen → route (the store methods a page calls, and the paths they request);
- route → module (the object the route awaits);
- module → table (SQL in that file);
- skill → tool.

`unlinked` lists routes and tables nothing reaches through the page: a pointer to dead code or to a page that reads it another way, such as Server-Sent Events. The output records each file's SHA-256 and a digest, so a stale map is visible.

## In giant-core

- Read-only. It never runs the code it reads and writes only `--out` inside `--root`.
- A map is a reading of the code by fixed rules [INFERENCE]; the code is the truth.

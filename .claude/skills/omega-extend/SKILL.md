---
name: omega-extend
description: How to add a metric, panel, data table, service or plugin to the OMEGA stack (giant-core) so it matches the existing code. Use before changing services/quant (stdlib risk engine), services/studio (Panel app + DuckDB vault), dashboard/index.html (Ops Room), docker-compose.yml or plugins/.
---

# Extending OMEGA

The codebase is the prompt (stdlib's rule): find the closest sibling and copy its shape. Don't invent
a new pattern when one already exists; if you change a convention, update every sibling in the same change.

## Closest siblings

| You are adding | Copy the shape of | Then |
|---|---|---|
| A risk metric | `analyse()` in `services/quant/quant.js` | add a case to `services/quant/test/quant.test.js`, show it in `renderQuant()` in the Ops Room |
| A Studio KPI / plot / table | `_anomaly_count`, `_price_plot`, `_anomaly_table` in `services/studio/app.py` | add the view to `test_studio_reacts_to_symbol_and_hours` |
| A long-range question | `HISTORY_SQL` in `services/studio/vault.py` | new tables go in `SCHEMA` + `TABLES` and are filled by `_load()` |
| A live data source | a `data.py` loader (live view, else demo with the same columns) | the relay must allowlist the view in `API_VIEWS` |
| A container | the `quant` service in `docker-compose.yml` | `mem_limit`, `cpus`, `read_only`, `cap_drop`, healthcheck; heavy ones behind a profile |
| A capability anyone can find | `plugins/omega-quant/plugin.json` | `python scripts/plugins.py` |

## Rules that keep a 7 GB laptop alive

- Every container has `mem_limit` and `cpus`. Anything over ~300 MB is opt-in via a compose profile.
- Prefer in-process tools (stdlib accumulators, DuckDB) to new servers.
- The Ops Room is one self-contained HTML file served under a strict CSP: no CDN scripts, no fonts.
- stdlib: install single packages (`@stdlib/stats-incr-*`), never the whole `@stdlib/stdlib`. Incremental
  accumulators (`incrmstdev(W)`, `increwvariance(alpha)`, `incrmpcorr(W)`) are the default tool for rolling stats.
- DuckDB: the vault file only ever holds live data; demo data lives in an in-memory database.

## Checks before you call it done

```sh
cd services/quant && npm test
services/studio/.venv/Scripts/python -m pytest services/studio
node --check services/relay/server.js
python scripts/plugins.py --check
docker compose --profile studio --profile llm config -q
```

Then open the Ops Room with `?demo` and the Studio, and confirm the console has no errors.

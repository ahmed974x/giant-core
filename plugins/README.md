# OMEGA plugins

Every capability in OMEGA (a workflow, a tool, a Claude skill, an MCP server, an LLM provider route,
a dashboard panel) is registered here as one folder with a `plugin.json`. The registry is the single
list of what the system can do; the dashboard's **Modules** panel is built from it.

## Add a plugin

1. Copy `_template/` to `plugins/<your-id>/` (lowercase, digits, dashes).
2. Edit `plugin.json`:

| field | meaning |
|-------|---------|
| `id` | must equal the folder name |
| `name` | display name |
| `kind` | `workflow` · `tool` · `skill` · `mcp` · `provider` · `panel` |
| `version` | semver |
| `description` | one sentence |
| `entry` | repo-relative path to the code or config (may live in this folder) |
| `requires` | stack services it needs, e.g. `["n8n", "timescale"]` |
| `enabled` | `false` keeps it listed but inactive (and skips the entry check) |

3. Put the code next to it (small plugins) or point `entry` at where it lives (`n8n/workflows/…`,
   `mcp/…`, `services/…`).
4. Run `python scripts/plugins.py` to validate and refresh `dashboard/plugins.json`.

## Where each kind plugs in

- **workflow**: n8n JSON in `n8n/workflows/`; seeded by `n8n/init.sh` on the next `up`.
- **provider**: a route in `services/cortex/config/providers.json`; reload with `docker compose kill -s HUP cortex`.
- **mcp**: a folder under `mcp/` with its own `package.json` and tests.
- **skill**: a Claude skill under `.claude/skills/<name>/SKILL.md`.
- **tool**: a service under `services/` (add it to `docker-compose.yml` with `mem_limit` and `cpus`).
- **panel**: a dashboard panel; register it here so it shows up in Modules.

## Resource rule

This runs on a 7 GB laptop. Any plugin that adds a container must set `mem_limit` and `cpus`, and
anything heavier than ~300 MB goes behind a compose profile so it is opt-in.

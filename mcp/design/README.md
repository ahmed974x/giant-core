# Penpot MCP: design automation (optional)

[`@zcubekr/penpot-mcp-server`](https://github.com/zcube/penpot-mcp-server) (MIT, 76+ tools) lets an agent create
projects, pages, shapes and components in [Penpot](https://penpot.app), the open-source Figma alternative, so new
OMEGA screens can be sketched as editable mockups before they are coded. ADR 014.

It is **configured, not enabled**: it needs a Penpot account.

1. Create a free account on design.penpot.app (or point `PENPOT_API_URL` at a self-hosted Penpot; that stack needs
   about 2 GB of RAM, too much for this laptop next to everything else).
2. Penpot → Your account → Access tokens → create one.
3. Put both values in the git-ignored `OMEGA_PRIME_PROJECT/.env` (never in this file):
   `PENPOT_API_URL=https://design.penpot.app` and `PENPOT_ACCESS_TOKEN=...`
4. Merge the `penpot` block from `penpot.mcp.json` into `OMEGA_PRIME_PROJECT/.mcp.json` and restart the session.

Runs on demand via `npx` (one Node process, roughly 60 MB). The version is pinned; update it deliberately.

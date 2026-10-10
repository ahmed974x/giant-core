# n8n MCP: Claude builds and runs OMEGA automations

n8n's **instance-level MCP** (Settings > Instance-level MCP, n8n 2.x) lets Claude search, run and, from n8n 2.13,
build or edit workflows on the local n8n. It is registered for Claude Code in `OMEGA_PRIME_PROJECT/.mcp.json`:

```json
"n8n-mcp": { "type": "http", "url": "http://localhost:5678/mcp-server/http" }
```

That is the same as `claude mcp add --transport http n8n-mcp http://localhost:5678/mcp-server/http --scope project`,
with the host filled in (the pasted command had none) and pointed at the local n8n from `docker-compose.yml`.

## Turn it on (once)

1. Start n8n: `docker compose up -d n8n` (needs Docker; the compose image is now `n8nio/n8n:2.42.6`, because the
   old pin 1.80.0 predates instance-level MCP).
2. Open http://localhost:5678 → Settings → **Instance-level MCP** → **Enable MCP access**, then choose which workflows
   Claude may see.
3. Connect Claude with **OAuth** (recommended): restart Claude Code, run `/mcp`, pick `n8n-mcp`, Authenticate, and
   approve the permissions in the n8n page that opens. No secret is stored in any file.
   API key instead: create it in the same n8n page, put `N8N_MCP_API_KEY=...` in the git-ignored `giant-core/.env`
   and add `"headers": { "Authorization": "Bearer ${N8N_MCP_API_KEY}" }` to the entry. Never paste the key in chat.

## In the web app

The Company screen's **System Health** card has an "n8n automations (MCP)" tile: red when n8n is not running, amber
when n8n is up but MCP access is not enabled yet, green when the MCP endpoint is ready for Claude.

## Guardrails

- n8n listens on 127.0.0.1 only; the MCP endpoint is never exposed on the LAN or the internet.
- Workflow runs that act outside OMEGA (messages, posts, purchases) still go through Director 00's approval gate when
  Director triggers them; Claude asks before running any workflow with side effects.

# awesome-atlas MCP

Read-only MCP server that lets Claude search the ~700 curated awesome-lists from
[sindresorhus/awesome](https://github.com/sindresorhus/awesome) (CC0). It works offline from the snapshot in
`web/data/awesome-atlas.json` and has no dependencies; the search code is shared with the web app's Atlas page
(`web/src/lib/awesome.ts`). See ADR-027.

Tools:

- `awesome_search { query, category?, limit? }`: ranked lists for a tool, topic or field.
- `awesome_categories {}`: categories, counts and snapshot date.

Registered in the project's `.mcp.json` as `awesome-atlas`. Refresh the snapshot with `npm run atlas:sync` in `web/`.
Test: `node --test mcp/awesome-atlas/server.test.mjs`.

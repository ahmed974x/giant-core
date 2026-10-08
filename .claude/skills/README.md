# Claude skills for giant-core

Vendored from [anthropics/skills](https://github.com/anthropics/skills) at commit `683bc88` (Apache 2.0, each folder keeps its `LICENSE.txt`).
Claude Code loads every folder here automatically when it runs inside this repo.

| Skill | Use it for |
|---|---|
| `frontend-design` | Visual direction, typography and layout for the OMEGA dashboards, so they don't look templated |
| `web-artifacts-builder` | Multi-component React + Tailwind + shadcn/ui pages bundled into one HTML file |
| `theme-factory` | Colour and font themes; can generate a custom dark "neural" theme |
| `algorithmic-art` | p5.js particle systems and flow fields for live neural backgrounds |
| `build-mcpb` | Packaging an OMEGA tool server as a one-file `.mcpb` bundle you drag onto Claude Desktop (from [claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/mcp-server-dev) at `f713a7c`) |
| `webapp-testing` | Playwright screenshots and checks of the dashboard running locally |

To update: re-copy the folders from a fresh clone of anthropics/skills.

# ADR-070: Vision + TradingView MCP layer: security review before any install

Date: 2026-10-15 · Status: Accepted 2026-10-15 23:25Z (Ahmad): argus-screens only

## Context
Ahmad proposed a "Vision + Trading Analysis" layer for NABD: vision MCP servers (mcp-local-vision,
page-vision-mcp, vlm-mcp, claude-vision, argus-screens, optional agent-vision-mcp and qa-screens) and
TradingView MCP servers (atilaahmettaner/tradingview-mcp, FerroxLabs TVControl, tradingview-assistant).
ADR-064 policy: nothing external is installed without his explicit approval and a prior read-only review.
NABD trades on paper only; no tool that can execute orders is acceptable.

## Decision
Read each published package (PyPI sdist / npm tarball) in an empty scratch folder without running it.
Full findings: `docs/security/VISION-TRADING-MCP-REVIEW.md`.

- Safe to consider, with conditions: argus-screens 0.1.0 (local only, no network; never run `argus install`,
  which pre-approves its tools and adds a Windows startup entry; add OMEGA key/PIN windows to its redact list;
  pin by hash).
- Needs changes: page-vision-mcp (defaults to OpenAI), mcp-local-vision (model can pick a cloud provider;
  no repo), claude-vision (OCR fetches language data at runtime; no redaction),
  tradingview-mcp-server 0.8.1 (pin by hash instead of git HEAD; keep proxy rotation off; manual questions
  only, never wired into Director 00 or paper trading, because TradingView Terms §3 forbid non-display use).
- Reject: vlm-mcp (placeholder repo, leaked third-party API key in the package), qa-screens (posts error
  reports with the user's GitHub token by default), agent-vision-mcp (needs an open Chrome debugging port),
  TVControl (drives a logged-in TradingView Desktop over an open CDP port; generic clicks can reach the
  broker Trading Panel), tradingview-assistant (`execute_order` tool, "paper now, live later"; clashes
  with the atilaahmettaner package name).
- The plan's ADR numbers 093/094 are replaced by this ADR-070.

## Consequences
- No change to the laptop, Claude Desktop config or repo code until Ahmad picks options.
- TradingView's official MCP (mcp.tradingview.com, beta since 2026-09-16) is the terms-clean route but needs
  a paid Essential plan.

## Outcome (Ahmad, 2026-10-15 23:25Z)
- Approved: argus-screens 0.1.0 only. Installed 2026-10-16 with `uv tool install` from the wheel after the sha256
  check passed (`C:\Users\Hp\.local\bin\argus-mcp.exe`). `argus install` and `argus tray` were not run; no
  startup entry; `mcp__argus` is not pre-approved.
- Claude Desktop (MSIX config) got one entry `mcpServers.argus`; backup `claude_desktop_config.json.bak-argus-20261016-023017`.
- Privacy list: `ops/argus/config.toml` -> `%USERPROFILE%\.argus\config.toml`. Adds the site PIN window
  (`OMEGA PRIME - رمز الموقع`), the keys window (`OMEGA PRIME - المفاتيح`), Keys Vault tabs, crypto wallets,
  email apps and tabs, and any title with PIN/password. Redaction test passed on 7 test windows (6 hidden,
  1 control visible; OCR read none of the hidden text); pause/resume work.
- Rejected: all three TradingView tools (Terms §3) and every other vision tool in the review.

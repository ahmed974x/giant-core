# CLAUDE.md, giant-core / OMEGA PRIME (NABD)

## External skills, plugins and hooks (mandatory)
- **No external skill, plugin, hook or MCP server may be installed, enabled or registered without explicit human approval from Ahmad AND a prior security review in an isolated environment.** Isolated means a throwaway folder or a Docker container with no host mounts, no secrets and no install scripts run.
- The review is recorded in `docs/SKILLS-SECURITY-REVIEW.md` (or a new section of it) before anything is installed.
- **Marketplaces:** adding a marketplace does not approve its plugins. Only plugins Ahmad named after review may be installed (currently: `superpowers` from obra/superpowers only). Every other marketplace plugin needs its own review and approval.
- Never run an install with confirmation skipped (`-y`, `--force`, `--yes`), and never use `npx skills add` or similar auto-installers.
- Rejected on 2026-10-15: task-observer, impeccable, claude-mem, find-skills. Do not reinstall them.
- Do not use `claude-skill-antivirus` (CVE-2026-84810: it reads only SKILL.md and skips scripts). Use manual review instead.
- Decision record: `docs/adr/ADR-064-external-skills-policy.md`.

# Security review: the live skill loader (ADR-142)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked Jarvis to find, add, merge and grow skills from inside the site:
- discover them on the internet through GitHub;
- write them on request;
- check them in memory for dangerous patterns;
- mount them live with no restart, in the Skill Mixer, the Studio and Ctrl+K;
- evolve them (FIX / DERIVED / CAPTURED), with the permanent write into `.claude/skills` a locked violet card.

His message named outside projects as ideas: OpenSpace's FIX / DERIVED / CAPTURED, agent-skill-loader's hot reload, AXguard's eleven patterns, oat's web components, and open-agent-hub. **None of their code was copied, vendored or run.** AGENTS.md §1 needs a written review and his approval for that; their ideas were reimplemented here as text rules and plain Node.

## Scope

| File | Role |
|---|---|
| `jarvis/server/lib/skill-audit.mjs` | In-memory audit: SkillSpector's `RULES` plus eleven loader rules; skill names; mission steps to skill steps (pure, also inlined into the page) |
| `jarvis/server/lib/skill-loader.mjs` | Discover, import, synthesize, evolve, unmount, locked install, evolution log |
| `jarvis/server/server.mjs` | `/api/w/:slug/skills/{runtime,evolution,discover-online,import,synthesize-and-mount,evolve}` |
| Schema (both engines) | `runtime_skills` (`runtime_skills_scan_clean`, unique mounted name) and append-only `skill_evolution_log` |
| `jarvis/app/src/app.js` | `#/loader` page; loaded skills in the Skill Mixer, the agent editor and Ctrl+K |

## Threats and what stops them

1. **Running code from the internet.**
   - Only text is ever read: one file whose name is `SKILL.md`, at most 64 KB, from a public repository, through GitHub's contents API.
   - Paths must match `(dir/){0,6}SKILL.md`, with no `.` or `..`. A test refuses `scripts/install.sh` and `../SKILL.md`.
   - Nothing is written to disk, and nothing in a mounted skill is executed by Jarvis. "Mounted" is a database row that the Mixer, the agent editor and Ctrl+K can show and link.
2. **SSRF through discovery.**
   - Every request uses the open-web search's `requestJson`: the fixed host `api.github.com` (`/search/repositories`, `/repos/owner/name`, `/contents/…`), DNS answers checked in the socket, IP literals checked first (ADR-139 follow-up), no redirects, 1 MB, JSON only.
   - Owner and repository names are checked against GitHub's own name rules before they reach a URL.
   - Result links are kept only when they are `https://github.com/`.
3. **A hostile skill.** The audit runs SkillSpector's rules (the same list CI uses) and these eleven:
   - sudo;
   - tunnels (ngrok, cloudflared, localtunnel, serveo, bore, tailscale funnel);
   - a download piped to a shell;
   - eval/exec, and processes;
   - environment variables;
   - cron, schtasks, launchctl, systemctl enable;
   - destructive deletes;
   - credential stores;
   - private or loopback URLs;
   - instruction overrides.

   Any critical or high finding refuses the skill, and `runtime_skills_scan_clean` repeats this in SQL. Tests cover each rule, a refused import (tunnel plus pipe-to-shell), a refused synthesis and a refused FIX that adds a credential read; the old version stays.
4. **The local model writes a bad skill.** Its SKILL.md is untrusted text: parsed with `readSkillMd`, then audited like any other. If it does not parse, the fixed forge template is used and the page says so.
5. **Captured missions.** A locked mission step becomes "Stop at … it needs Director 00's approval", never an instruction to do it.
6. **The permanent install.** "Install into the repo…" creates a locked `install` approval. A test checks that nothing appears in `.claude/skills`.
7. **Provenance.** Each imported skill keeps its source URL (`https://github.com/…` only, a SQL check), its licence as GitHub reports it, and the commit's blob SHA in the evolution log. `skill_evolution_log` is append-only, by trigger on both engines.

## Limits, said plainly

- The audit is pattern-based. A skill can describe something harmful in words the rules do not know. That is why mounting is text-only, and why the install keeps a person's review.
- GitHub's keyless search allows 10 searches a minute, and the page says when it is offline.
- Imported skills are third-party text. Their licence is shown, and none is "reviewed" until Director 00 approves an install.

## Checks

| Check | Result |
|---|---|
| `node jarvis/server/test/test-server.mjs` (SQLite + PostgreSQL 16) | see `jarvis/replica/evidence/tests-server.log` |
| `node jarvis/scripts/test-app.mjs` F20, `test-live.mjs` | see `tests-app.log`, `tests-live.log` |
| `node scripts/skillspector-audit.mjs --strict .` | 0 critical, 0 high |

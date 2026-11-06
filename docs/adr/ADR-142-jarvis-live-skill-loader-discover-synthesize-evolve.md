# ADR-142: The live skill loader (discover on GitHub, synthesize, evolve), mounted at once, installed only by approval

Date: 2026-11-06 · Status: Proposed. Ahmad's messages of 2026-11-06 asked that he can add, merge and grow skills from inside Jarvis:
- by searching the internet or writing them on request;
- with an in-memory security check;
- mounted live without a restart;
- with an evolution loop (FIX / DERIVED / CAPTURED);
- with the permanent write into `.claude/skills` a locked card.

## Decision

1. **`skill-audit.mjs`** runs SkillSpector's rules plus eleven loader rules (sudo, tunnels, pipe-to-shell, eval/exec, processes, environment, cron, destructive deletes, credential stores, private URLs, overrides). Any critical or high finding refuses the skill.
2. **`skill-loader.mjs`:**
   - **discover:** GitHub's repository search, keyless, on its fixed host through the ADR-139 request function.
   - **import:** one `SKILL.md`, as text, through the contents API, with its source, licence and blob SHA.
   - **synthesize:** the local model on 127.0.0.1 writes the SKILL.md; with no model, or an unreadable answer, the forge template does.
   - **evolve:** FIX (new version, re-audited, old version kept on refusal), DERIVED (new skill with the parent's steps plus new ones), CAPTURED (from a finished mission, locked steps turned into stops).
   - **install:** a locked `install` approval.
3. **Tables:**
   - `runtime_skills`, with `runtime_skills_scan_clean`, one mounted name per workspace, and source URLs limited to `https://github.com/`.
   - `skill_evolution_log`, append-only.
4. **Live use.** Mounting logs an event, so open pages refresh through the existing server-sent events. A loaded skill appears in the Skill Mixer ("Loaded in this workspace"), the agent editor and Ctrl+K, which now also matches words inside hyphenated names. The new `#/loader` page has Discover, Synthesize, Capture, the loaded list (Fix…, Derive…, Install…, Unmount) and the evolution log, in Arabic too.
5. **Outside projects** (OpenSpace, agent-skill-loader, AXguard, oat, open-agent-hub) informed the design only. Nothing of theirs was copied or installed (AGENTS.md §1). Review: `docs/security/JARVIS-LIVE-SKILL-LOADER-REVIEW-2026-11-06.md`.

## Consequences

- Ahmad can pull a published skill's text, or write one, and use it in the same minute. The repository changes only when he approves an install.
- The Studio does not run skills. Skills are instructions for agents, not page components.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Server tests** on SQLite and PostgreSQL 16;
- **Flow tests:** `test-app.mjs` F20 and `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/loader`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.

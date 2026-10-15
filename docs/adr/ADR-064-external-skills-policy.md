# ADR-064: External skills policy after the five-repo security review

Date: 2026-10-15 · Status: Accepted (Ahmad, 2026-10-15)
Number: 064 follows ADR-063 (Core API). Renumber on merge if another branch has taken it.

## Context
Ahmad asked for a read-only security review of five Claude skill repos (task-observer, find-skills, claude-mem, superpowers, impeccable) before installing anything. The review is in `docs/SKILLS-SECURITY-REVIEW.md`. It also found that the scanner he proposed, claude-skill-antivirus 2.1.3, has a published flaw (CVE-2026-84810): it scans only SKILL.md for local folders, and it rated the riskiest repo SAFE 100/100.

## Decision
- Approve **superpowers** (obra/superpowers plugin only) for a local install on the laptop. It is not installed yet.
- Reject task-observer (per-session token cost), impeccable (downloads and runs a binary at run time), claude-mem (sends prompts and tool output to an LLM, telemetry on by default) and find-skills (installs with `-g -y`).
- Stop using claude-skill-antivirus. Until a trustworthy scanner exists, use manual review in an isolated environment.
- Add a mandatory rule to `CLAUDE.md`: no external skill, plugin, hook or MCP server without explicit human approval and a prior isolated security review. Adding a marketplace approves none of its plugins.

## Consequences
- Every future skill request costs one review before install. That is accepted as the price of keeping secrets and tokens safe.
- Ideas from rejected skills (for example task-observer's observation log) may be re-implemented locally in a small, reviewed form.
- CLAUDE.md did not exist on main. If the laptop branch already has one, merge this section into it.

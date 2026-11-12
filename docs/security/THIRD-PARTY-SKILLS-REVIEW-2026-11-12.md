# Security review: 13 outside agent projects, read-only (ADR-159)

Date: 2026-11-12 · Reviewer: Claude Code, cloud sandbox · Asked for by Director 00 in the ADR-159 request.

## 1. Method

- Each project's `README.md` (and, where present, `package.json` or `pyproject.toml`) and its `LICENSE` were read as plain text from `raw.githubusercontent.com/<owner>/<repo>/HEAD/…` into a scratch folder outside the repository. The GitHub API was not reachable from the sandbox, so file trees, releases and stars were not read.
- **Nothing was installed or run.** No `npx`, `npm -g`, `pip install`, `uv tool install`, `/plugin install`, a downloaded script piped into a shell or `skills add` command was run, and no project script was opened in an interpreter.
- The downloaded text was scanned with this repository's SkillSpector (`node scripts/skillspector-audit.mjs rev159`, run from the scratch folder): 21 files, **6 critical, 0 high**. The findings are in §3. They are in the projects' own instructions, which is why none of those instructions are followed here.
- Ahmad's approval covers pure deterministic rules in JS or Python that pass this review and SkillSpector with 0 critical and 0 high, merged into the server and the page, with no network installs and no spoofed TLS fingerprints or cookies. It does not cover installing any of the projects, so their status is "reviewed", and "rules adopted" only where text rules were written into this repository's own code.

## 2. Register

| Project | Licence (file read 2026-11-12) | How it installs | Risk signals in its own text | Verdict |
|---|---|---|---|---|
| browser-use/browser-use | MIT | `pip install`, `uv tool install` | drives a real browser for a hosted model; needs a model API key | not installed |
| rohitg00/agentmemory | Apache-2.0 | `npx -y …@latest`, `npx skills add` | an unpinned `@latest` download, a daemon on 3111 and 3113, agent hooks | not installed; the repository's BM25 memory (ADR-138) covers the need |
| K-Dense-AI/scientific-agent-skills | MIT | `npx skills add` | a large skill pack; the uv installer piped into a shell in its setup text | not installed |
| mukul975/Anthropic-Cybersecurity-Skills | Apache-2.0 | `npx skills add` | a large skill pack of offensive and defensive playbooks | not installed |
| ai-boost/awesome-harness-engineering | CC0-1.0 | a list | none; one SkillSpector hit is a false positive (§3) | reference only |
| volcengine/OpenViking | AGPL-3.0 | `uv tool install`, or a downloaded installer piped into a shell | a server; a pipe-to-shell installer; AGPL obligations if served | not installed |
| nextlevelbuilder/ui-ux-pro-max-skill | MIT | `/plugin install`, `npm install -g` | a global CLI | rules adopted earlier as UI checklists (ADR-143) |
| DietrichGebert/ponytail | MIT | `/plugin install` | hooks and a status band | rules adopted: the six-rung lean ladder (`lean` mode) |
| cloudflare/security-audit-skill | MIT | `npx skills add` | zero-dependency `.cjs` validators; isolated sub-agents | rules adopted: the four verdicts and six phases (`security` mode) |
| obra/superpowers | MIT | `/plugin install` | hooks; optional telemetry for its visual companion, off with `SUPERPOWERS_DISABLE_TELEMETRY` | rules adopted earlier: tests first, small task splits (ADR-143) |
| Graphify-Labs/graphify | Apache-2.0 | `uv tool install` | its README says no telemetry; the uv installer piped into a shell | rules adopted: EXTRACTED and INFERRED edges, weakest-hop confidence (`graph` mode); the repository already has `replica-graphify` |
| Jakeschincariol/replica-skill | MIT | `/plugin install` | eleven skills | several skills already vendored after review (ADR-132 to ADR-134) |
| cheaper-inference/OmniRoute | MIT | `npm install -g`, `npx -y` | a postinstall script, about a hundred dependencies, a daemon on 20128, usage telemetry and quota analytics, it holds provider keys | not installed; in Jarvis a local gateway is a locked install step |

## 3. SkillSpector findings in the downloaded text

| Rule | File | Line | Reading |
|---|---|---|---|
| SEC-KEY-LITERAL | awesome-harness-engineering `README.md` | 46 | false positive: a table-of-contents anchor (`#task-runners--…`) that starts with the letters of a key prefix; no key |
| SEC-PIPE-SHELL | graphify `README.md` | 165, 181 | the astral.sh uv installer piped into `sh` |
| SEC-PIPE-SHELL | scientific-agent-skills `README.md` | 321 | the same uv installer |
| SEC-PIPE-SHELL | OpenViking `README.md` | 199, 216 | the openviking.ai installer piped into `bash` |

These are instructions in the projects' text, not code in this repository. They are the reason the projects stay uninstalled; none of the text was copied in.

## 4. What entered the repository

Only rules written fresh in `jarvis/server/lib/universal-agent.mjs` and its twin `.claude/skills/replica-universal-agent/universal_agent.py`: the lean ladder, the security verdicts and phases, and the edge labels with weakest-hop confidence. The register above is the `reviewed` list in the agent's catalog (`installed: false` on every row). No code, hook, plugin, MCP server, package or installer was added.

## 5. To install any of them later

A new written review of the exact version (file tree, lockfile, install scripts, network and telemetry), Ahmad's approval (AGENTS.md §1) and, for a service, a 127.0.0.1 bind and no hosted endpoint without the ADR-141 card.

# Skills security review

Decision record: [ADR-064](adr/ADR-064-external-skills-policy.md). Rule: see "External skills" in [CLAUDE.md](../CLAUDE.md).

Date: 2026-10-15. Reviewer: Claude (thread "Review five Claude skill repos").
Scope: five repos Ahmad approved for review. **Nothing was installed, enabled or registered.** No writes to `.claude/`, the laptop or any skill config. Every repo was shallow-cloned into an isolated scratch folder in the cloud container.

## Ahmad's decision (2026-10-15, final)

| Skill | Decision | Reason (Ahmad's words, summarised) |
|---|---|---|
| task-observer | **Rejected**, borrow ideas only | Loading it on every session (via hook or CLAUDE.md) burns tokens and breaks the frugality rule. |
| superpowers | **Approved for local install** (not installed yet; laptop step) | Only the `superpowers` plugin itself. No other marketplace plugin without a separate review. |
| impeccable | **Rejected** | Downloading and running a binary from GitHub Releases at run time is an unacceptable risk. |
| claude-mem | **Rejected** | Sending prompts and tool output to an LLM, with telemetry on by default, breaks NABD privacy. |
| find-skills | **Rejected** | Installing with `-g -y` and no confirmation breaks "no install without explicit approval". |
| claude-skill-antivirus | **Stopped**, no longer used | The scanner itself is unreliable (CVE-2026-84810, below). |

### Replacing claude-skill-antivirus
Until a trustworthy scanner is found, every external skill is checked by **manual review in an isolated environment**: clone into a throwaway folder (or a Docker container with no mounts from the host and no secrets), run no install scripts, then read every manifest, hook, script and binary launcher. "Isolated" means no access to `~/.claude`, `.env` files, keys or the project tree.

Note on the CVE: the flaw is the reverse of "it skips SKILL.md". For local folders it reads **only** SKILL.md and skips the scripts and binaries, which is exactly where malicious code lives.

The review below kept its original verdicts. The decision above is what applies.

## Reviewer verdicts

| # | Skill | Repo @ commit | Verdict | One-line reason |
|---|---|---|---|---|
| 1 | task-observer | rebelytics/one-skill-to-rule-them-all @ 56e8907 | **Safe to consider** | No network, no binaries, small readable bash/python. The real cost is tokens: it tries to load on every session. |
| 2 | superpowers | obra/superpowers @ bb92a77 (marketplace obra/superpowers-marketplace @ 2cf27fa) | **Safe to consider** | One SessionStart hook that only reads a local file. The optional brainstorm server listens on loopback only and needs a token. |
| 3 | impeccable | pbakaus/impeccable @ db0f2df | **Risky** | Its hooks run a native binary on every Edit/Write and Stop, and the launcher downloads that binary from GitHub Releases at run time. |
| 4 | claude-mem | thedotmack/claude-mem @ fef3402 | **Risky** | Hooks on every prompt and every tool call record your session, send it to an LLM for compression (which costs tokens), keep a background worker running, and send telemetry to PostHog by default. |
| 5 | find-skills | vercel-labs/skills @ 13e4063 (skills/find-skills) | **Block** | Its job is to install unvetted third-party skills with `-g -y`, which skips confirmation, and the CLI sends usage telemetry by default. |

## About claude-skill-antivirus (important)

I ran `claude-skill-antivirus@2.1.3` (the latest on npm) in `--scan-only` mode, with `npm install --ignore-scripts` and `HOME` pointed at an empty scratch folder, so it could not install anything.

**Do not trust its verdicts.** Two reasons:
- **It has a published vulnerability.** CVE-2026-84810 (CWE-693, listed on osv.dev) says that when it scans a local directory, it reads only `SKILL.md` and skips scripts and binaries, so malicious code can still get a SAFE verdict and a 100/100 score. Affected versions run through 2.1.3, and osv.dev lists no fixed version yet. My runs showed the same thing: every scan reported "File count: 1".
- **Its output contradicts the real risk.** It gave impeccable **SAFE 100/100**, but impeccable is the skill that downloads and runs a binary. It gave task-observer **CRITICAL 35/100** for "cloud metadata endpoint SSRF", because it matched the YAML word `metadata:` (SKILL.md:7). That is a keyword false positive.

Raw scan results:

| Skill | AV verdict | What it actually matched |
|---|---|---|
| task-observer | CRITICAL 35 | the word `metadata`, sub-agent mentions (false positive) |
| find-skills | HIGH 60 | `npx` + network mention, `@` in `owner/repo@skill` |
| claude-mem (mem-search) | CRITICAL 60 | the same `metadata` keyword |
| superpowers (brainstorming, using-superpowers) | MEDIUM 90 | "Kubernetes namespace" keyword |
| impeccable | SAFE 100 | nothing, because it never looked at the scripts or the binary launcher |

All verdicts below therefore come from **manual source review**.

---

## 1. task-observer: Safe to consider

**What it is:** a single SKILL.md (684 lines), 7 reference .md files and 5 scripts (`scripts/*.sh`, `scripts/*.py`). It writes observation notes as Markdown files into a workspace folder.

Evidence:
- No network. A grep for curl/wget/http/requests/urllib/socket across `scripts/` finds nothing. SKILL.md:18-23 says normal operation fetches nothing, and the only network use is a user-started "upstream check".
- No env or secret access. The only `os.environ` use is `scripts/validate-skill-bundle.py:690`, which removes its own variable before running its self-tests in a temp dir.
- `subprocess` appears only in the validator's self-tests (`validate-skill-bundle.py:692, 728`), which run `bash -n` and fixtures.
- `scripts/session-start-scan.sh:140` lists directories up to 3 levels above the workspace to look for other observation logs. It only reads, but it does look outside its own folder.
- The plugin manifest has no hooks (`.claude-plugin/plugin.json`).

Things to watch:
- **Token cost.** SKILL.md:5 tells the agent to invoke it "before the FIRST tool call of any session". That loads about 684 lines on every session, which matters given the usage limits you keep hitting.
- **Self-entrenching.** SKILL.md:190-193 tells the agent to suggest adding a CLAUDE.md instruction. `references/environments.md:85-88` recommends a SessionStart hook. Say no to both unless you decide otherwise.
- License: CC-BY-4.0, which is fine.

**If adopted:** install it as a plain skill with no hook and no CLAUDE.md line, and invoke it by hand on long tasks only.

## 2. superpowers: Safe to consider

**What it is:** a plugin with about 14 workflow skills (TDD, debugging, plans, code review, and others) plus one hook.

Evidence:
- `hooks/hooks.json:3-14` sets one SessionStart hook. `hooks/session-start` reads `skills/using-superpowers/SKILL.md` locally and injects it as context wrapped in `<EXTREMELY_IMPORTANT>`. It makes no network calls and executes nothing else.
- The brainstorm server binds to `127.0.0.1` by default (`skills/brainstorming/scripts/server.cjs:100`, `start-server.sh:26`) and requires a session key (`server.cjs:180-187, 287`). It uses only Node built-ins (`server.cjs:1-4`).
- Minor: its page loads a logo image from `primeradiant.com` (`server.cjs:106`).

Things to watch:
- **Token cost and steering.** It injects the using-superpowers text into every session, and it pushes the agent hard toward running skills for everything.
- **The marketplace is wider than superpowers.** `obra/superpowers-marketplace` also lists other plugins, such as `superpowers-chrome` (line 23), `claude-session-driver` (line 84) and `private-journal-mcp` (line 94). Those were **not** reviewed. Adding the marketplace makes them one click away.

**If adopted:** install only the `superpowers` plugin, or copy the 2-3 skills you actually want (for example systematic-debugging and verification-before-completion) without the hook.

## 3. impeccable: Risky

**What it is:** a frontend-design skill with 24 sub-commands, plus a Rust "engine" binary, hooks, live-browser scripts and agents.

Evidence:
- **Hooks run a binary all the time.** `.claude/settings.json:4, 16, 29` and `plugin/hooks/hooks.json` run `scripts/impeccable hook` on SessionStart, on every `Edit|Write`, and on Stop (with a 30 s deep pass).
- **The binary is downloaded at run time.** `.claude/skills/impeccable/scripts/impeccable:96-99, 122-125` fetches `https://github.com/pbakaus/impeccable/releases/download/engine-v<ver>/impeccable-<os>-<arch>` with curl or wget into a user cache, then executes it.
- The checksum is real but comes from the same origin (`impeccable:150-178`). A `.sha256` sidecar fetched from the same release protects against corruption, not against a compromised release. It does fail closed when the sidecar is missing.
- **The binary can be overridden.** `impeccable:41-42` executes `$IMPECCABLE_BIN` without checks, and `IMPECCABLE_DOWNLOAD_BASE` (line 122) can redirect the download. The launcher also falls back to any `impeccable` on PATH.
- The live mode injects `live.js` into your page and talks to a localhost server with a token (`scripts/live-browser.js:4, 3825, 4142`).
- The engine source is published (`crates/`, `Cargo.toml`), so it can be built and audited, but that was not done here.
- claude-skill-antivirus gave it **SAFE 100/100**, which is the CVE blind spot.

**If adopted:** use only the SKILL.md and reference/*.md text, with no hooks and no binary. Otherwise build the engine from source at a pinned tag.

## 4. claude-mem: Risky

**What it is:** a large memory system (about 2,400 files) made of a plugin with hooks, a background worker service, SQLite storage, an MCP server, and an installer with OAuth pairing.

Evidence:
- **Hooks on everything.** `plugin/hooks/hooks.json` hooks Setup (line 4), SessionStart (17), UserPromptSubmit (61), PostToolUse with `matcher "*"` (77-79), PreToolUse (113), Stop (130) and SessionEnd (147). It sees every prompt and every tool input and output. In OMEGA that would include anything you paste, such as keys or PINs, and file contents.
- **Shipped code is minified bundles.** For example `plugin/scripts/worker-service.cjs` is 3.4 MB. The `src/` tree is public, but what actually runs is a build you can't easily read.
- **It sends your session to an LLM.** Providers are claude, gemini or openrouter (`src/shared/SettingsDefaultsManager.ts:172, 187`), and it reads `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `OPENROUTER_API_KEY` (`src/shared/EnvManager.ts:83-89`). This spends tokens on every compression, which is the opposite of the Token Shield goal.
- **Telemetry is ON by default.** `src/npx-cli/commands/telemetry.ts:1-5` says it is opt-out and anonymous, and it goes to `https://us.i.posthog.com` (`src/services/telemetry/common.ts:21`). The listed fields are versions, OS, counts and costs, and the file says it never sends queries or messages. You can turn it off with `CLAUDE_MEM_TELEMETRY=0` or `DO_NOT_TRACK=1`.
- The worker binds to `127.0.0.1` by default (`SettingsDefaultsManager.ts:404`), which is good. It can be changed through settings, and `SettingsDefaultsManager.ts:309` mentions exposing `/tv` and `/stream` routes.
- Its install dependencies include a native `tree-sitter-cli` that is marked `trustedDependencies`, so it runs install scripts (`plugin/package.json`).

**Recommendation:** don't install it. OMEGA already has project memory and the Oracle and Sentinel stack. If memory is needed later, build a small local version.

## 5. find-skills: Block

**What it is:** a SKILL.md that drives the `npx skills` CLI from the skills.sh registry.

Evidence:
- **Auto-install without confirmation.** `skills/find-skills/SKILL.md:97-103` tells the agent it can run `npx skills add <owner/repo@skill> -g -y`, which installs globally and skips the confirmation prompt.
- **Trust is based on popularity, not review.** `SKILL.md:69` says to prefer skills with "1K+ installs". The download count is the only gate.
- **`npx` runs whatever version of the CLI is latest** at the moment it is called. There is no pin.
- **Telemetry is on by default.** `src/telemetry.ts:1` sends to `https://www.skills.sh/tele/t` (send at line 173). Events include search queries (`FindTelemetryData.query`, lines 41-46) and install sources. You can turn it off with `DISABLE_TELEMETRY` or `DO_NOT_TRACK` (lines 86-87).
- In fairness, the CLI checks a remote "audit" API before installing (`telemetry.ts:108-135`), but it does not block on the result ("never blocks installation").

**Why block it:** it directly undoes the rule you set today ("لا تركّب شي قبل موافقتي", meaning "don't install anything before I approve"). Search skills.sh by hand in a browser instead.

---

## Method
- Shallow `git clone` of each repo into a scratch directory. No `npm install` in any skill repo, and no script from any skill was executed.
- Manual grep and reading of manifests, hooks, scripts, network calls, env and key access, and install-time code.
- claude-skill-antivirus 2.1.3 was run scan-only with `--ignore-scripts` and a fake `HOME`.
- No Snyk or other third-party figures are cited. The only external claim used is CVE-2026-84810 from osv.dev.

## Cleanup
The scan clones, the antivirus package and its fake HOME were deleted from the scratch folder on 2026-10-15. Nothing was ever installed.

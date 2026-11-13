# Security review: replica-cyber-recon skill (ADR-138)

Date: 2026-11-05 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked for a defensive "cyber recon" skill for Jarvis: leaked keys, unsafe code, developer manifests and file integrity, «بمكتبة Python القياسية فقط … تجتاز SkillSpector بنتيجة 0 حرج، 0 عالي». AGENTS.md §1 needs a written review before a skill is added. The skill is **new code written in this repo**: no third-party file was copied and nothing was installed.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-cyber-recon/SKILL.md` | 49 | 88139330ad51482e | Rules, the four commands, the giant-core section |
| `rcommon.py` | 80 | 7f34b9d04ff0fa32 | Path containment, file walk, size cap, Shannon entropy, output |
| `secret_audit.py` | 82 | e403da894a229973 | Known key shapes plus entropy of assigned values; prints the first four characters only |
| `static_guard.py` | 187 | c9495c0f9c8638fd | Web and text rules, CSP checks, Python `ast` checks, reviewed marker, rule-block skip |
| `manifest_parse.py` | 187 | 032b701507f4f3ea | openapi.json, llms.txt, security.txt (RFC 9116), robots.txt into tables |
| `sbom_integrity.py` | 76 | dd89c27f21c4797c | Write and verify `SBOM.sha256.json` |
| `tests/test_cyber_recon.py` | 162 | 3e035ccd482038f6 | 12 unit tests |

## 2. What the code can and cannot do

**Imports.** Standard library only: `argparse`, `ast`, `collections`, `datetime`, `hashlib`, `json`, `math`, `os`, `re`, `sys`; the tests add `contextlib`, `io`, `tempfile`, `unittest`. There is no `subprocess`, `socket`, `urllib`, `http`, `ctypes`, `pickle`, `eval`, `exec`, `compile` or `importlib`.

**No network, no process, nothing executed.** Every tool reads files that are already on disk. Python is parsed with `ast.parse` and never imported or run; HTML and JavaScript are matched line by line. Fetching a manifest is the Jarvis server's job (one GET, robots.txt, private addresses refused, ADR-134).

**Reads.** Only paths given on the command line, after `os.path.realpath` shows they stay inside `--root`; symlinks out of the root are refused; files over 2 MB are skipped.

**Writes.** `manifest_parse.py --out` and `sbom_integrity.py write`, both inside `--root` only. Nothing else is written.

**Secrets.** `secret_audit` prints a match as its first four characters plus `…` and the rule name. It never logs a full value. The test fixtures build key-shaped strings at run time, so the repository holds none.

## 3. Findings and how they were handled

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict .claude/skills/replica-cyber-recon` | 0 critical, 0 high, 0 medium, 0 low |
| `ruff check .claude/skills/replica-cyber-recon` | all checks passed |
| `python3 -m unittest discover -s tests` | 12 tests OK |

The skill's own rule lists contain the phrases it detects. They sit between SkillSpector's rule markers, which SkillSpector blanks before scanning. `static_guard` now does the same, and it **reports every skipped block** as a low `rule-block` finding with its line count and size. A marker therefore cannot hide text without anyone seeing it. A test proves both halves: an instruction-override phrase inside a block is skipped and reported, and the same phrase outside it is still a high finding.

Bugs found while writing the tests and fixed:
1. The CSP regex stopped at the first quote inside the policy (`'self'` inside `"…"`). It now reads to the matching quote.
2. `openapi.json` operations with an empty `requestBody: {}` were read as having no body. It is now `"requestBody" in op`.

Dogfood on this branch: `secret_audit` over `jarvis/server/lib`, `jarvis/app/src` and both new skills found 0. `static_guard` over `jarvis/server`, `jarvis/app/index.html` and both skills gives 0 critical, 0 high, 2 medium, 3 low and 4 reviewed:
- **2 medium:** the lock word lists in `llm-plan.mjs` and the page, which are meant to be there.
- **3 low:** rule blocks.
- **4 reviewed:** the four column-allowlisted update helpers in `store.mjs` and `missions.mjs`.

## 4. Limits, said plainly

- Pattern and entropy checks miss secrets with unusual shapes and flag some random-looking test data. They are a gate before review, not a replacement for it.
- `static_guard` is not a taint analyser. A sink reached through an alias is missed. The CSP check reads the meta tag only, not HTTP headers.
- The reviewed marker downgrades a finding to "reviewed". It never removes the finding. A person must still read the reason.

## 5. Decision

Added as a project skill under `.claude/skills/replica-cyber-recon`. It is safe to run on Ahmad's machine as written: standard library only, no network, no process, and writes only inside `--root`. Any later change to these files needs a new review entry here. After this review, record the folder with `sbom_integrity.py write`, and run `verify` before use.

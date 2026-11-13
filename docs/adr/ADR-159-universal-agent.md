# ADR-159: The universal agent

Date: 2026-11-12 · Status: Proposed. Ahmad's message of 2026-11-12 asked for:
- a read-only security review of 13 outside projects: the seven agent-skill projects in the FOSS atlas (ADR-158), and DietrichGebert/ponytail, cloudflare/security-audit-skill, obra/superpowers, Graphify-Labs/graphify, Jakeschincariol/replica-skill and cheaper-inference/OmniRoute;
- his approval, quoted: «أوافق رسمياً على دمج القواعد المعرفية والخوارزميات النقية (Pure-JS / Pure-Python Deterministic Rules) التي تجتاز مراجعتك الأمنية وفحص SkillSpector بنتيجة (0 حرج و 0 عالٍ) داخل محرك السيرفر والموقع مباشرة دون تشغيل أي أوامر تثبيت شبكية (npx أو npm -g أو pip install) ودون أي تزييف لبصمات TLS أو الكوكيز (Zero OAuth Spoofing)»;
- a universal agent with the same answers in Node and Python:
  - a model router for OmniRoute on localhost:20128 and the claude-fable-5-2 and claude-mythos-5-2 request rules;
  - a catalogue of free models and their benchmarks;
  - the score `0.25·Health + 0.20·QuotaRemaining + 0.20·ZeroCostBonus + 0.15·SpeedScore + 0.10·TaskFit + 0.10·Stability` with a circuit breaker below 0.20;
  - context compression and a Context Relay handoff;
  - Ponytail and Superpowers TDD, Cloudflare's six-phase security audit, Graphify's EXTRACTED / INFERRED edges with weakest-hop confidence, and Replica design with no gradient and OKLCH contrast;
- a bilingual page with 0 purity violations.

## Decision

1. **The review** is `docs/security/THIRD-PARTY-SKILLS-REVIEW-2026-11-12.md`. The READMEs and licence files were read as text, and nothing was installed or run. SkillSpector found 6 critical findings in the projects' own text: five pipe-to-shell installers and one false positive. That is why none of their install steps are followed.
   - **Taken in:** text rules from five projects, written fresh into this repository's code: the ponytail lean ladder, Cloudflare's verdicts and phases, graphify's edge labels, superpowers' tests-first rule (already in ADR-143), and the reviewed replica skills (ADR-132 to ADR-134).
   - **Not installed:** the other projects, OmniRoute included. The register is the agent catalog's `reviewed` list, `installed: false` on every row.
   - **Status:** Ahmad asked for «مُراجَعة ومُعتمدة ومُدمجة محلياً». The page says "Rules adopted" where rules were written in, and "Not installed" or "Reference only" elsewhere. "Integrated" would claim an install that did not happen.
2. **The engine** is `jarvis/server/lib/universal-agent.mjs` (pure, inlined into the page in its own scope). Its twin is `.claude/skills/replica-universal-agent/universal_agent.py` (standard library only). Both hold the same nine modes:
   - **`catalog`:** the five Claude models with context, output, price per million tokens, default effort and whether a forced tool choice is accepted. The figures come from the claude-api skill's table (cached 2026-11-03, read 2026-11-12). The other 17 model names in the request could not be checked from the sandbox, so they show «تعذر التحقق منها» with no number. The claimed benchmarks are not shown.
   - **`request`:** builds a Messages body `{model, max_tokens, output_config: {effort}, messages}`. temperature, top_p, top_k, `thinking` and a forced tool choice on a model that refuses it are dropped and listed. The request's draft put effort inside `thinking`; the API takes it in `output_config.effort`.
     - The plan sends nothing. A hosted send is a locked outbound approval (ADR-141). A loopback gateway such as OmniRoute adds a locked install, because it is an unreviewed install. Both steps are proved with `prover.mjs`, and `sent` is always false.
   - **`route`:** the six-factor score; a health below 0.20 trips the breaker.
     - Zero cost counts only when cost is exactly 0. An unknown cost is `null` and earns nothing. A repeated id is refused.
     - A hosted choice is "locked", a `local: true` one is "127.0.0.1 only". The result is tagged [INFERENCE].
   - **`relay`:** goal, done, next, decisions and files as one handoff summary that ends with the repository's rules.
   - **`compress`:** drops repeated lines, trailing spaces and runs of blank lines. It reports characters saved, not tokens, and claims no ratio it did not measure.
   - **`security`:** each candidate gets one verdict:
     - rejected, when disproved;
     - needs_validation, with no verifier or a verifier who is also the finder;
     - hardening_note, when an earlier layer already prevents it;
     - needs_validation, without a boundary failure and a source trace, with its unresolved fact;
     - confirmed, with severity from likelihood × impact (high ≥ 0.6, medium ≥ 0.3).
   - **`graph`:** the shortest path. An INFERRED edge needs a confidence, and the path's confidence is its weakest hop.
   - **`lean`:** the six-rung ladder. A risky untested unit is must-fix; a new dependency needs a review.
   - **`design`:** the reversal engine's template rules (ADR-150, ADR-153) with the SHA-256 of the result.
3. **The server:** `POST /api/w/:slug/agent/universal`. The event log records `agent.universal` with the mode only.
4. **The page:** `#/universal`, titled "Universal agent", with:
   - a mode control with an example for each mode, a JSON field and Check;
   - each answer rendered (locked steps «بانتظار الموافقة», the ranked table, verdict badges, the path) with the whole answer as JSON;
   - the model table and the review register with each licence file linked.
   - In sample mode the page runs the same engine. `#/agent` is not used because it is already the agent editor.
5. **Parity:** `tests/golden.json` holds 180 requests with the server's answers, the edges of every limit included. The Python suite, the server tests and both mutation oracles check it. The largest limits are built in the oracles.

## Consequences

- No model is called. The agent plans, checks and proves; sending needs the locks to be lifted by Ahmad.
- OmniRoute and every other outside project stay outside until a written review of a pinned version and Ahmad's approval.
- The mutation list in CLAUDE.md (ADR-146) adds `universal-agent.mjs` and `universal_agent.py`.

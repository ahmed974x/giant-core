---
name: replica-universal-agent
description: A universal agent that plans and checks but never calls a model - a Claude request builder that moves effort into output_config and drops the fields the current models refuse (temperature, top_p, top_k, budget thinking, a forced tool choice where it is rejected), a model router with the six-factor score and a circuit breaker below 0.20, a Context Relay handoff summary, a line compressor that reports characters saved, a security triage with Cloudflare-style verdicts, a graph path whose confidence is its weakest hop (EXTRACTED or INFERRED), a lean ladder for new code, and a design pass through the reversal engine. Every send to a model is a locked approval step, proved. Standard-library Python only; no network, no processes.
---

# replica-universal-agent

```bash
python3 .claude/skills/replica-universal-agent/universal_agent.py '{"mode":"catalog"}'
python3 .claude/skills/replica-universal-agent/universal_agent.py '{"mode":"request","model":"claude-fable-5-2","temperature":0.2}'
python3 .claude/skills/replica-universal-agent/universal_agent.py - < route.json
python3 -m unittest discover -s .claude/skills/replica-universal-agent/tests
```

| Mode | What it does | How it stays honest |
| --- | --- | --- |
| `catalog` | the five Claude models with context, output, price per million tokens, default effort and whether a forced tool choice is accepted; 17 other model names from the request | Claude facts come from the claude-api skill's table (cached 2026-11-03, read 2026-11-12). The other names carry no numbers and say «تعذر التحقق منها» |
| `request` | the Messages body: `model`, `max_tokens`, `output_config.effort`, `messages` | removed fields are listed in `dropped`; the plan's send step is a locked outbound approval and a local gateway is a locked install, proved by `replica-formal-verify`; `sent` is always false |
| `route` | `0.25·health + 0.20·quota + 0.20·zero-cost + 0.15·speed + 0.10·fit + 0.10·stability`, ranked; a score below 0.20 trips the breaker | the scores are the ones you give, tagged [INFERENCE]; unknown cost is null, never zero |
| `relay` | goal, done, next, decisions and files as one handoff summary | counts are counted, not estimated |
| `compress` | drops repeated lines and runs of blank lines | reports characters saved, not tokens |
| `security` | confirmed, needs_validation, rejected or hardening_note per candidate; severity from likelihood × impact | a candidate needs a verifier who is not its finder, a boundary failure and a source trace |
| `graph` | shortest path between two nodes | an INFERRED edge needs a confidence; the path's confidence is its weakest hop |
| `lean` | six ladder rungs, from "does it need to exist" to "write it, with tests" | risky untested units are must-fix; a new dependency needs a review |
| `design` | the reversal engine's template rules (gradient, glass fallback, overflow-wrap, contrast) | SHA-256 of the corrected CSS |

The same engine runs in Jarvis (`jarvis/server/lib/universal-agent.mjs`, `POST /api/w/:slug/agent/universal`, the `#/agent` page). `tests/golden.json` holds the server's answers and both test suites check it.

## Limits

- It never sends a request. Hosted endpoints stay locked (ADR-141) and a local gateway such as OmniRoute is an install that needs a written review and Ahmad's approval (AGENTS.md §1).
- Benchmarks and free-tier claims for the other models were not verified from this sandbox, so none are shown.
- The ladder, the verdicts and the edge labels are text rules taken from obra/superpowers, DietrichGebert/ponytail, cloudflare/security-audit-skill and Graphify-Labs/graphify; none of their code or hooks are installed.

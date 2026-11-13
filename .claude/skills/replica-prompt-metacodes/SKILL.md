---
name: replica-prompt-metacodes
description: Five prompt meta-codes that change what the answer holds and never turn a request away - ALT3 (three plans - the fastest slice, the most careful with tests, mutation and contrast first, and self-hosted on this computer), KILLCRITIC (findings against the repository's gates - AGENTS.md section 1 locks, pasted secrets, private and public addresses through the SSRF shield, the blue to purple gradient, WCAG and APCA contrast with a healed colour - each with its fix), X10THINK (four stages - assumptions, model, reverse check, edge cases), EL10 (one plain sentence per plan) and /HUMAN (one short paragraph). Every money, publishing, permissions, install or outbound step is a locked approval, and every plan is proved. English or Arabic. Standard-library Python only; no network, no processes.
---

# replica-prompt-metacodes

```bash
echo '{"prompt":"ALT3 KILLCRITIC deploy it and add a payment gate","lang":"en"}' | python3 .claude/skills/replica-prompt-metacodes/prompt_metacodes.py -
python3 -m unittest discover -s .claude/skills/replica-prompt-metacodes/tests
```

Request: `prompt` (text, up to 4,000 characters; codes may be typed in it), `codes` (a list of the codes pressed), `lang` (`en` or `ar`). With no code, ALT3 is used.

| Code | What it adds | How it is checked |
| --- | --- | --- |
| `ALT3` | three plans: `speed`, `proof`, `selfhost` (without ALT3, only `selfhost`) | `prove_option`: each approval step is `{gate: "approval", locked: true, status: "pending_approval"}` with a sensitive category, no other step is sensitive, each step follows the one before |
| `KILLCRITIC` | findings with a level (high, medium, low, ok, manual) and their data | locks from the same words as Jarvis's plan rules; secret-shaped text removed from the copy; private addresses named as refused; the first two `#hex` colours measured and healed by the reviewed `replica-reversal-engine` maths |
| `X10THINK` | four stages with their counts | the counts come from the request; nothing is guessed |
| `EL10` | one plain sentence per plan | fixed sentences |
| `/HUMAN` | one short paragraph | fixed sentences with the counts |

The plans are fixed rules and carry `[INFERENCE]`; they are not a model's opinion. The same engine runs in Jarvis (`jarvis/server/lib/prompt-metacodes.mjs`, `POST /api/w/:slug/metacodes/compile`, the meta-codes panel in the Studio, the Math lab and Missions). `tests/golden.json` holds the server's answers to 19 requests, and both give the same JSON and the same SHA-256.

## Limits

- The words that make a step sensitive are a fixed list in English and Arabic; a request that hides an action in other words is not caught by the critic, but nothing here runs any step.
- The three screen sizes and the 27 UI states cannot be checked from text; the critic says so every time.
- Only the first two colours and the first 20 addresses are read.

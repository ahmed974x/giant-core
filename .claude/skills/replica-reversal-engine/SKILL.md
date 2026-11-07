---
name: replica-reversal-engine
description: Corrects a plan or a page template by the repository's rules and says exactly what it changed - a money, publish, permissions, install or outbound step that is not a locked approval becomes {gate approval, locked, pending_approval}; a gradient becomes one colour (blue to purple flagged as the AI gradient); glass gets a prefers-reduced-transparency fallback; long words get overflow-wrap. SHA-256 of before, after and the corrections. Standard-library Python only; no network, no processes.
---

# replica-reversal-engine

```bash
python3 .claude/skills/replica-reversal-engine/reversal_engine.py plan plan.json
python3 .claude/skills/replica-reversal-engine/reversal_engine.py template page.html --out page.fixed.html
python3 -m unittest discover -s .claude/skills/replica-reversal-engine/tests
```

| Function | What it corrects | Proof |
| --- | --- | --- |
| `reverse_and_correct_plan` | Each step whose words (English or Arabic) or category name money, publishing, permissions, installs or outbound messages, or that claims a lock without a reason, becomes a locked approval: `{"gate": "approval", "locked": true, "status": "pending_approval"}`. Other steps are kept as written | every sensitive step is locked and pending; the server's copy also runs `prover.mjs` |
| `reverse_and_correct_template` | A declaration with a gradient becomes its first colour stop (`background` → `background-color`, others → `none`); glass without a fallback gets `@media (prefers-reduced-transparency: reduce)` with a solid `Canvas` background; text gets `overflow-wrap: anywhere` | running it again finds nothing |

Every result has `corrections` (one entry per change, with what it was), a correction vector (count per rule, in a fixed order), and `before`, `after` and `proofHash` (SHA-256 of before, after and the corrections). The hashes match `jarvis/server/lib/reversal.mjs` for the same input.

## Limits

- The engine corrects; it does not decide. A locked step still waits for Director 00, and nothing it writes is sent anywhere.
- Gradients are replaced with one stop's colour, which may not be the colour you want. Check the copy before you use it.
- The CSS reading is plain pattern matching, not a full parser. Rules inside `@supports` or deeply nested blocks may be missed.

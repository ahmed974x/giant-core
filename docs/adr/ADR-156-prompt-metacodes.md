# ADR-156: Prompt meta-codes: three plans that always answer, locks by rule

Date: 2026-11-07 · Status: Proposed. Ahmad's message of 2026-11-07 asked for:
- a skill `.claude/skills/replica-prompt-metacodes/` and a server engine `jarvis/server/lib/prompt-metacodes.mjs`;
- five codes, `/HUMAN`, `EL10`, `X10THINK`, `KILLCRITIC` and `ALT3`, read in one O(N) pass;
- ALT3: three options, one for speed, one for precision with proof and [VERIFIED], and one self-hosted at no cost;
- KILLCRITIC: the gates (AGENTS.md §1 locks, APCA and WCAG contrast, the UI states, SSRF, no blue to purple gradient, three sizes), each with its fix;
- X10THINK: four stages; EL10 and /HUMAN: plain, natural text in the chosen language;
- a button bar in the Studio, the Math lab and the council (Missions);
- `POST /api/w/:slug/metacodes/compile`, behind `x-jarvis: 1`;
- the same SHA-256 from JavaScript and Python.

## Decision

1. **`jarvis/server/lib/prompt-metacodes.mjs`** (pure; inlined into the page with the council's libraries).
   - **Reading:** one pass over the characters splits words on space, tab and line breaks. A word whose upper case, without trailing `. , ; : ! ? ، ؛`, is one of the five codes is taken out; the rest is the request. `/HUMAN` needs its slash. Text is cut at 4,000 characters (code points, so JavaScript and Python cut at the same place). Codes may also be pressed (`codes: [...]`). With no code, ALT3 is used.
   - **No refusal:** every request gets plans. Nothing is turned away, and nothing is run.
   - **Locks:** the request is matched against the lock words of `llm-plan.mjs` in English and Arabic (money, publishing, permissions, installing, outbound messages). Each category found adds one step `{kind: "approval", gate: "approval", locked: true, status: "pending_approval"}` to every plan.
   - **ALT3's three plans** (fixed rules, `[INFERENCE]`):
     - `speed`: read, build the smallest slice, run the tests;
     - `proof`: read, write the tests and the oracle first, build, run the tests, the mutation harness to 100 %, the contrast check;
     - `selfhost`: read, build on 127.0.0.1 with no hosted service, run the tests and SkillSpector, export files you keep.
     Without ALT3 only `selfhost` is given.
   - **Proof:** `proveOption` checks that every approval step is locked, waiting and has a sensitive category, that no other step is locked or sensitive, and that the steps form one chain. The answer is `verified` only when every plan is proved.
   - **KILLCRITIC:** findings with a level, each saying what to do:
     - the locks found (high) or none (ok);
     - secret-shaped text (`sk-`, `ghp_`, `AKIA`, `xox?-`): removed from the copy, counted, "revoke it" (high);
     - private addresses (localhost, IPv6 literals, 10/8, 127/8, 0/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10): refused by the SSRF shield (high);
     - public addresses: read only through the SSRF shield, one GET, robots.txt obeyed (low);
     - the word gradient: one solid accent, no blue to purple gradient (medium);
     - the first two `#hex` colours: measured with the ADR-153 healer; if they fail, the healed text colour with WCAG and APCA before and after (high), or "change the background" when no lightness passes;
     - every time: the three sizes and the 27 UI states cannot be checked from text, run them before a commit (manual).
   - **X10THINK:** assumptions (words, clauses, addresses, colours, categories), model (the plans and their step counts), reverse check (each plan proved or not), edge cases (cut, refused addresses, secrets removed).
   - **EL10:** one plain sentence per plan. **/HUMAN:** one paragraph with the counts.
   - **Language:** every sentence is in `MC_TEXT` as English and Arabic; the Arabic says «المدير 00» as the page does.
   - **SHA-256:** over the answer without its own `sha256` field, as `JSON.stringify` writes it.
2. **`POST /api/w/:slug/metacodes/compile`.** `{prompt, codes, lang}`; `?lang=ar` or `body.lang`. The usual write rules apply (`x-jarvis: 1`, same origin, JSON, 64 KB). A prompt that is not text is a 400 in the language asked for. Each compile is a `metacodes.compile` event.
3. **The panel.** One panel, «Meta-codes», in Missions (under the council), the Studio and the Math lab:
   - five toggle buttons with `aria-pressed`, ALT3 pressed;
   - the request, prefilled with an example for that page;
   - the answer: [VERIFIED], the SHA-256's first 16 hex digits, the three plans as cards with «بانتظار الموافقة» on each locked step, the critic, the stages and the paragraph.
   The page asks in its own language. In Arabic, each Latin run in the engine's sentences (WCAG 4.5, SkillSpector) is isolated the way translated sentences are.
4. **`.claude/skills/replica-prompt-metacodes/prompt_metacodes.py`.** The same engine in the standard library. Contrast comes from the reviewed `replica-reversal-engine` beside it, so the healed colours match. Regexes use ASCII word boundaries, as JavaScript's do. URLs are matched on printable ASCII only, so `\s` differences between the two languages cannot matter. JSON is written as `JSON.stringify` writes it. `tests/golden.json` holds the server's answers to 19 requests, SHA-256 included.
5. **Mutation run.**
   - `prompt-metacodes.mjs`: 150 / 150 killed.
   - `prompt_metacodes.py`: 172 / 172 killed, 2 equivalent. Both equivalents are `count=1 → 2` on an anchored `re.sub`, which replaces at most once.

Review: `docs/security/PROMPT-METACODES-REVIEW-2026-11-07.md`.

## Consequences

- The plans are fixed rules, not a model's opinion; they say so with `[INFERENCE]`.
- "Speed", "precision" and "zero cost" are not given as measured numbers. No latency, saving or sovereignty figure is printed, because none was measured.
- The critic reads words. A request that describes a payment in other words is not flagged by it; nothing here runs a step, and the mission and council paths keep their own locks (`enforceApprovalGates`).

## Checks

The results are in the PR body:
- server tests on SQLite and PostgreSQL 16;
- `test-app.mjs` F38 and the live block;
- skill unit tests and ruff;
- the mutation run;
- the bilingual purity gate with the meta-codes result screen;
- SkillSpector, contrast, three sizes, retina screenshots and parity.

# One brain: a free, open-source, local-first assistant that joins the chat style of Claude, ChatGPT and Grok

Status: research and proposal, 2026-10-16 · Partly built: step 1 (`/brain` page, extractive answers, citations, disclosure) is merged; providers, router and tools are not built yet (section 7).
Ahmad's ask (coordinator relay, 2026-10-16): "research an open-source one-brain (Claude-, ChatGPT-, Grok-style merged,
free, local-first), propose a design, and add it to the website build". This document is the proposal. The build waits
for his go.

## 1. What "one brain" means here
One chat surface, one memory, several model providers behind it, with the local model first. The user chats in one
place; the router picks a model; the answer cites where it came from; nothing leaves the laptop unless the user turns
on a provider. It reuses what already exists: the second brain (ADR-081), the memory keeper (ADR-080), the brain loop
(ADR-082) and the Oracle (local Qwen, SearXNG).

## 2. Candidate bases, checked from primary sources where the session allowed

| Project | Licence (checked) | Source of the check | OSI open source | Fit | Verdict |
|---|---|---|---|---|---|
| Open WebUI | Open WebUI License: BSD-3 through v0.6.5; v0.6.6+ adds a branding clause | docs.openwebui.com/license | No (v0.6.6+ is not OSI-approved) | Strong UI, many providers | Not as a base: branding must stay visible above 50 users |
| AnythingLLM | Footer of docs.useanything.com reads "MIT 2026 © Mintplex Labs"; its cloud terms page says it does not cover self-hosting and names no software licence | docs.useanything.com (footer and cloud terms) | Unconfirmed (footer only) | Local documents, workspaces | Candidate for the document side; the licence is not confirmed from the official site |
| LibreChat | MIT: "LibreChat is released under the MIT License" (about page); the terms page repeats it for the self-hosted application | librechat.ai/about, librechat.ai/tos | Yes (MIT) | Multi-provider chat | Candidate; MIT confirmed from the official site |
| LobeChat | Not named on lobehub.com (page calls the repository "Community Edition" and names no licence) | lobehub.com | Unverified | Polished chat UI | Candidate; the licence needs the official LICENSE text, not checked here |
| Jan | "Free & Open source" on jan.ai; the handbook names no licence and shows "All rights reserved" in the footer | jan.ai, jan.ai/handbook/why/open-source | Unverified | Local desktop app | Candidate; the licence is not confirmed from the official site |

Checked 2026-10-16 from official project sites only, with no repository access. Last commit dates and the LICENSE files were not read. Before any candidate is adopted, someone checks the LICENSE file (SPDX id), the last push date, open security advisories, and whether the project is archived.

## 3. Recommendation
Do not build on a fork of Open WebUI. Build a thin one-brain shell that we own, and borrow ideas, not code, from the
chat projects. Use LibreChat (MIT, confirmed on its site) only after its LICENSE file is read. Use AnythingLLM only if its software licence is confirmed; its site shows only an MIT footer. Keep every model call behind the
existing relay with the same limits (no keys in the browser, no provider called without the owner's switch).

## 4. Design
- **Surface:** one chat page at `/brain`, Arabic first, dark neural style, with a visible AI disclosure banner (as on
  `/mind` and `/offices`). Each answer lists its sources, and every source link opens its evidence.
- **Router:** local model first (Qwen via the Oracle/Cortex path), then the free tiers already in the Oracle design
  (Groq, Cerebras, Gemini) only when the owner has put a key in the keys vault. No paid route.
- **Memory:** reads the second brain (`brain.read`) and the memory keeper (`mem.search`), writes only through the
  existing capture path, so the same secret refusal applies.
- **Tools:** search through SearXNG (tainted results, never driving a write), the Oracle for answers with sources, the
  loop for multi-step questions (ADR-082). No tool in this chat can propose a trade; proposals stay with فهد (ADR-083).
- **Privacy:** the local model is the default; a message goes to a provider only after a per-provider switch the owner
  set, and the page shows which provider answered.

## 5. Not in this design
- Real money, trading or any order path. The paper gate (ADR-083) is the only route to a proposal.
- Any CAPTCHA or anti-bot bypass.
- Copying a closed product's behaviour or prompts.

## 6. Next steps (waiting for Ahmad's go)
1. Verify the LICENSE and last-commit date of the candidates (needs repo access, or his go to add the repos).
2. Add the provider router behind per-provider switches (local model first, then the free tiers only with a key in the vault).
3. Let `/brain` call the local generator (Qwen via Cortex) for generated answers, keeping the citation check.

## 7. What is built and what is not (checked 2026-10-16)
| Item | Status | Where |
|---|---|---|
| `/brain` page: question box, citations, evidence links, AI disclosure (AR and EN) | Built, merged (PR #17, commit 05b0c83) | `dashboard/brain/index.html`, route in `services/relay/server.js` |
| Answers from the owner's own notes only, extractive | Built | `/mind/api/think`, ADR-081 |
| Second brain, memory keeper, brain loop | Built, merged | ADR-081, ADR-080, ADR-082 |
| Relay route `/brain` under the strict HTML CSP | Built | `PAGE_FILES` in `services/relay/server.js` |
| Local generated answers (Qwen through Cortex) | Oracle has local Qwen; `/brain` does not call it yet | Oracle phases 1 and 2 (ADR-077 design) |
| Provider router with per-provider switches (Groq, Cerebras, Gemini) | Not built | design section 4 |
| Tools (SearXNG search, loop for multi-step questions) from the chat | Not built | design section 4 |
| Live check of the answer with the mind service running | Not verified here; needs the laptop | `docker compose` mind profile |
| Candidate licence checks (LibreChat, LobeChat, Jan) | Not verified; no repo access | section 2 |

Nothing in this chat can propose a trade. The paper gate (ADR-083) is still the only route to a proposal.

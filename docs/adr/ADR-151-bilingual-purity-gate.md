# ADR-151: The bilingual purity gate

Date: 2026-11-07 · Status: Proposed. Ahmad's message of 2026-11-06 asked for:
- **Arabic mode** fully in Arabic, server details included (for example "712 passed, 0 failed" → "712 ناجح، 0 فاشل", "تم القضاء على 493/493 طفرة", "0 حرج، 0 عالي"), with technical identifiers isolated in `<bdi>`;
- **English mode** with no Arabic except the language button;
- the local model answering in the chosen language;
- an automated gate over every screen in both modes, with an evidence log in `jarvis/replica/evidence/`.

## Decision

1. **Identifiers isolated.**
   - **Translated sentences:** when the Arabic sentence keeps a Latin run (a path, a command, a product name), the translator puts that run in its own `<bdi dir="ltr" translate="no">` inside a `<span data-tr>`. Switching back to English restores the original text node. The elements are made with `createElement` and `textContent`; no HTML is parsed.
   - **Names and identifiers already kept as written** (`translate="no"`): they get `unicode-bidi: isolate`, which is exactly what `<bdi>` does, through one CSS rule.
2. **Server details translated.**
   - **Diagnostics:** the layer details are now interface text. The `data-i18n` attribute lets a number box (`.num`, `.mono`) be translated. New patterns cover every detail the server or the page writes: "744 passed, 0 failed", "1008/1008 killed [VERIFIED]", "critical 0, high 0", "11 of 11 refused, IPv6 spellings included", "9 states, 2 effects behind a lock", the bridge's "online / offline" lines, and the rest.
   - **Same treatment elsewhere:** Analytics, mission step counts, the governance map's counts, Studio badges, licence notes, quality findings, the reversal log's hash line and Skill Loader history notes.
   - **Nested lookup:** a pattern's captured groups are looked up in the dictionary too, so "Workflow: Review and release" becomes "مسار العمل: …" with the workflow's Arabic name.
3. **Data stays as written, marked with its language.**
   - **What counts as data:** memory episodes, event targets, snapshot labels, skill descriptions from `SKILL.md` and Skill Loader notes. Each is shown as written, with `lang` set from its script and `data-verbatim`. People's own words are not machine-translated.
   - **Proper names:** names such as "Allen Institute for AI" or "UI UX Pro Max" are marked `lang="en"`.
   - **English mode:** "Wikipedia (العربية)" becomes "Wikipedia (Arabic)".
4. **What English mode keeps in Arabic, and why.**
   - the language button `ع`;
   - the locked marks «قيد الموافقة» and «بانتظار الموافقة»: AGENTS.md §1 requires them as written;
   - the teaching label «مثال تعليمي — أرقام افتراضية»: DESIGN.md §6 requires it on screen;
   - Arabic data typed by a person.

   Each of these sits inside `lang="ar"` or `data-verbatim`, and the gate checks that.
5. **The local model answers in the chosen language.**
   - **Where:** chat, plans, the streamed answer and the council send the page's language. The bridge's system prompt adds "Answer in Arabic (Modern Standard Arabic); keep code, file paths, commands and product names as written", or "Answer in English".
   - **Designs:** no language line, since only their layout is kept.
   - **Locks:** the language changes nothing about locks; `enforceApprovalGates` reads Arabic lock words already.
6. **The gate** (`jarvis/scripts/bilingual-purity.mjs`, used by `test-app.mjs` F33 and `test-live.mjs`).
   - **When:** after every other flow, each screen, the agent page, a mission and the workflow editor is checked in both modes (22 in sample mode, 21 on the real server).
   - **Arabic mode:** every visible Latin text must be one of:
     - code;
     - data marked `lang="en"` or `data-verbatim`;
     - names and identifiers inside an isolating element, where a list item of several words may hold only names and identifiers.

     `aria-label`, `placeholder` and `title` must contain Arabic.
   - **English mode:** no Arabic outside `lang="ar"` and `data-verbatim`.
   - **Evidence:** the result goes to `jarvis/replica/evidence/bilingual-purity.log`, one section per mode.
   - **Diagnostics:** the proof layer gains "Bilingual purity gate", read from that file, on the server and in sample mode.
7. **Two translator fixes found by the gate.**
   - A `placeholder` on a `translate="no"` textarea is now translated: the field's value is data, but its placeholder is interface text.
   - The approvals count's `aria-label` ("2 waiting") is translated.

## Consequences

- **A new interface string now needs its Arabic line** for both gates to stay green: the older F15, and F33 / the live gate, which is stricter.
- **A new quality rule or licence note** shown on Governance or Settings needs a dictionary line, or the gate fails. That is the point of the gate.
- **Data is not translated.** An English memory note stays English in Arabic mode, marked as English for screen readers.

## Checks

The results are in the PR body. They cover:
- **Server tests** on SQLite and PostgreSQL 16, including the language line sent to the model for chat, plan and stream, but not design;
- **Flow tests:**
  - F33 in `test-app.mjs`, plus the older F15;
  - the live gate in `test-live.mjs`;
- **The evidence log:** 0 violations in either language, sample and live;
- **SkillSpector, contrast, the mutation run;**
- **Three sizes** in Arabic and English;
- **Retina screenshots** in pure Arabic and pure English;
- **Parity:** 100.0.

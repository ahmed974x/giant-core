# ADR-137: Jarvis parity 100 — workflows, full Arabic, analytics with creator mode, webhooks, and the last open rows

Date: 2026-11-05 · Status: Proposed. Ahmad's messages of 2026-11-05 asked for ADR-137 on `claude/replica-design-jarvis`, before PR #52 is merged. The goal: raise the weighted parity score from 90.4 to 100.0 by building:
- workflows S06 and S07, in pure SVG, with locked steps;
- the full Arabic interface, switching AR (RTL) and EN (LTR);
- analytics with creator zero-token mode, `subscriber_tiers` and `token_ledger`, any money action locked;
- webhooks signed with HMAC-SHA256, any outgoing one to the outside locked.

ADR-138 (skills, memory) and ADR-139 (live open-web search) follow as their own commits.

## Context

After ADR-136, `features.csv` had eleven rows open:
- **not built:** workflows S06 and S07, the Arabic translation, run comparison, the agent templates gallery, scheduled runs, webhooks, analytics;
- **partial:** server push, members and roles, cost per run.

A score of 100 means every one of them is built and tested, not only the four named.

## Decision

1. **Schema** (both engines, same names):
   - **`members_one_owner`:** a unique partial index, one owner per workspace.
   - **`schedules`:** every 5 to 10,080 minutes.
   - **`webhooks`**, with two constraints:
     - `webhooks_out_has_url`;
     - `webhooks_external_out_locked`: an outgoing hook can be active only towards `http://127.0.0.1:<port>/`.
   - **`webhook_deliveries`:** append-only.
   - **`billing_settings`:** `billing_settings_billing_locked`.
   - **`subscriber_tiers`:** `subscriber_tiers_draft_only`.
   - **`token_ledger`:** `token_ledger_creator_free`, append-only.
2. **Engine.**
   - `lib/platform.mjs` holds workflows, members, schedules (30-second timer, trigger `schedule`), webhooks, creator mode and plans, the ledger and analytics.
   - `lib/workflow-graph.mjs` holds the graph rules: Kahn's sort, levels become phases, incoming links become needs, locks by kind or by words in the title. It is shared with the page.
   - A workflow runs as a mission (template `workflow`) through `createFromPlan`.
   - Finished missions are sent, signed, to active local outgoing hooks.
   - Local-model use goes into the ledger at cost 0.
3. **Routes.** All are under `/api/w/:slug/`:
   - `workflows`;
   - `members`;
   - `schedules` and `agents/:id/schedule`;
   - `webhooks` (activate, pause, test, secret);
   - `billing` (tiers, request);
   - `analytics`;
   - `stream` (server-sent events).

   Plus `POST /api/hooks/:id` for signed incoming deliveries: browsers are refused, and the body is capped at 64 KB.
4. **Page.**
   - **Workflows** (S06 list) and the **SVG editor** (S07):
     - drag, arrow keys, an inspector;
     - links set as "needs";
     - live cycle errors and phase preview;
     - locked nodes drawn violet and dashed;
     - Run.
   - **Analytics:**
     - creator mode card;
     - four numbers;
     - SVG bars with HTML labels for runs per day, gate pass rate, agents, missions, tokens by engine and approvals.
   - **Webhooks:** create, show the secret, switch on (outside addresses become a locked «بانتظار الموافقة» card), test, deliveries.
   - **Settings:**
     - members (add, change role, remove; no invitation is sent);
     - plans and tokens (draft plans, «Turn on billing…» and «Activate…» as locked money requests, the ledger).
   - **Agents:** templates gallery (six), and a Schedule tab.
   - **Runs:**
     - a cost column (0);
     - a scheduled badge;
     - Compare two runs (`#/runs/compare/a/b`).
   - **Live updates** come over `EventSource`; the 1.5-second poll is the fallback.
   - **Tabs** keep the chosen tab across live redraws of the same page.
   - **Sample mode** (`file://`) runs workflows, members, schedules (stored, not run), plans, the ledger and analytics with the same rules. Webhooks need the server, so no secret ever reaches the browser.
5. **Arabic.**
   - **Dictionary:** `jarvis/app/src/i18n-ar.json`, inlined by the build. It holds 750 exact strings and 107 patterns for text with numbers or names, and patterns may nest dictionary words.
   - **Translator:** a `MutationObserver` translates every text node and `aria-label`, `placeholder` and `title` as the page draws them, and can switch back.
   - **Left as written:** names, code and data, meaning `translate="no"`, `code`, `.mono`, `.num` and the sandboxed preview.
   - **Switching:** the «ع / EN» button, or `?lang=ar|en`. It sets `lang`, `dir="rtl"`, Readex Pro, and dates as `ar-u-nu-latn` with Latin digits.
   - **Tests:** `test-app` F15 and a live check visit every screen in Arabic and fail on any English interface text left.
6. **Fixes found on the way:**
   - the planner box of a workflow mission said "Drafted by the fixed rules";
   - the tab memory first carried over to other pages;
   - the settings page lost its first panels while being edited (restored before commit).

Review: `docs/security/JARVIS-PLATFORM-REVIEW-2026-11-05.md`.

## Parity

`parity.py` reports **100.0 / 100, must-haves 34 of 34**. All 55 counted rows are `yes`. Two rows stay out of the score on purpose:
- another product's marketplace;
- agents that move real money.

## Consequences

- Money, publishing, permissions, installs and outbound messages now have database refusals in four places:
  - approvals;
  - mission steps;
  - webhooks;
  - billing and plans.
- The interface is fully bilingual. A new string needs a dictionary line, or F15 fails.
- Not done here: sending a webhook outside 127.0.0.1 (locked by design), and running schedules in sample mode (the server runs them).

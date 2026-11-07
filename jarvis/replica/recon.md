# Recon map: Jarvis (web)

Scope: an AI-agent workspace dashboard — manage agents, workflows, runs and
approvals from one console. Original product; only the **layout pattern** of
modern developer-platform dashboards is studied (left sidebar, project
switcher, dense central workspace, command palette), never any product's code,
copy, logo, icons or colours.
For: Ahmad (Director 00) first; later a product others can use.
Date: 2026-11-04
Written by `/replica-recon` (ADR-132); Studio and Skill Mixer added in ADR-133.

## Sources

The cloud sandbox has no browser session on any target, so no screenshots of
another product were taken (`replica/screens/` is empty on purpose). The map
below is built from widely shared, unownable dashboard conventions and from
this repository's own agent concepts (PRIME, helpers, missions, the approval
inbox), which Jarvis will eventually surface.

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Supabase Studio (open source, Apache-2.0) — layout pattern only | https://github.com/supabase/supabase/tree/master/apps/studio | sidebar of product areas, project switcher, settings at the bottom. Code not read or copied. |
| 2 | Vercel documentation — dashboard navigation as described in public docs | https://vercel.com/docs | team/project scope switcher, tabs per project, activity feed. No screenshots taken. |
| 3 | WAI-ARIA Authoring Practices | https://www.w3.org/WAI/ARIA/apg/patterns/ | contracts for dialog, menu, combobox, tabs, tree, grid |
| 4 | This repo: PRIME and the agent core | `omega-ops-room-v1/omega-core.html`, `scripts/lib/agent-core.mjs` (ADR-118, ADR-121) | missions, steps, retries, breakers, lessons, the approval gate |
| 5 | This repo: DESIGN.md, AGENTS.md | `DESIGN.md` | binding look, contrast gate, honesty rules |

## Core loop

Create an agent, give it a workflow, run it, watch the run step by step, and
approve or reject anything it wants to do outside its sandbox. Second loop
(ADR-133): design a website live in the Studio, and mix the installed skills
into a build plan.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Shell | every route | sidebar, top bar, workspace switcher, command palette, content slot | Sidebar, TopBar, WorkspaceSwitcher, CommandPalette, Breadcrumbs | expanded, collapsed (icon rail), mobile drawer, RTL |
| S02 | Overview | `/` | health at a glance: active agents, runs today, approvals waiting, failures | StatTile, RunsChart, ActivityFeed, ApprovalBanner | empty (first run), loading (skeleton), filled, partial data, error |
| S03 | Agents list | `/agents` | every agent with status, model, last run | Table, StatusDot, FilterBar, SearchField, Button | empty, loading, filled, filtered-empty, error |
| S04 | Agent detail | `/agents/:id` | one agent: config, tools, memory, runs | Tabs, KeyValue, ToolChip, CodeBlock, RunsTable | idle, running, paused, failed, archived |
| S05 | Agent editor | `/agents/new`, `/agents/:id/edit` | create or edit: name, role prompt, model, tools, limits | TextField, Textarea, Select, Switch, Checkbox list, Dialog (discard) | pristine, dirty, saving, validation error, saved toast |
| S06 | Workflows list | `/workflows` | pipelines of agent steps | Table/Card grid toggle, Badge, Button | empty, filled |
| S07 | Workflow canvas | `/workflows/:id` | steps as nodes and edges; inspector on the right | Canvas, Node, Edge, Inspector panel, Toolbar | empty, editing, invalid edge, running (live), read-only |
| S08 | Run timeline | `/runs/:id` | a run step by step with logs, tool calls, timings, cost | Timeline, LogViewer, Badge, Tabs, CopyButton | queued, running (streaming), succeeded, failed, cancelled |
| S09 | Approvals inbox | `/approvals` | actions agents want to take that need a human | List, Card, Diff, Button (approve/reject), Dialog (reason) | empty, pending, approved, rejected, expired |
| S10 | Logs & audit | `/logs` | searchable event log of every action | Table, FilterBar, DateRange, Pagination | empty, loading, filled, overflow |
| S11 | Settings | `/settings/*` | workspace, members, models, keys (vaulted), limits | Sidebar sub-nav, Form, Table, Dialog (danger zone) | default, saving, error, permission denied |
| S12 | Design system | `/design` | every primitive in every state and theme | all | light, dark, RTL |
| S13 | Studio (live builder) | `/studio` | split screen: block and theme controls on one side, a sandboxed live preview on the other | BlockList, TextField, ColorField, SegmentedControl (AR/EN, 375/768/1440), ContrastBadge, PreviewFrame (`<iframe sandbox="allow-scripts" srcdoc>`), ApprovalCard (locked publish) | empty site, editing, contrast failing, RTL, each width, export done |
| S14 | Skill Mixer | `/skills` | installed skills with their SkillSpector status; mix them into an ordered plan; check a new SKILL.md | SkillCard, StatusBadge, Switch, ReorderList, CodeEditor (textarea), CheckList, ApprovalCard (locked install) | loading, filled, empty mix, check passing, check failing |

## Flows

```
F01 Create an agent and run it once
    S03 -> S05 (fill, save) -> S04 -> "Run" -> S08 (live) -> succeeded
    happy path clicks: 5
    edge: validation error on save, model unavailable, run fails mid-step

F02 Approve an agent action
    any screen (ApprovalBanner / sidebar badge) -> S09 -> open item -> review diff -> Approve
    happy path clicks: 3
    edge: item expired, two people act at once, reject requires a reason

F03 Build a workflow
    S06 -> New -> S07 (add nodes, connect, configure in inspector) -> Save -> Run -> S08
    happy path clicks: 8 for a 3-step workflow
    edge: cycle detected, missing required input, unsaved changes on leave

F04 Investigate a failure
    S02 (failure tile) -> S08 (failed step highlighted) -> log line -> S04 (agent config) -> fix -> rerun
    happy path clicks: 4

F05 Jump anywhere
    Ctrl+K / ⌘K -> type -> Enter
    happy path clicks: 0 (keyboard only)

F06 Design a site live
    S13 -> pick blocks -> edit text -> switch AR/EN and 375/768/1440 -> fix any red contrast badge -> Download HTML
    happy path clicks: 6
    edge: every block off, a colour that fails Lc 60, very long Arabic headline, Publish asked (locked)

F07 Mix skills into a plan
    S14 -> switch on skills -> order them -> copy the plan into Claude Code
    happy path clicks: 5
    edge: a skill with a SkillSpector high finding (shown, not blocked from reading), empty mix

F08 Check a new skill
    S14 -> "Check a SKILL.md" -> paste -> read the checklist -> Download
    happy path clicks: 3
    edge: no frontmatter, description over 1024 characters, a prompt-injection phrase, install asked (locked)
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Sidebar | expanded 248px, rail 64px, drawer (mobile) | default, item hover, item active, item focus, badge count | S01 |
| TopBar | — | default, scrolled (hairline) | S01 |
| WorkspaceSwitcher | — | closed, open, searching | S01 |
| CommandPalette | — | closed, open, results, no results | S01 |
| Button | primary, secondary, ghost, danger, icon | default, hover, active, focus-visible, disabled, loading | all |
| TextField / Textarea | text, search, secret (masked) | default, focus, filled, disabled, error | S05, S11 |
| Select / Combobox | — | closed, open, selected, empty, loading | S05, S11 |
| Switch / Checkbox | — | off, on, focus, disabled | S05, S11 |
| Tabs | underline | default, hover, selected, focus | S04, S08 |
| Table | dense 36px rows | loading, empty, filled, row hover, row selected, sorted | S03, S06, S10 |
| StatusDot + Badge | idle, running, succeeded, failed, awaiting approval, paused | static, pulsing (running, off under reduced motion) | S02–S09 |
| StatTile | — | loading, value, no data | S02 |
| Timeline | step rows | queued, running, ok, failed, skipped | S08 |
| LogViewer | mono | streaming, paused, search hit | S08, S10 |
| Dialog | default, danger confirm | open, closing | S05, S09, S11 |
| Toast | info, success, warning, danger | auto-dismiss, with action | all |
| EmptyState | — | — | S02, S03, S06, S09, S10 |
| Skeleton | line, block, row | — | all |
| SegmentedControl | 2–3 options | default, selected, focus | S13 |
| ColorField | native colour input + hex text | valid, invalid hex | S13 |
| ContrastBadge | pass, fail | WCAG ratio + APCA Lc shown as text | S13 |
| PreviewFrame | 375, 768, 1440 wide, scaled to fit | loading, ready | S13 |
| SkillCard | project, vendored | clean, findings (count by severity) | S14 |
| ReorderList | — | item, moving, empty | S13, S14 |
| CheckList | — | pass, warn, fail rows with text | S14 |
| GlassPanel | top bar, sidebar, palette, popover, toast | glass, solid (reduced transparency) | S01 |

## Inferred data model

```
Workspace  id, name, slug, created_at
           evidence: S01 switcher, S11 settings    confidence: high (own design)
Member     id, workspace_id, email, role (owner | admin | operator | viewer)
           evidence: S11 members                   confidence: high
Agent      id, workspace_id, name, role_prompt, model, tools[], limits (json),
           status (idle | running | paused | failed | archived), created_at
           evidence: S03, S04, S05                 confidence: high
Workflow   id, workspace_id, name, graph (json: nodes, edges), version
           evidence: S06, S07                      confidence: high
Run        id, workflow_id | agent_id, status, started_at, finished_at, cost, trigger
           evidence: S08, S02                      confidence: high
Step       id, run_id, index, agent_id, tool, input, output, status, ms, tries
           evidence: S08 timeline                  confidence: high
Approval   id, run_id, step_id, action, payload, status (pending | approved |
           rejected | expired), decided_by, reason, decided_at
           evidence: S09                           confidence: high
Event      id, workspace_id, actor, kind, target, at, data (json)
           evidence: S10                           confidence: high
```

Site       id, workspace_id, name, lang_default (en | ar), theme (json), blocks (json), updated_at
           evidence: S13                           confidence: high (own design)
Skill      name, description, source (project | vendored), review_doc, findings (json by severity), scanned_at
           evidence: S14, .claude/skills, SkillSpector  confidence: high (read from the repo at build time)
Mix        id, workspace_id, name, skills (ordered names), created_at
           evidence: S14                           confidence: high

Relationships: Workspace 1-n Agent, Workspace 1-n Workflow, Workflow 1-n Run,
Agent 1-n Run, Run 1-n Step, Step 0-1 Approval, Workspace 1-n Event,
Workspace 1-n Site, Workspace 1-n Mix, Mix n-n Skill (by name).

## Feature matrix

See `features.csv`. Must: 24, should: 13, could: 6, skip: 2.

## Out of scope (cannot or should not be cloned)

- Any product's logo, icon set, brand colour, illustrations, copy or exact
  pixel layout: Jarvis gets its own.
- Running agents that place real trades, sign orders or move money: locked
  by AGENTS.md §1 until Ahmad approves it separately with legal and security
  review. Jarvis shows such actions only as approval items marked
  «قيد الموافقة».
- Publishing a site to an outside domain, changing repository permissions,
  and installing a skill into the repo: Ahmad's decisions (AGENTS.md §1).
  Jarvis shows them as locked violet «قيد الموافقة» cards that no agent can
  approve; the Studio only downloads a file and the Mixer only copies a plan.

## Size

Screens 14, flows 8, entities 11. Hard parts: live run streaming, the
workflow canvas, a safe approval gate, a live preview that runs under the
strict CSP with no network. Size: L (UI shell and design system first;
canvas and streaming later).

---
name: replica-design
description: Rebuilds an app's design system clean-room style - measured colour roles, type, spacing, components and states as tokens (light + dark), with open fonts/icons and a WCAG gate.
---

# replica-design

Turns screenshots of a target app into **your own** design system: the
roles, scales and component behaviour, never the target's assets.

- **Reads:** `replica/recon.md` (screens S01…, components list) and
  `replica/screens/*.png`. If neither exists, ask for screenshots or a URL
  and run without recon (note it in the report).
- **Writes:** `replica/design/tokens.json`, `tokens.css`,
  `tailwind.tokens.js`, `components.md`, `measurements.md`,
  `contrast-report.txt`, and a `/design` preview route in the app.
- **Next:** `/replica-build`. `/replica-brand` later swaps token *values*;
  role *names* never change.

Tools in this folder (Python 3.8+, standard library only, no network).
`$SKILL` is this folder (`~/.claude/skills/replica-design` or the plugin path):

```bash
python3 $SKILL/sample.py replica/screens/S01.png --top 12          # dominant colours
python3 $SKILL/sample.py replica/screens/S01.png --at 120,48 640,300 # pick exact pixels
python3 $SKILL/build_tokens.py replica/design/tokens.json            # -> tokens.css + tailwind.tokens.js
python3 $SKILL/contrast.py replica/design/tokens.json                # WCAG AA gate, exit 1 on fail
python3 $SKILL/contrast.py replica/design/tokens.json --apca 60      # + APCA Lc >= 60 on text pairs
python3 $SKILL/build_tokens.py replica/design/tokens.json --oklch    # colours as oklch() in tokens.css
```

No Python (claude.ai chat)? Do the same steps by eye and arithmetic; say in
the report that values are estimated, not sampled.

## Clean-room rules (non-negotiable)

Rebuild the **system**: roles, scales, patterns, behaviour. Never take:

| Never take | Use instead |
| --- | --- |
| Logos, icons, illustrations, photos, sounds | Lucide / Phosphor / Heroicons / Tabler (MIT-style); your own illustrations. Do not trace. |
| Paid or proprietary fonts | Same *category*: Inter, Geist, IBM Plex Sans, Manrope (sans); Source Serif 4, Literata (serif); JetBrains Mono, Geist Mono (mono). |
| Copy: labels, empty states, errors, tooltips | Write fresh, describing your own behaviour. |
| Brand colour as a value | Record the role `accent`; ship a neutral placeholder. `/replica-brand` sets the real one. Signature colour + signature layout = trade dress. |
| Source CSS, private APIs, scraped assets | Measure from screenshots you are allowed to take. |

If the user asks to copy any of the left column, say no once, plainly, and
offer the right column.

## Step 1 — Measure, don't guess

Write findings to `replica/design/measurements.md` with the screen ID each
value came from.

1. **Colour roles.** Run `sample.py --top` on 3–5 representative screens
   (one light, one dark if the app has dark mode, one dense form, one modal).
   Cluster near-identical greys; real apps use 5–7 neutrals. Use `--at` for
   specific elements (button fill, input border, muted label). Map each
   cluster to a role:
   `bg, surface, surface-raised, border, border-input, text, text-muted,
   text-subtle, accent, accent-hover, on-accent, focus, danger, success,
   warning, info`.
2. **Type.** Measure cap/x-height and line boxes in px at 1x (divide by the
   screenshot's device scale — a 2x screenshot halves every number). Snap to
   a scale; `12/14/16/20/28/40` fits most products. Record weight and
   category, not font file.
3. **Spacing.** Measure gaps between siblings and paddings inside cards,
   buttons, inputs. Find the base (almost always 4 or 8). Anything off-grid by
   ≤2px snaps to the grid.
4. **Radius, shadow, motion, borders:** 2–3 of each. Motion: estimate from a
   screen recording or default to 120/200ms.
5. **Layout:** max content width, grid columns, gutters, breakpoints,
   sidebar width, header height, touch-target minimum (≥44px on mobile).

## Step 2 — Write the tokens

Copy `templates/tokens.json` to `replica/design/tokens.json` and fill it.

- Keep every role name. Add roles only if the app genuinely needs one; never
  rename.
- `color` is light mode. `color-dark` overrides the same roles for dark mode
  (omit a role to inherit). If the target has no dark mode, still fill it —
  it costs little now and a lot later.
- `pairs` lists every foreground/background combination the UI actually
  uses. Third item: `large` (≥24px, or ≥18.66px bold → 3:1) or `ui`
  (input borders, focus rings, icons that carry meaning → 3:1). Pairs are
  checked in both themes.

Then:

```bash
python3 $SKILL/build_tokens.py replica/design/tokens.json
python3 $SKILL/contrast.py replica/design/tokens.json | tee replica/design/contrast-report.txt
```

`build_tokens.py` writes CSS custom properties (`:root`, a
`prefers-color-scheme: dark` block, and `[data-theme="dark"]`/`[data-theme="light"]` overrides) and a
Tailwind theme extension that maps utilities to the variables, so components
write `bg-surface text-muted rounded-md`, never hex. Tailwind v4: import
`tokens.css` and use the generated `@theme` block instead (`--tailwind4`).

If the project has its own design rules (a `DESIGN.md`, a contrast gate,
a colour space), they win: e.g. pass `--apca 60` when the project also
requires APCA, and `--oklch` when tokens must be OKLCH.

**AA is the floor** — 4.5:1 body text, 3:1 large text and UI. Fix failures
in the tokens, never per component. Do not continue to Step 3 with a failing
report.

## Step 3 — Component specs

Copy `templates/components.md` to `replica/design/components.md`. One block
per component in the recon list, in this shape:

```
Button
  variants  primary, secondary, ghost, danger
  sizes     sm 32px, md 40px, lg 48px   (min hit area 44px on touch)
  states    default, hover, active, focus-visible (2px ring, focus, 2px offset),
            disabled, loading
  tokens    bg accent / hover accent-hover, text on-accent, radius md, type sm/600
  a11y      native <button>; loading sets aria-busy and keeps the label;
            disabled uses the attribute, not just styling
  keyboard  Enter/Space activate
  used on   S02, S07, S09
```

Every state recon saw **plus** the ones it should have: focus-visible,
disabled, loading, empty, error, and (for lists/data) skeleton and overflow.
Keyboard map and screen-reader behaviour are part of the spec, not extras.
Patterns with known a11y contracts (dialog, menu, combobox, tabs, tooltip,
toast) follow the WAI-ARIA Authoring Practices — say which one.

## Step 4 — Build the primitives

Before any screen, build the components in isolation at a `/design` route
(or Storybook):

- Use an accessible base where the stack has one: Radix / shadcn/ui or React
  Aria (React), Reka/Radix Vue (Vue), Bits UI (Svelte), native elements
  otherwise.
- Render every variant × state × theme on the page, including a theme toggle.
- Screenshot it light and dark at 1x. That page **is** the design-system
  check; `/replica-diff` compares layouts against it later.

## Done when

- [ ] `measurements.md` cites a screen for every token value (or says "estimated").
- [ ] `tokens.json` uses only the template's role names (plus justified additions).
- [ ] `contrast.py` exits 0 — zero AA failures in light **and** dark.
- [ ] `tokens.css` + Tailwind mapping generated; no raw hex in components.
- [ ] Every recon component has a spec with all states, keyboard and a11y.
- [ ] `/design` route renders all primitives in both themes.
- [ ] No target logos, icons, fonts, copy or brand colour anywhere.

Report to the user: the token summary, the contrast table, open questions,
and "Next: `/replica-build`".

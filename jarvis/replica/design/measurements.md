# Measurements: Jarvis

**Every value here is estimated, not sampled.** `replica/screens/` is empty:
Jarvis is an original product that borrows a common dashboard *layout
pattern*, and the cloud sandbox has no browser session on any target. Values
come from the brief (dark first, high contrast, electric-blue accent), from
`DESIGN.md` (binding in this repo) and from the contrast gate. When reference
screenshots are added, run `sample.py` on them and replace the "estimated"
cells with the screen ID.

## Colour roles

| role | dark (default) | light (toggle) | source |
| --- | --- | --- | --- |
| bg | `#090b10` | `#f4f6f9` | estimated; near-black with a blue cast, not pure black |
| surface | `#10141b` | `#ffffff` | estimated; sidebar, cards |
| surface-raised | `#161b24` | `#ffffff` | estimated; popovers, dialogs, hovered rows |
| surface-sunken | `#06080b` | `#eceff4` | added role: log viewer, code blocks, inputs inside cards |
| border | `#242b37` | `#dfe3ea` | estimated; hairlines (decorative, not gated) |
| border-input | `#636d7e` | `#7d8696` | tuned to ≥ 3:1 on bg and surface (gate: ui) |
| text | `#eef2f8` | `#0f131a` | gate |
| text-muted | `#b9c1cd` | `#454e5c` | gate: APCA Lc ≥ 60 |
| text-subtle | `#afb7c3` | `#535c6b` | raised until Lc ≥ 60 on surface-raised; hierarchy comes from size and weight, not from dimmer grey |
| accent | `#77bcff` | `#0b5ed7` | electric blue; the one accent (DESIGN.md §1). Dark value lightened from `#4fa8ff` to pass Lc 60 |
| accent-hover | `#9ccfff` | `#094fb6` | lighter on dark, darker on light |
| on-accent | `#04101f` | `#ffffff` | dark text on the bright fill in dark mode (Lc 64) |
| focus | `#8cc6ff` | `#0b5ed7` | 2px ring, 2px offset |
| danger / on-danger | `#ff9a9a` / `#1d0404` | `#b42323` / `#ffffff` | status only |
| success | `#4fdba0` | `#116a43` | status only: running ok, succeeded |
| warning | `#f7c066` | `#8a4f00` | status only: retrying, checking |
| info | `#6cc8ff` | `#0b5ed7` | status only: queued |
| approval | `#c2adff` | `#6234c4` | added role: «awaiting approval», the repo's violet meaning (DESIGN.md §1) |

No gradients. The brief asked for neon blue *or* purple accents. DESIGN.md
allows one accent and bans the purple-blue "AI gradient", so blue is the
accent and violet appears only as the approval status colour.

## Type

| step | size / line | weight | use |
| --- | --- | --- | --- |
| caption | 12 / 16 | 500 | table headers, meta (nothing below 12px, DESIGN.md §2) |
| sm | 13 / 20 | 400 | dense tables, sidebar items |
| base | 15 / 22 | 400 | body (DESIGN.md body 15) |
| headline | 17 / 24 | 600 | card titles |
| title | 22 / 28 | 650 | page titles |
| display | 32 / 38 | 700 | overview numbers |

Fonts: Inter → system-ui for Latin UI; Cairo (vendored in `site-landing/fonts`,
OFL) for Arabic later; JetBrains Mono (vendored, OFL) for ids, logs and
numbers with `tabular-nums slashed-zero`.

## Spacing, radius, shadow, motion

- Base 4px; scale 0 4 8 12 16 20 24 32 48 (DESIGN.md §3).
- Radius 6 / 8 / 12 / 20 / pill. Concentric: card 20 = 8 padding + 12 inner.
- Shadows tinted, alpha ≤ 0.09 (DESIGN.md: below 0.1).
- Motion 120 / 200ms, `cubic-bezier(0.32, 0.72, 0, 1)`, transform and opacity
  only, off under `prefers-reduced-motion`.

## Layout

- Sidebar 248px expanded, 64px rail at 768–1279px, drawer under 768px.
- Top bar 56px. Table rows 36px. Content max 1440px; wider screens get margins.
- Touch targets ≥ 44px under `pointer: coarse`.
- Logical properties only (`margin-inline-start`, `inset-inline-end`), so
  `dir="rtl"` mirrors the shell without new CSS.

# Component specs: {{clone name}}

Source: `replica/recon.md` components list. Tokens: `replica/design/tokens.json`.
One block per component. Every block lists all states, keyboard and a11y.
Copy is written fresh; nothing here quotes the original app.

---

Button
  variants  primary, secondary, ghost, danger
  sizes     sm 32px, md 40px, lg 48px   (hit area >= 44px on touch)
  states    default, hover, active, focus-visible (2px ring focus, 2px offset), disabled, loading
  tokens    primary: bg accent / hover accent-hover, text on-accent; radius md; type sm/600
  a11y      native <button>; loading sets aria-busy, keeps label; disabled attribute, not styling only
  keyboard  Enter / Space
  used on   {{S..}}

TextField
  variants  text, email, password (show/hide), search, textarea
  sizes     md 40px
  states    default, hover, focus-visible (ring focus), filled, disabled, read-only, error, success
  tokens    bg bg, border border-input / focus focus / error danger, text text, placeholder text-subtle, radius sm
  a11y      <label for>; hint + error linked with aria-describedby; aria-invalid on error; error text not colour-only
  keyboard  native
  used on   {{S..}}

Select / Combobox
  pattern   WAI-ARIA APG Combobox (or native <select> when no search)
  states    closed, open, option hover/active, selected, disabled, empty results, loading
  keyboard  Down/Up move, Enter selects, Esc closes, typeahead
  used on   {{S..}}

Checkbox / Radio / Switch
  states    unchecked, checked, indeterminate (checkbox), focus-visible, disabled, error
  a11y      native input or role=switch with aria-checked; group in <fieldset><legend>
  keyboard  Space toggles; arrows move within a radio group

Dialog (modal)
  pattern   WAI-ARIA APG Dialog (Modal)
  sizes     sm 400, md 560, lg 720 (full-screen under sm breakpoint)
  states    opening, open, closing; with/without footer; destructive confirm
  tokens    bg surface-raised, shadow pop, radius lg, scrim rgba(0,0,0,.5)
  a11y      aria-modal, labelled by title; focus trapped; focus returns to trigger
  keyboard  Esc closes; Tab cycles inside

Menu / Dropdown
  pattern   WAI-ARIA APG Menu Button
  keyboard  Enter/Space/Down opens, arrows move, Esc closes, typeahead

Tabs
  pattern   WAI-ARIA APG Tabs (automatic activation unless panels are heavy)
  states    default, hover, selected, focus-visible, disabled

Toast
  states    info, success, warning, danger; with action; auto-dismiss 5s (paused on hover/focus)
  a11y      role=status (polite) or role=alert (danger only); never the only place an error appears

Table / List
  states    loading (skeleton), empty (fresh copy + primary action), error (retry), populated, overflow/paginated, row hover, row selected
  a11y      real <table> with <th scope>; sortable headers use aria-sort

Card
  tokens    bg surface-raised, border border, radius md, shadow card, padding space-5 (24px)

Avatar, Badge, Tooltip, Skeleton, EmptyState, Pagination, Sidebar, Header
  {{fill from recon; same fields}}

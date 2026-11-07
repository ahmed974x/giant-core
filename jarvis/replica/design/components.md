# Component specs: Jarvis

Source: `jarvis/replica/recon.md` (S01–S12). Tokens: `tokens.json`.
Copy is written fresh. Every block lists states, keyboard and a11y.
Rendered in `jarvis/design/index.html` (the `/design` route, S12).

---

Sidebar
  variants  expanded 248px, rail 64px (icons + tooltips), drawer (< 768px, modal)
  states    item default, hover (surface-raised), active (accent text + 2px inline-start bar), focus-visible, badge count
  tokens    bg surface, border-inline-end border, item type sm/500, radius sm
  a11y      <nav aria-label="Main">; active item aria-current="page"; collapse button aria-expanded + aria-controls
  keyboard  Tab through items; drawer: Esc closes, focus returns to the menu button
  used on   S01

TopBar
  states    default, scrolled (hairline border-bottom)
  contents  menu button (mobile), workspace switcher, search trigger (⌘K hint), theme toggle, direction toggle, account
  tokens    bg bg at 0.82 alpha with blur on supporting browsers, opaque fallback (DESIGN.md §4: glass only on sticky chrome)
  used on   S01

WorkspaceSwitcher
  pattern   WAI-ARIA APG Menu Button
  states    closed, open, current item checked
  keyboard  Enter/Space/Down opens, arrows move, Esc closes
  used on   S01

CommandPalette
  pattern   WAI-ARIA APG Combobox inside a modal Dialog
  states    closed, open, results, no results ("No match. Try an agent, page or action name.")
  keyboard  Ctrl+K / ⌘K opens; Up/Down move (aria-activedescendant); Enter opens; Esc closes, focus returns
  tokens    bg surface-raised, shadow pop, radius lg, input type headline
  used on   S01, F05

Button
  variants  primary (accent fill), secondary (surface-raised + border), ghost, danger (danger fill), icon
  sizes     sm 32px, md 36px, lg 44px; hit area ≥ 44px under pointer: coarse
  states    default, hover, active (scale 0.97), focus-visible (2px focus ring, 2px offset), disabled, loading
  tokens    primary bg accent / hover accent-hover, text on-accent; danger bg danger, text on-danger; radius sm; type sm/600
  a11y      native <button>; loading sets aria-busy="true", keeps the label, shows a spinner with aria-hidden
  keyboard  Enter / Space
  used on   all

TextField / Textarea
  variants  text, search (leading icon), secret (masked, reveal button), textarea
  height    36px (44px under pointer: coarse)
  states    default, hover, focus-visible, filled, disabled, read-only, error
  tokens    bg surface-sunken, border border-input / focus focus / error danger, text text, placeholder text-subtle, radius sm
  a11y      <label for>; hint and error joined by aria-describedby; aria-invalid on error; error has an icon and text, never colour alone
  used on   S05, S11

Select / Combobox
  pattern   native <select> for short lists; APG Combobox for model and tool pickers
  states    closed, open, option active, selected, disabled, empty, loading
  keyboard  Down/Up, Enter, Esc, type-ahead
  used on   S05, S11

Switch / Checkbox
  states    off, on, focus-visible, disabled
  a11y      <input type="checkbox" role="switch"> for switches; groups in <fieldset><legend>
  keyboard  Space toggles
  used on   S05, S11

Tabs
  pattern   WAI-ARIA APG Tabs, automatic activation
  states    default, hover, selected (accent underline 2px), focus-visible
  keyboard  Left/Right (mirrored in RTL), Home/End
  used on   S04, S08

Table
  density   36px rows, 12px caption headers, mono for ids and numbers
  states    loading (skeleton rows), empty (EmptyState), filled, row hover, row selected, sorted (aria-sort), overflow (scrolls inside .table-scroll)
  a11y      real <table>, <th scope="col">; status cell has text, not only a dot
  used on   S03, S06, S10

StatusDot + Badge
  variants  idle (text-subtle), running (success, pulse), succeeded (success), failed (danger), queued (info), retrying (warning), awaiting approval (approval), paused (text-muted)
  states    static; running pulses opacity 1 → 0.4 at 1.6s, off under reduced motion
  a11y      always paired with a text label; dot is aria-hidden
  used on   S02–S09

StatTile
  states    loading (skeleton), value, no data ("No runs yet")
  tokens    value display/700 mono tabular-nums; label caption text-muted; delta in status colour with an arrow and text
  used on   S02

Timeline (run steps)
  states    queued, running (live), ok, failed (expanded by default), skipped
  contents  step index, agent, tool, duration (mono), tries, expandable input/output in surface-sunken
  a11y      <ol>; each step a <details> or a button with aria-expanded
  used on   S08

LogViewer
  states    streaming (aria-live="polite", throttled), paused, search hit (mark)
  tokens    bg surface-sunken, mono sm, line numbers text-subtle
  used on   S08, S10

ApprovalCard
  states    pending, approved, rejected (reason shown), expired
  contents  agent, requested action, payload diff, requested time, Approve (primary) and Reject (secondary, opens a reason dialog)
  rule      actions outside the sandbox (money, orders, sending) are shown as «قيد الموافقة» and cannot be approved from Jarvis (AGENTS.md §1)
  used on   S09

Dialog
  pattern   WAI-ARIA APG Dialog (Modal) via native <dialog>.showModal()
  sizes     sm 400, md 560; full width under 640px
  states    open, closing; danger confirm (danger button, names what will happen)
  a11y      labelled by its heading; focus moves in and returns to the trigger
  keyboard  Esc closes; Tab stays inside
  used on   S05, S09, S11

Toast
  variants  info, success, warning, danger; with action
  states    enter, visible (5s, paused on hover/focus), leave
  a11y      role="status" (role="alert" for danger only); the same message also lives on the page
  used on   all

EmptyState
  contents  plain title, one sentence on what goes here, one primary action
  used on   S02, S03, S06, S09, S10

Skeleton
  variants  line, block, row
  motion    opacity shimmer, off under reduced motion
  used on   all loading states

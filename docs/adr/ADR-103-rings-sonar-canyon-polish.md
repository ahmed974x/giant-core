# ADR-103: Ring gradients, a $20 paper base to start, and a 25-tier sonar canyon

Date: 2026-10-22 · Status: Accepted (Ahmad's Phase 10 directive, 2026-10-22)

## Context
Ahmad reviewed the Phase 9 screenshots (ADR-102) and found four problems:
- The rings card's Arabic title looked clipped.
- All three rings sat at 0 % on a fresh browser.
- The sonar loupe was drawn at y = 16, too close to the canvas's top edge.
- The ±1.5 % canyon showed the order book as one smooth slope.

He asked for:
- Apple Watch gradients with round caps, a shadow and track borders.
- A $20.00 paper locked base to start with.
- A 25-tier stepped canyon with micro-badges.
- Continuous concentric sonar pulses from the microprice baseline.

## Decision
- **Rings**
  - The card gets 24 px top padding and a matching scroll margin, so the two-line title clears the quadrant edge on the command wall.
  - Gradients:
    - Outer ring: green to mint (#30D158 to #00C7BE in dark).
    - Middle ring: indigo to purple (#5E5CE6 to #BF5AF2).
    - Inner ring: orange to pink (#FF9F0A to #FF375F).
  - New tokens `--apple-mint` and `--apple-pink` have light, dark and P3 values. They are for marks only and never carry text.
  - Each track has a hairline border. The leading cap is a filled circle with a tinted shadow (`--shadow-color` at 0.28) where the arc overlaps itself. This is the one shadow above 0.1 alpha, and DESIGN.md records it.
  - At 0 % the cap is the start dot at twelve o'clock, so an empty ring still shows where it starts. The value stays honest: 0 % growth shows as 0 %.
- **$20 paper base**
  - On a first visit (no base, no receipt, no stop, no open position), the desk locks $20.00 from the paper cash. It issues a normal `LOCK` receipt that says "Auto paper bootstrap".
  - It runs once per browser (`omega-desk-bootstrap-v1`).
  - The lock field defaults to 20.
  - The sweep stays `max(0, equity − base)` while flat, and the ring's text says so.
  - Paper money only. Nothing is sent anywhere.
- **Canyon**
  - The top 25 levels on each side of the Binance spot book (the depth the desk already loads), drawn as a stepped staircase of cumulative depth.
  - Each level is one equal-width tier, so thin and thick levels read alike.
  - Bids are green to mint, asks are red to pink.
  - Badges in tabular numbers mark the three largest single levels per side. A badge that would overlap another is skipped.
  - Whale walls inside the 25 tiers show as a dashed line with a dot. Walls further out show as edge chips with price and size.
  - The liquidation pockets left this canvas. They stay in the crowd radar.
- **Microprice baseline and pulses**
  - The orange baseline is the microprice (the imbalance-weighted mid, Stoikov's first-order form). Its offset from the mid is shown in bps under the canyon.
  - DESIGN.md keeps the ticker marquee as the only continuous motion, so the pulses are event-driven, not a loop:
    - A set of three half-rings rises from the baseline when the microprice has moved 0.5 bps or more since the last pulse, at most once every 4 s.
    - A new whale wall also sends one set.
  - Each set lasts 1.6 s, then the canvas is still.
  - Nothing animates under reduced motion, off screen, or in a hidden tab.
- **Loupes**
  - The canyon loupe follows the pointer's height but is clamped to y ≥ 24 and above the axis, with 40 px of top padding.
  - The SVG chart loupe (`OMEGA_VIS`, in the Ops Room and `site-landing/vis.js`) is clamped the same way, and horizontally inside the chart.

## Consequences
- A fresh browser shows a $20.00 paper base and one receipt. Clearing the receipt chain does not lock again.
- The court and planet rings depend on live data. Without a live PWSI source the planet ring stays at 0 % with "تعذر التحقق منها" (ADR-104 adds the snapshot tier).
- Verified with a synthetic book in the sandbox (no internet). Live Binance depth is checked on the laptop.

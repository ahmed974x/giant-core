---
name: synaptic-spiderweb-viz
description: Use when changing the Brain 2 synaptic web canvas in the Ops Room - its rings of nodes, edges, pulses, glass causal card, gym panel or labels. Event-driven drawing, real readings only, accessible fallbacks.
---

# Brain 2 synaptic web

The web (`#brain2`, ADR-108) shows how the desk's inputs feed its decisions. It is a picture of real readings, not decoration.

## 1. Structure

- Outer ring, 10 sensory nodes: BGP/IODA, Cables, Orbits/Kp, Straits, Quakes (USGS), Weather (Open-Meteo), Aviation, GDELT, Mempool, SEC.
- Middle ring, 8 quant nodes: Microprice, Hawkes λ, VPIN, Kalman, BOCPD, Kyle λ/Ice, GEX/DVOL, Funding.
- Inner ring, 6 agents: Bull, Bear, Judge, Researcher, Modeler, Auditor.
- Core: Vault (the $20 locked base and the SHA-256 receipt chain).
- Edges are only the links the desk really uses. A node is filled when its source is live and hollow when offline; its arc is a 0–1 reading from the page's own numbers.

## 2. Drawing rules

1. Draw on demand. A pulse fires only on a discrete event: microprice move of 0.5 bps or more, a new whale wall or iceberg, a new data pull, a gym burst, or the person's hover or tap. Never a loop.
2. At most one pulse per second. Under reduced motion there is no travelling light; the affected nodes are highlighted instead.
3. Pause under `IntersectionObserver` and `visibilitychange`. devicePixelRatio up to 3.
4. Labels are 12px minimum, placed after all nodes, at the first free spot (own side, mirror side, then one to three lines up or down). On a phone the web is an upright ellipse and labels sit above or below their nodes. Check 390×844 @3x screenshots for overlap.
5. Colours: `--apple-*` for strokes and fills, gated tokens for text.

## 3. The causal card

Hover, tap or click opens the glass card for the nearest node, and the arrow keys step through the nodes when the canvas has focus: what it reads, its value with source and time, what it feeds, and `[INFERENCE]` where a heuristic is involved. Esc closes it. The "All 25 nodes" `<details>` list carries the same content as text for screen readers.

## 4. The gym

A Blob Web Worker trains six rule agents with contextual EXP3 (γ 0.07) and multiplicative weights with fixed share (η 0.01, α 0.001) on Float64Array buffers. Returns are bootstrapped from cached real Binance daily returns with synthetic stress segments; each stress regime is scored only inside its shock window. Bursts of 1.5 s every 60 s. The panel shows measured ticks per second on this machine. Gym weights inform the web only; they never open a trade.

## 5. Probe and receipts

`window.OMEGA_BRAIN2` exposes read-only `receipt()`, `nodes()`, `edges()`, `inspect(id)`, `bench()`, `gym()`, `derivs()` and `readings()`. `receipt()` is what the desk writes under `brain2` in each paper receipt.

## 6. Checks

Self-test "Synaptic spiderweb" and "Supersonic gym", three sizes with a look at the mobile screenshot, SkillSpector strict.

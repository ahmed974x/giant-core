---
name: neural-flow-decision-viz
description: Use when changing the Ops Room deep neural flow (139 → 48 → 36 → 48 → 24 → 16 → 8), its threads, pulses, oscilloscope inspector, chrono-scrubber, training worker or decision heads. Real inputs only, event-driven drawing, honest training numbers.
---

# Deep neural flow · from data to decision

The neural flow (`#neural`, ADR-109) is a small network trained in the browser on the last 300 readings of the page's own public data. It is a decision aid for paper trading. The desk's rules, the risk judge and the receipt chain decide; the network opens nothing.

## 1. Architecture

- Seven layers, left to right: 139 linear inputs, five ReLU hidden layers of 48, 36, 48, 24 and 16, and 8 tanh outputs. 11,792 weights and 180 biases in one `Float64Array` (per layer: weights row by output neuron, then biases).
- Maths lives once in `scripts/lib/brain2-math.mjs` (`nnFactory`, `nn`): `init`, `forward`, `grad`, `lossOf`, `train`. It is inlined into the Ops Room by `node scripts/build-brain2-inline.mjs` and tested by `node scripts/test-brain2.mjs` (gradient check against central differences, a learnable toy task, the split).
- `nnFactory` must use no outside name: the page builds its Web Worker from `nnFactory.toString()`.

## 2. Inputs (139)

| Group | Count | Source |
|---|---|---|
| BOOK | 50 | top 25 bid and ask size shares, Binance book |
| μ-RET | 20 | last 20 microprice log returns (bps) |
| TAPE | 10 | last 10 trades, signed size ÷ median |
| FLOW | 12 | microprice gap, Hawkes, VPIN, Kalman gap, BOCPD, Kyle λ, icebergs, entropy, spread, imbalance |
| DERIV | 12 | Deribit gamma regime, flip and walls, ATM IV, DVOL, 25Δ skew, BTC/ETH funding and basis |
| CHAIN | 1 | mempool.space fastest fee |
| INTEL | 34 | PWSI and its parts, five straits, quakes, disaster alerts, gusts, AIS, GDELT, OpenSky, KEV, RIPEstat, IODA, Kp, EONET, SANS InfoCON, cables, CSTI, BTC 24 h change, RIS Live instability, squawk 7700 count, aircraft near the straits (ADR-110) |

Each input is squashed to about [-1, 1] with a stated formula (shown in the oscilloscope). A missing source enters as 0 and its neuron is drawn hollow. Never fill a gap with a guess.

## 3. Targets and training

- Head 1 learns `tanh(bps / 3)` of the microprice change 6 readings (≈30 s) ahead. Heads 2–8 learn the desk's own rule values at that moment: half-Kelly size, target, stop, breaker, locked-base recovery, sweep, court confidence. Say so on screen: they show how the data flows into those values, they do not replace the rules.
- Time order is kept: the newest 20 % is held out, with a 6-reading gap before it, so no target looks into the held-out window.
- Adam (lr 0.003, L2 1e-4, batch 16) plus a (1+1)-ES on the output layer with the one-fifth rule. Bursts at most once a minute from 30 readings on, in a Blob Web Worker.
- Report only measured numbers: held-out loss before and after, the always-0 baseline, the direction hit rate on moves of 0.3 bps or more, steps, ES acceptances, worker time. No claims of accuracy beyond them.

## 4. Drawing rules

1. Threads are cubic Béziers grouped by colour and binned opacity and width, so ~11,800 curves stroke in a few dozen `Path2D` paths into an offscreen buffer; the visible canvas blits it.
2. Colours: `--apple-cyan` for w > 0, `--apple-purple` / `--apple-pink` for w < 0, `--apple-orange` / `--apple-red` for the last gap (decision threads). Opacity follows |w·a|, width follows |w|. Text uses gated tokens only, 12 px minimum.
3. Motion only on a discrete event (a new reading, a microprice move of 0.5 bps or more, a data pull, a training burst, hover or tap), at most once a second, 1.4 s wave along the 24 strongest |w·a| per gap. Still under reduced motion and during the self-test (`omega:selftest-start`, `?selftest=1`).
4. Pause under `IntersectionObserver` and `visibilitychange`. devicePixelRatio up to 3. Zoom 1–6× with buttons or ctrl/pinch wheel; pan by dragging only when zoomed.
5. The oscilloscope is the one glass panel in this card, top right on ≥ 600 px and static below the canvas on a phone, with an opaque fallback.

## 5. Chrono-scrubber

Every reading stores inputs, activations, pre-activations, rule targets, microprice, court ruling and the weight version. Up to 12 weight versions are kept; a reading whose version is gone is drawn with the oldest kept and says so. The counterfactual line (network call held, court ruling held, every call followed with a 0.1 % fee each way) is hypothetical paper arithmetic on recorded prices and is labelled "مثال افتراضي".

## 6. Probe and checks

`window.OMEGA_NEURAL` is read-only: `sizes`, `weights`, `inputs`, `forward`, `inspect`, `state`, `pulse`, `counterfactual`, `xray`, `xrayBadges`, `scrub`, `regime`. Self-test checks 19 and 20, `node scripts/test-brain2.mjs`, the three sizes in light and dark, SkillSpector strict.

---
name: liquid-neural-139-flow
description: Use when changing the continuous-time (liquid) dynamics of the Ops Room neural flow 139 → 48 → 36 → 48 → 24 → 16 → 8, its τ table, shock events, Heun solver, settle animation or the oscilloscope's τ readout. The resting state must equal the trained feed-forward answer.
---

# Continuous-time neural flow (ADR-110)

The deep neural flow (`neural-flow-decision-viz`, ADR-109) is trained as an ordinary feed-forward network. ADR-110 lets it run in continuous time between readings, so the drawing shows a change travelling from the inputs to the heads. Training, targets and the decision rules do not change.

## 1. The equation

For neuron i of layer k:

  dx_i/dt = (σ(Σ_j W_ij x_j(t) + b_i) − x_i(t)) / τ_i(t)

- σ is ReLU in hidden layers and tanh in the 8 heads. Layer k is driven by layer k−1 as it is now, not as it will settle, so depth adds delay.
- This normalised leaky form has the feed-forward answer as its only resting state for any τ. Do not switch to the unnormalised `−x/τ + σ(·)` form: its rest is τ·σ(·), which would make the heads disagree with the trained network.
- τ_i = τ_layer · spread_i / (1 + κ·E), floored at τ_layer · spread_i / 8. τ_layer = [0.6, 0.9, 1.2, 1.6, 2.0, 2.5] s, κ = 4, spread_i a fixed 0.7 to 1.3 per neuron.
- E = Σ w · exp(−age / 30 s) over shock events. Shocks come only from `omega:shock` (whale wall, InfoCON rise, emergency squawk, BGP origin or more-specific change) and a microprice move of 0.5 bps or more.

## 2. Solver

- Explicit Heun (predictor-corrector, second order) in `nn.odeStep`, sub-steps h ≤ τ_min / 2, at most 4000 per call. The leak term is stable for h/τ ≤ 2, so the bound has margin.
- `nn.odeInit(net, x)` starts at rest; `nn.odeGap(net, x, st)` is the largest distance to rest.
- The page advances the state before each reading (dt capped at 120 s) and, after a new reading, runs a settle loop on `requestAnimationFrame` that stops when the gap is below 1e-3 or after 6 s. No loop runs at rest, under `prefers-reduced-motion`, or while the self-test runs.
- The library is the only copy of the maths: edit `scripts/lib/brain2-math.mjs`, then `node scripts/build-brain2-inline.mjs`, `node scripts/test-brain2.mjs` and re-pin the CSP. `nnFactory` must use no outside name (the training worker is built from its source).

## 3. What the page shows

- Neuron fills, threads, heads and the regime use the displayed state x(t); the decision table and the counterfactual replay use the state stored with each reading.
- The oscilloscope shows x(t) as a purple ring on the activation curve, the neuron's τ now and τ at calm, and the equation.
- X-Ray on the title badge times one `odeStep` in µs on this machine.
- Wording: "continuous-time" or "liquid-style". It is not a liquid time-constant network from the literature (there τ depends on the input through a learned gate); here τ depends on shock events only. Say so if asked.

## 4. Tests that must stay green

`node scripts/test-brain2.mjs`: settles on the feed-forward answer to 1e-6, Heun error ratio near 4 for halved steps, shocks shorten τ with the 8× floor and fade over 30 s. Self-test check 24 repeats these in the browser.

## 5. Honesty

The network is a decision aid for paper trading. Its outputs carry `[INFERENCE - Quant Model]`; it opens nothing, and the $20 locked base and the receipt chain are checked by the desk, not by the network.

---
name: neural-139-inputs-heads
description: Use when changing which readings enter the 139 inputs of the Ops Room neural flow, the meaning or wording of its 8 decision heads (including the $20 base, protected wallet and SHA-256 receipt heads), the clicked-neuron oscilloscope or the deterministic causal "why" table.
---

# The 139 inputs, the 8 heads and the "why" table (ADR-109, ADR-110, ADR-112)

Read `neural-flow-decision-viz` (layout, training) and `liquid-neural-139-flow` (continuous time) first. This skill covers what goes in, what comes out and how the page explains it.

## 1. Shape is fixed

`SIZES = [139, 48, 36, 48, 24, 16, 8]`: linear inputs, ReLU hidden layers, tanh heads. Do not change a size without a new ADR. When an input is added, another one leaves, so the count stays 139, and the weights storage key moves to a new version (now `omega-neural-v3`) so stale weights are never loaded against new meanings.

## 2. Inputs

- Seven labelled groups. Each input names its source in its label; a missing reading enters as 0 and the label says it is missing, never a guessed value.
- ADR-112 swaps: chain group gains the stablecoin LFI and DEX change against the day before; intel group gains highest strait wave, fastest strait current and CIRCL critical records, in place of two PWSI part duplicates and the Gulf aircraft box; Baltic AIS and BTC 24 h left to keep the total at 139.
- Inputs are scaled to about −1 to 1 with fixed divisors written next to each one. No input is fitted to the future.

## 3. Heads

| Head | Teacher | Decoded text |
|---|---|---|
| 1 | the market, next 30 s | direction |
| 2 | Kelly sizer | paper size, [INFERENCE - Quant Model] |
| 3, 4 | levels | take profit, stop loss |
| 5 | circuit breaker | stop or go, fixed rules |
| 6 | $20 base guard | recover the pending $20 base: a proposal for Director 00, no real money moves |
| 7 | profit sweeper | move profit to the protected (safe) wallet: a proposal for Director 00, paper ledger only |
| 8 | risk judge | OPEN or stand aside, with the SHA-256 head of the paper receipt chain |

- Heads 6 to 8 never call a wallet, an exchange or a signing function. They show text; the person acts, on paper.

## 4. Oscilloscope

- Click or tap a neuron: the glass scope sits top right at ≥ 600 px and under the canvas on a phone. It shows x(t), the activation history and τ now and at calm.
- During the self-test (`?selftest=1`) the state is frozen: no settle loop, no training burst, and the scope title adds "frozen for the self-test".

## 5. Causal "why" table (`#nfWhy`)

- `causal()` builds rows from numbers already on the page (LFI, microprice, VPIN and Hawkes, CSTI, strait waves, PWSI, the court ruling and head 1, the paper base and safe). Each row says the reading, its source and which head it pushes. It is deterministic: the same numbers give the same rows.
- It is rebuilt at the top of each render. Text goes in through `textContent` only.
- The local model button (`#nfLlmBtn`) sends only these rows to `127.0.0.1:8796/llm/ollama/explain` (`local-glm-agent-windows-mcp`). Its answer is labelled [INFERENCE - local LLM] and never changes a head, a weight or a trade.

## 6. Checks

`node scripts/test-brain2.mjs` (sizes, ODE rest state), self-test checks 19, 20 and 24 (`autonomous-24-selftest-gate`), three sizes with `node scripts/ui-three-sizes.mjs`.

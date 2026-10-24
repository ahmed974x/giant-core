# ADR-117: Neural flow thread inspector, court debate evidence and the risk team veto line

Date: 2026-10-24 · Status: Proposed (Ahmad's Phase 19 message of 2026-10-24 03:10Z; merge waits for his go). Stacked on ADR-116 (PR #37), which is stacked on ADR-115 (PR #36); neither is merged yet.

## Context
Ahmad pasted a directive written by another assistant, titled "Phase 13", from a video of a layered neural flow. It asked for:
- a seven-layer flow, 139 → 48 → 36 → 48 → 24 → 16 → 8, with Bézier threads coloured by sign;
- light pulses on events and an oscilloscope top right;
- training in a Web Worker on the last 300 readings;
- agent teams: intelligence, liquidity physics, a bull against bear debate, and a risk team with a veto;
- open feeds, a skill file and a 20-check self-test;
- an immediate merge to main.

He asked to translate it, put it in order, research open sources and integrate it all without errors.

We diffed the directive against main plus PRs #36 and #37. Almost all of it already exists:

| Directive item | Where it already is |
|---|---|
| 139 → 48 → 36 → 48 → 24 → 16 → 8, linear / ReLU / tanh | ADR-109, `nnFactory` in `scripts/lib/brain2-math.mjs` |
| Bézier threads, cyan / purple-pink / orange-red, pulses on events, still in the self-test | ADR-109 |
| Oscilloscope with the activation curve, live state and strongest weights | ADR-109, ADR-110 (continuous-time state x(t), τ) |
| Web Worker training on the 300-reading ring (Adam + (1+1)-ES) | ADR-109 |
| Bull, red-team bear, OSIRIS voice, risk judge with hard stops; learned weights | ADR-092, ADR-093 |
| Agent teams joined to the eight heads | ADR-111 agent wiring |
| Options/GEX, funding, BGP, outages, KEV, NGA warnings, quakes, Kp, EONET | ADR-108, ADR-110, ADR-112 |
| Skill `neural-flow-decision-viz` | ADR-109 |
| Self-test | 24 checks since ADR-110 (more than the 20 asked) |

Three real gaps remained:
1. The directive says "click any neuron **or thread**". Only neurons could be inspected.
2. The debate showed only each side's single strongest point, so you could not see what was weighed.
3. The risk team's veto was buried in the judge's verdict. You could not see each limit against its value.

We also found a bug. The on-chain fee spike objection (mempool.space) was added after the bear's text was built. It blocked an entry without being named.

## Decision

### 1. Thread inspector
Threads can now be tapped or clicked, like neurons.
- **Hit test.** Every thread in one column gap is the same cubic Bézier scaled to its two ends: x(t) = x₀ + Δx·(1.5t − 1.5t² + t³) and y(t) = y₀ + Δy·(3t² − 2t³). Its x-derivative 1.5 − 3t + 3t² has no real root, so x(t) is strictly increasing. One bisection per gap gives s(t), and from it every thread's height at the pointer, in O(threads in that gap) with no geometry cache. Of the threads within 6 px, the one carrying the largest |w·a| wins, so a tap lands on the bright thread you see.
- **The thread view** in the oscilloscope shows:
  - w (excitatory, inhibitory or decision thread), the source activation a, and w·a;
  - its share of Σ|w·a| into the target, and the target's z;
  - the weight after each of the up to 12 kept training versions, drawn as steps around zero;
  - w·a over the readings in the ring, with the chrono-scrubber position.
  Two buttons open the source and the target neuron.
- **Keyboard and touch.** The neuron view's strongest-weight rows are now buttons that open that thread. Enter on a selected neuron opens its strongest incoming thread, and Esc clears the selection. Zoomed in, a press that moves more than 4 px pans and a still press is a tap. Buttons are 44 px under `pointer: coarse`.
- **Reference.** The idea of inspecting one connection's weight comes from TensorFlow Playground (Apache-2.0). We took the idea only, not its code.

### 2. Debate evidence and the risk team veto line
- The bull lists up to three positive components, strongest weighted score first. The bear lists its objections, then up to three negative components.
- A new court line, **Risk team veto · فريق المخاطر وحق النقض**, shows each check against its limit: VPIN, PWSI, the cyber and space index, the breaker and the count of objections. It ends with "no veto" or "VETO · …". These are the same hard stops and objections the judge already applies. The line shows them and changes no rule.
- The fee-spike objection now joins the risk list before the bear's text, so a block is always named.
- `D.court.debate` (bull, bear, risks, veto) is exposed through the read-only desk probe.

### 3. Self-test
The existing check "Neural flow 139 → 8 & oscilloscope" now also proves:
- the Bézier inverse is exact at 0, ½ and 1;
- a thread's weight equals the neuron inspector's weight for the same link;
- w·a and its share are consistent, and the version list and the trace length are right;
- a tap on the middle of a drawn thread finds a thread within 6 px (skipped when the canvas is not drawn in the current view);
- the court's debate has at most three items for each side and five veto checks.

The count stays at 24, so the docs and the release gate still match.

### Not done, and why
- **Hidden neurons are not renamed as "agents", "Kalman" or "court".** The directive names layers by meaning (layer 4 = Kalman/BOCPD/Kyle, layer 5 = agent teams). Trained hidden units carry no assigned meaning, so labelling them that way would be invented data (AGENTS.md §3). Those quantities are real inputs among the 139, and the agents are drawn with their real links in the agent wiring card.
- **No merge to main.** The project rule is that Ahmad approves every merge. The PR waits for his explicit go.
- **No new feed.** Every keyless feed the directive names is already wired, through the proxy, a direct fetch or the hourly snapshot.

## Consequences
- Paper only. Nothing new can open, size or send an order. The network still decides nothing, and the $20 locked base rule is unchanged.
- No new host, storage key or dependency. The CSP hashes for the edited inline script and style were re-pinned.

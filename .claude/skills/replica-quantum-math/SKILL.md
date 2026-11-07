---
name: replica-quantum-math
description: Four exact engines in standard-library Python - a VPIN-style context-toxicity score for an agent's event stream (with a rollback hint), a Poisson-relaxation fluid layout for 375, 768 and 1440 px in RTL and LTR with 44 px touch checks, a seeded Monte Carlo over a mission DAG (p50, p95, critical path, ready steps) that never runs a locked step, and Shamir secret sharing over GF(256). No network, no processes.
---

# replica-quantum-math

```bash
python3 .claude/skills/replica-quantum-math/quantum_math.py vpin events.json
python3 .claude/skills/replica-quantum-math/quantum_math.py layout cards.json --viewport 375 --dir rtl
python3 .claude/skills/replica-quantum-math/quantum_math.py monte plan.json --trials 1000 --seed 149
python3 .claude/skills/replica-quantum-math/quantum_math.py shamir-split --hex <hex> -k 3 -n 5
python3 .claude/skills/replica-quantum-math/quantum_math.py shamir-join shares.json
python3 -m unittest discover -s .claude/skills/replica-quantum-math/tests
```

| Engine | What it computes | Notes |
| --- | --- | --- |
| `compute_vpin_toxicity` | Tokens fill buckets of equal volume; a token is toxic in proportion to how unproductive and repetitive its event was. VPIN = mean toxic share of the last buckets; OFI = (productive − toxic) / total | 0 is healthy, 1 is a loop; rollback to the last good capsule is advised at 0.65 `[INFERENCE]` |
| `solve_fluid_layout` | Jacobi steps of the discrete Poisson equation spread the cards' visual weight; cards go into 1, 2 or 3 columns, mirrored for RTL | checks 44 px touch size and that nothing passes the padding |
| `simulate_mission_monte_carlo` | Seeded lognormal durations over the steps' `depends`; p50, p95, how often each step is on the critical path, the steps that can start now | a locked step (AGENTS.md §1) and everything after it never run; `locked_never_ran` proves it |
| `split_secret_gf256` / `reconstruct_secret_gf256` | Shamir over GF(2⁸) with the AES polynomial 0x11b; each share carries its SHA-256 | coefficients come from `secrets`; any k shares rebuild the secret, and k − 1 shares fit every possible secret |

## Limits

- VPIN here is an analogy for loops and repetition in a token stream, not a market measure, and it predicts nothing.
- The layout engine balances weights and checks bounds. It does not render; use `replica-ux-physics` on a real page.
- Shamir protects a secret only while fewer than k shares are together. Splitting a key is not a reason to store the shares in one place.

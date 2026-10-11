# ADR-062: Newton, a verifiable math/physics engine

Date: 2026-10-11 · Status: Accepted (awaiting laptop install)

## Context
Ahmad asked for a "Newton brain": a mathematician/physicist agent in Claude and on the site that
computes exact answers for the whole project (car arrival, ship-to-island arrival, more accurate Earth map).
Local LLMs (qwen2.5:3b) and even frontier models are unreliable at arithmetic; numbers must come from code.

## Decision
- New `newton/` Python package: Vincenty geodesy (WGS84), SymPy exact maths (sandboxed parser: no
  attribute access, no builtins, char allow-list), constant-acceleration kinematics, ship ETA
  (AIS SOG + geodesic legs + optional Open-Meteo surface current vector triangle), road ETA (OSRM/OSM).
- Two front doors over the same functions: MCP stdio server `omega-newton` (read-only, compute only)
  and a loopback HTTP API + Arabic dark page on 127.0.0.1:8095.
- Every result carries inputs, formula, assumptions, evidence URLs and a ±1 kn sensitivity for ships.
- Free/keyless only. Port 8095 chosen to avoid 8088 (relay), 8089/8090 (Cortex), 8890 (SearXNG).

## Rejected / deferred
- "Econo-physics" Navier-Stokes market engine (PINNs + Lean agents + Kubernetes): markets do not obey a
  known conservation law, so a PINN has no true physics to enforce; Lean can prove a statement, not a
  forecast. Kubernetes is overkill for one laptop. If ever built: experimental signal on paper trading,
  backtested, CCXT read-only, never real orders.
- Context: OpenAI announced a Lean-verified Navier-Stokes blow-up proof on 2026-09-08; not yet
  independently reviewed, Clay has not awarded, and credit is disputed (Buckmaster/Alpöge). It is pure
  maths about idealised fluids and gives no trading edge.

## Consequences
- Oracle/Claude can answer "when does X arrive" with checkable numbers.
- Next (needs approval): Earth screen click-a-ship -> "ETA to..." using Newton; self-hosted OSRM for GCC.

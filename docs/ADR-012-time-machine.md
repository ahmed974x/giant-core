# ADR-012: Historical Time Machine & Scenario Simulation Engine

- Status: Accepted
- Date: 2026-10-09

## Context

OMEGA PRIME needs a way to evaluate historical shocks, crisis scenarios, and market regime changes in a controlled environment. The system must support retrospective analysis of global events, historical trading behavior, and operational simulations that inform real-time strategic decisions.

The design must provide a credible event timeline, deterministic scenario replay, and adequate execution throughput to explore multiple conditions without burdening the primary live system.

## Decision

We will integrate three core technologies:

1. GDELT as the historical event source.
2. QuantReplay as the simulation and replay execution engine.
3. Canwu as the Rust-based high-throughput processing component.

## Rationale

### GDELT

GDELT provides broad, internationally recognized event coverage across geopolitical crises, transport disruption, conflict, macroeconomic events, and market-sensitive developments. It offers a historically rich and scalable public API that is well suited for retrospective analysis, scenario reconstruction, and correlation with market effects.

The design stores GDELT data in PostgreSQL/TimescaleDB under the `gdelt_events` table so we can perform time-based aggregation, event filtering, and historical joins with market signals.

### QuantReplay

QuantReplay delivers a replay-oriented workflow aligned with historical market simulations. It supports scenario-driven backtesting and allows the Time Machine agent to compare expected outcomes against historical trading conditions, rather than just static assumptions or synthetic data.

This makes the engine a natural fit for infrastructure events, supply-chain shocks, and geopolitical disruption modeling.

### Canwu

Canwu provides a Rust-native execution layer designed for throughput and deterministic performance. In the Time Machine architecture, it complements Python-based orchestration by handling high-volume event fan-out, stream processing, and support for a parallel simulation pipeline.

## Consequences

### Positive

- Historical event data is accessible and reproducible.
- Scenario simulation is grounded in real-world signals rather than simulated narratives alone.
- The engine is modular: Python for orchestration, Rust for throughput-critical components, and specialized replay logic for market simulation.
- Time-based queries in TimescaleDB support high-value investigations into critical historical episodes.

### Negative

- Public GDELT data is event-centric and requires careful normalization when mapping to market and operational scenarios.
- Simulation fidelity depends on market data quality and consistent event labeling.
- Multi-engine orchestration introduces operational complexity and requires robust observability.

## Follow-up

The implementation will include:

- a GDELT ingestor that populates `gdelt_events`
- a Redis stream-based command interface for simulation tasks
- a Bot 09 time-machine agent that orchestrates fetch, replay, and result publication
- a Docker-based deployment model for QuantReplay and Canwu

This ADR should be revisited as new market datasets, replay frameworks, and event-normalization strategies are introduced.

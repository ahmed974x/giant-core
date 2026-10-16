# ADR-077: Agent system design: brains, nervous system and long-term memory (design only)

Date: 2026-10-16 · Status: Proposed (design document, nothing built)

## Context
Ahmad asked (2026-10-16) for a deep, open-source-first design of the agents: specialised agents with their own
roles, tools and computers; a shared nervous system; long-term memory; a brain that plans, researches, analyses and
acts; plus the wallet, an RR unit and a "Swiss banking" style system. Limits from the project: no real money, custody,
exchange keys or orders; agents only add proposals to the approval queue and a human approves each one (ADR-073,
ADR-076); every agent discloses it is an AI (`docs/AGENT-DISCLOSURE.md` on the paper-trading branch).

## Decision
- Design lives in `docs/agents/ARCHITECTURE-AGENTS.md` (Arabic summary first, technical detail after).
- Two loops: a no-LLM reflex layer on the existing stream bus, and a LangGraph deliberation loop with Postgres
  checkpoints and hard budgets.
- Nervous system inside the existing Postgres: hash-chained append-only event log, pgmq queues per agent, a registry
  of A2A-style Agent Cards, and an MCP tool gateway that enforces per-agent allow-lists from data, not prompts.
- Memory in the existing pgvector service: working, episodic, semantic (bitemporal), procedural and a calibration
  ledger that scores every forecast; a nightly consolidation ("sleep") run.
- Ten agents, including the existing four; only فهد has `proposals.add`, and no agent has any approve or fill tool.
- Wallet, RR unit and Vault are paper and read-only; the Vault is stated not to be a bank, with a licence review
  required before any non-paper use.
- Proposes swapping `redis:7.4` (RSALv2/SSPL) for Valkey (BSD-3) in phase 1.
- Research table: 59 projects checked from their official repositories for licence and last commit on 2026-10-16.

## Consequences
- No code changes in this commit. Six phases, each gated on Ahmad's approval, one commit and one ADR each.
- Phase 4 depends on the paper-trading MVP (ADR-073 to ADR-076) being merged.
- Undo: delete the two documents.

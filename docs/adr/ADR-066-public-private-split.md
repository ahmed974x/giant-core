# ADR-066: Public / Pro / Vault split for NABD (proposal)

Date: 2026-10-15 · Status: Proposed (waiting on Ahmad)

## Context
Ahmad wants to open NABD to the public and to paying subscribers while keeping trading decisions, positions,
PnL, strategies and keys private. Today everything runs on his laptop in one stack; there is no public or
subscriber surface, no live trading, and trading is paper-only (ADR-044). The giant-core history was never
audited for publication.

## Decision (proposed)
- Four tiers: Public (static site + new public repo), Pro and VIP (separate hosted app with login),
  Vault (the existing laptop stack, local only). Item lists in `docs/PUBLIC-PRIVATE-SPLIT.md`.
- Data moves one way, Vault → Pro → Public, through a single delayed, deny-listed, audited export job.
- giant-core is never made public; a public repo is built from an allow-list and secret-scanned first.
- Standing rule: no secret, key, position or PnL figure is ever published or committed.

## Consequences
- Nothing is built or deployed by this ADR. Each tier is its own later task with its own ADR and Ahmad's go.
- Paid signals (historical or real-time) need a legal check on advice licensing and trading ahead of
  subscribers before they are offered.
- Revenue and audience figures in the original plan are unverified targets.

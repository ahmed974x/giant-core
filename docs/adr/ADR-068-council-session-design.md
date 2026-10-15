# ADR-068: Council Session is a design document only, gated on legal review

Date: 2026-10-15 · Status: Accepted (design only; no sale)

## Context
Ahmad asked for a "Council Session" service design (five advisor perspectives on a customer-chosen topic,
PDF + 30-minute call), framed as educational analysis, built in parallel with the Cloudflare prep.
ADR-065/066 exist on other branches and 067 is expected for the parallel Cloudflare Access work, so this
takes 068 to avoid a collision.

## Decision
- `docs/COUNCIL-SESSION.md` defines deliverables, output wording rules (no buy/sell/hold or target prices,
  no public performance numbers), what the service must never do, and the open items.
- The "educational" label is not treated as a licensing exemption. A Kuwaiti lawyer must say whether the
  service is in CMA scope (Law 7/2010) before any sale.
- Paddle and Lemon Squeezy were checked on 2026-10-15: both prohibit consulting/services, and Paddle names
  investment advice and trading signals. They are ruled out for this service. Tap and MyFatoorah are unverified.
- Price stays TBD. No payment setup, publishing or outreach.

## Consequences
Nothing ships. The next step is Ahmad's lawyer's answer, then a payment provider whose terms allow the service.

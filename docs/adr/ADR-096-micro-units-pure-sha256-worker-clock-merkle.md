# ADR-096: Micro-unit money, pure-JS SHA-256 fallback, worker clock and Merkle checkpoints

Date: 2026-10-20 · Status: Accepted (Ahmad's Phase 8 directive, 2026-10-20)

## Context
Ahmad asked for four hardening items on the paper desk:
- micro-unit rounding (`Math.round(v * 1e6) / 1e6`) and canonical JSON before SHA-256;
- a pure JavaScript SHA-256 for the iPhone over Wi-Fi;
- a desk timer that does not freeze when the window is minimised;
- automatic compression of old receipts so `localStorage` never fills.

Canonical JSON (keys sorted, numbers to 8 decimals, `hash` left out) was already in place since ADR-091.

## Decision
1. **Micro-units.** The wallet's USDT fields (`cash`, `base`, `active`, `safe`, `split`, `swept`, `target`, `dayStart`) are rounded to 1e-6 on every save. The receipt `amount` and the before/after snapshots are rounded the same way. BTC quantities keep full precision. The canonical form keeps its 8 decimals: rounding a micro-unit value to 8 decimals changes nothing, so every chain issued before this change still verifies in both verifiers.
2. **Pure SHA-256.**
   - Plain `http://` on the home network is not a secure context, so `crypto.subtle` is undefined there. The Ops Room ledger and the NABD verifier (`site-landing/desk-sim.js`) now carry a FIPS 180-4 SHA-256 in plain JavaScript and use it only when WebCrypto is missing. The Ops Room says "(built-in SHA-256)" after a check.
   - Encryption is not re-implemented. The vault and the capsule keep WebCrypto AES-GCM-256 and PBKDF2, and say to use 127.0.0.1, `file://` or Tailscale HTTPS. A hand-written AES-GCM would be new, unaudited cryptography guarding the only copy of the paper desk.
3. **Worker clock.**
   - Browsers run main-thread timers in a hidden tab at most once a minute, so stops and targets on an open paper position could wait that long. The desk loops now get their ticks from a Blob Web Worker built from a named function (`tickWorker.toString()`, no string code). CSP adds `worker-src 'self' blob:`.
   - While hidden, the 5 s market loop keeps running only when the auto paper engine is on or a paper position is open. If the worker is refused, every job moves to plain timers.
   - Overlapping ticks are skipped.
4. **Merkle checkpoints.**
   - Past 1000 receipts, the oldest 500 are verified and replaced by one `omega-merkle-checkpoint-v1` record in `omega-receipt-checkpoints-v1`: `{from_seq, to_seq, count, first_prev_hash, last_hash, merkle_root, ts, prev_checkpoint, hash}`.
   - The root is the binary Merkle tree of the receipt hashes: parent = SHA-256 of left hex + right hex, and an odd last leaf is paired with itself.
   - Checkpoints chain to each other, and the first kept receipt links to the last checkpoint's `last_hash`.
   - If a `localStorage` write fails, half the chain is folded at once and the write is retried.
   - Sequence numbers continue across checkpoints.
   - The JSON export, the capsule and both verifiers carry and check `checkpoints`.
   - The receipts card says that folded lines leave the browser and to export first if every line is needed.

## Consequences
- Paper only, as before. Nothing here signs or sends an order, and the worker only sends clock ticks.
- Verified in Chromium:
  - The pure SHA-256 matched `node:crypto` on 85 random vectors from 0 to 100 000 bytes, on Arabic text and on the "abc" test vector. The landing copy matched on 300 vectors.
  - A seeded chain of 1000 receipts, plus one LOCK of 20, folded into 1 checkpoint and 501 receipts. It verified on 127.0.0.1 with WebCrypto and on a non-secure LAN address with the built-in hash, with the same Merkle root both times. A changed receipt was caught. The exported file verified on the NABD page.
  - With the tab hidden, the idle desk made 0 polls in 11 s and the auto paper engine made 2.

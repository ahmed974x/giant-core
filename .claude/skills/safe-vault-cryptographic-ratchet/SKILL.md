---
name: safe-vault-cryptographic-ratchet
description: Use when touching the paper wallet, the locked base, profit sweeps, receipts, Merkle checkpoints, capsules or the key vault. Keeps the SHA-256 receipt chain verifiable across the Ops Room, NABD and the MCP bridge, and keeps everything paper only.
---

# Locked base, sweeps and the receipt ratchet

Paper only. The S key and "Sweep profit now" move paper money inside the paper ledger (ADR-093). A sweep of real funds stays a proposal in the Director 00 approval inbox.

## 1. The ratchet

- A first visit locks a $20.00 paper base with a LOCK receipt.
- Sweepable profit is `max(0, NetEquity − LockedBase)`, rounded to 1e-6 USDT. Swept profit moves to the paper safe and never back into trading.
- Next to every input say: the base itself can still lose in trading; only swept profit is protected. The circuit breaker is fixed rules, not a prediction.

## 2. Receipts

`{invoice, seq, ts, mode, symbol, type, amount, before, after, reason, prev_hash, hash}` plus optional `exec` and `brain2`.

- `hash = SHA-256(JSON of the receipt without "hash", keys sorted, numbers rounded to 8 decimals)`; the canonical form drops every key named `hash` at every depth, so nested data must never use that key.
- The first `prev_hash` is 64 zeros. USDT amounts are rounded to 1e-6 before they enter the wallet or a receipt.
- Past 1000 receipts the oldest 500 fold into an `omega-merkle-checkpoint-v1` (parent = SHA-256 of left hex + right hex, an odd leaf pairs with itself). Checkpoints chain by `prev_checkpoint`.
- Export `{"format":"omega-receipt-chain-v1","checkpoints":[…],"receipts":[…]}`. The Ops Room, the NABD verifier and `verify_sha256_receipt_chain` in `scripts/omega-mcp-bridge.mjs` must all accept the same file. When changing the form, change all three in one commit and test a file exported from the page.
- Without WebCrypto (plain http on the LAN) pages hash with the built-in pure-JS SHA-256 (ADR-096).

## 3. Secrets

- The vault encrypts with AES-GCM-256 from a PBKDF2-SHA256 (600,000 rounds) key; only ciphertext is stored.
- A capsule (`omega-capsule-v1`) holds the paper wallet, receipts, court weights and THE CHAIN notes, never a vault entry or an API key. Import verifies the fingerprint and the chain and asks before it replaces anything.
- Never print a secret in a log, a report, a chat or an MCP tool answer. Secrets never sit in `localStorage` as plaintext or in git.

## 4. Locked

Real trading, an execution agent, Testnet or real-account routes, public copy-trading vaults and investor profit split stay locked cards marked «قيد الموافقة» until Ahmad gives a separate explicit approval and legal review is done.

## 5. Checks

Self-test "Receipt chain" checks, the bridge's `--selftest` (canonical form and tamper detection), an exported chain verified in the other two verifiers, SkillSpector strict.

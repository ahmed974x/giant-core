# ADR-106: Binance public WebSocket streams with REST fallback, and a labelled offline canyon

Date: 2026-10-22 · Status: Accepted (Ahmad's Phase 11 directive, 2026-10-22)

## Context
The desk polls Binance REST every 5 s. Ahmad asked for:
- the public streams `depth20@100ms` and `aggTrade` from `wss://data-stream.binance.vision`;
- a REST fallback;
- a deterministic simulation when offline.

The trading desk is paper only (ADR-091, ADR-092). No code may sign or send an order.

## Decision
- **Stream**
  - One combined stream per selected symbol: `wss://data-stream.binance.vision/stream?streams=<sym>@depth20@100ms/<sym>@aggTrade`. It is read-only and keyless, and nothing is ever sent on the socket.
  - `wss://data-stream.binance.vision` is added to the Ops Room `connect-src`.
  - Each partial book replaces the top 20 levels of the last REST book. Deeper levels keep their REST values. It updates the mid and `priceAt`.
  - Each aggregate trade goes into the same 300-trade tape the Hawkes and VPIN fit use.
  - The canyon repaints at most once a second.
- **Fallback**
  - REST polling keeps running. The desk, the court, the walls list and the breaker never depend on the socket.
  - On close the stream reconnects with backoff, from 1 s doubling to 60 s.
  - It pauses in a hidden tab unless the auto engine is on or a paper position is open.
  - The sonar tag shows the mode: `WS 100 ms`, `WS CONNECTING…`, `REST 5 s · WS RETRYING`, `REST 5 s · WS PAUSED` or `REST 5 s`.
- **Offline**
  - If no Binance book has arrived 15 s after load, the canyon draws a fixed, deterministic book in made-up units around 100.00.
  - It is labelled `SIMULATION · not market data` on the canvas and in the summary line.
  - It never enters `D.depth`, so the court, the auto engine, receipts, rings and every number elsewhere ignore it.
  - Once a real book has arrived it is never shown again in that session.

## Consequences
- With the stream up, the canyon and microprice baseline move at about 1 Hz from 100 ms data, and the trade tape fills between REST calls.
- Verified in the sandbox with a mocked socket: about 90 frames in 8 s, tag `WS 100 ms`, no page errors. With no network: `REST 5 s · WS RETRYING` and the labelled simulation after 15 s. The real stream is checked on the laptop and the public site.
